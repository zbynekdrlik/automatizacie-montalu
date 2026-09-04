// Cenový zoznam materiálu k zákazke — fáza 1 (#154, ROZHODNUTÉ 2026-08-12: ceny +
// dostupnosť, read-only). Appka NIKDY nepíše do Money — číta LEN denný snapshot
// súbor, ktorý sem doniesol `scripts/ceny-snapshot.py` (beží mimo appky, tam kde
// je Money dosiahnuteľné) + rsync na VPS (viď design komentár na tikete pre celý
// dátový tok). Chýbajúca cena je vždy `null` ("cena neznáma"), nikdy 0 — Money má
// reálne kódy, kde `Cena=0` znamená "nikdy zadané", nie "zadarmo" (overené live).
import fs from 'node:fs';
import { db } from './db';
import { logger } from './log';
import { computeLakovanie, type LakovanieResult } from '$lib/lakovanie';

const log = logger('ceny');

export interface PriceRow {
	kod: string;
	nakupCennik: number | null;
	nakupPoslednaFaktura: number | null;
	predajVo: number | null;
	mena: string;
	/** `null` = Money pre tento kód vôbec nemá skladovú kartu (neznáme); 0/záporné
	 *  sú REÁLNE hodnoty (vypredané / rezervované nad rámec skladu). */
	sklad: number | null;
	/** rozvin [m²/bm] pre lakovanie (#369) — merná jednotka `m2` na Money artikli
	 *  (m² povrchu na 1 bežný meter = obvod prierezu). `null` = Money ho pre kód
	 *  nemá (nelakovaný, alebo ešte nezadaný). Kladné číslo ⇒ hodnota; 0 ⇒ `null`. */
	rozvin: number | null;
}

const snapshotPath = () => process.env.CENY_SNAPSHOT_PATH || '/data/ceny/ceny.json';

/** Rozriešená cesta k dennému cenníkovému snapshotu — pre štartovací config log (db.ts, #245). */
export function cenySnapshotPath(): string {
	return snapshotPath();
}

interface MetaRow {
	snapshot_generated_at: string | null;
	snapshot_file_mtime_ms: number | null;
	imported_at: string | null;
	row_count: number;
	rejected_count: number;
}

function getMetaRow(): MetaRow | undefined {
	return db.prepare('SELECT * FROM material_prices_meta WHERE id = 1').get() as MetaRow | undefined;
}

/** Cena z Money 0/chýbajúca/neplatná ⇒ `null` ("cena neznáma"). Kladné číslo ⇒ hodnota. */
function priceOrNull(v: unknown, label: string, log: (m: string) => void): number | null {
	if (v === null || v === undefined) return null;
	if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v > 0 ? v : null;
	log(`neplatná cena „${label}" (${JSON.stringify(v)}) — berie sa ako neznáma`);
	return null;
}

/**
 * Validuje jeden riadok snapshotu. Štrukturálny problém (chýba/neplatný `kod`
 * alebo `sklad`) ⇒ CELÝ riadok sa zamietne (vráti `null`, zaloguje sa). Neplatná
 * JEDNOTLIVÁ cena riadok nezhodí — len sa zaloguje a to jedno pole je „neznáma"
 * (skladová dostupnosť aj ostatné ceny toho istého kódu sú stále cenné dáta).
 */
function validateRow(raw: unknown, idx: number, log: (m: string) => void): PriceRow | null {
	if (!raw || typeof raw !== 'object') {
		log(`riadok ${idx}: nie je objekt — zamietnutý`);
		return null;
	}
	const r = raw as Record<string, unknown>;
	const kod = typeof r.kod === 'string' ? r.kod.trim() : '';
	if (!kod) {
		log(`riadok ${idx}: chýba/neplatný „kod" — zamietnutý`);
		return null;
	}
	const rowLog = (m: string) => log(`riadok ${idx} (${kod}): ${m}`);
	// sklad SMIE byť záporný — Money ho vie vrátiť pod nulou (rezervované > fyzicky na
	// sklade), overené live na ostrých kódoch (2026-08-13 smoke query). SMIE byť aj
	// `null`/chýbajúce — Money pre daný kód nemá skladovú kartu vôbec (#154 review
	// nález); to je NEZNÁME, nie 0. Zamietame LEN štrukturálne nezmyselné hodnoty
	// (niečo iné než číslo/null — napr. text).
	const skladRaw = r.sklad;
	let sklad: number | null;
	if (skladRaw === null || skladRaw === undefined) {
		sklad = null;
	} else if (typeof skladRaw === 'number' && Number.isFinite(skladRaw)) {
		sklad = skladRaw;
	} else {
		rowLog(`neplatný „sklad" (${JSON.stringify(skladRaw)}) — celý riadok zamietnutý`);
		return null;
	}
	const mena = typeof r.mena === 'string' && r.mena.trim() ? r.mena.trim() : 'EUR';
	const kod0 = kod;
	let predajVo = priceOrNull(r.predajVo, 'predajVo', rowLog);
	// Kódy komponentov/kovania (ZASK*) — veľkoobchodný cenník sa im NEDÔVERUJE (šéf
	// 2026-08-12: "veľkoobchodným cenníkom si pri ZASK ešte nie istí"). Vynútené TU
	// (nielen v producer skripte) — druhá vrstva obrany, presne ako appka layeruje
	// b2b Money-write hranicu (viď access-control skill).
	if (!kod0.startsWith('ZASP')) predajVo = null;
	return {
		kod,
		nakupCennik: priceOrNull(r.nakupCennik, 'nakupCennik', rowLog),
		nakupPoslednaFaktura: priceOrNull(r.nakupPoslednaFaktura, 'nakupPoslednaFaktura', rowLog),
		predajVo,
		mena,
		sklad,
		// rozvin (#369): kladné m²/bm, alebo `null`. `priceOrNull` sa hodí 1:1 —
		// 0/chýba/neplatné ⇒ „neznámy" (rovnaká sémantika ako pri cenách: 0 = nikdy zadané).
		rozvin: priceOrNull(r.rozvin, 'rozvin', rowLog)
	};
}

export interface ImportResult {
	imported: boolean;
	reason: 'no-file' | 'not-newer' | 'read-error' | 'parse-error' | 'ok';
	rowCount?: number;
	rejectedCount?: number;
	generatedAt?: string | null;
}

/**
 * LAZY import: no-op, keď súbor chýba alebo sa mtime nezmenil od posledného
 * importu (lacná `fs.statSync` kontrola na KAŽDÉ volanie — bezpečné, appka beží
 * ako jeden proces, žiadny paralelný import). Zlý riadok sa preskočí + zaloguje,
 * NIKDY nezhodí celý import (jeden pokazený riadok v Money exporte nesmie
 * zablokovať aktualizáciu cien pre všetky ostatné položky — viď design komentár).
 */
export function maybeImportSnapshot(): ImportResult {
	const p = snapshotPath();
	let stat: fs.Stats;
	try {
		stat = fs.statSync(p);
	} catch {
		return { imported: false, reason: 'no-file' };
	}
	const meta = getMetaRow();
	if (meta?.snapshot_file_mtime_ms === stat.mtimeMs) {
		return { imported: false, reason: 'not-newer' };
	}
	let raw: string;
	try {
		raw = fs.readFileSync(p, 'utf8');
	} catch (e) {
		log.error('čítanie snapshotu zlyhalo', { path: p, error: e });
		return { imported: false, reason: 'read-error' };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		log.error('JSON parse snapshotu zlyhal', { path: p, error: e });
		return { imported: false, reason: 'parse-error' };
	}
	const file = (parsed ?? {}) as { generatedAt?: unknown; rows?: unknown };
	const generatedAt = typeof file.generatedAt === 'string' ? file.generatedAt : null;
	const rowsRaw = Array.isArray(file.rows) ? file.rows : [];

	let rejected = 0;
	const valid: PriceRow[] = [];
	rowsRaw.forEach((r, i) => {
		// zamietnutý riadok / neplatná jednotlivá cena = WARN (nie ERROR): dáta sa
		// zbierajú ďalej, len to jedno pole je „neznáme"
		const row = validateRow(r, i, (m) => log.warn(`snapshot: ${m}`));
		if (!row) {
			rejected++;
			return;
		}
		valid.push(row);
	});

	const upsert = db.prepare(`
		INSERT INTO material_prices (kod, nakup_cennik, nakup_posledna_faktura, predaj_vo, mena, sklad, rozvin, updated_at)
		VALUES (@kod, @nakupCennik, @nakupPoslednaFaktura, @predajVo, @mena, @sklad, @rozvin, datetime('now'))
		ON CONFLICT(kod) DO UPDATE SET
			nakup_cennik = excluded.nakup_cennik,
			nakup_posledna_faktura = excluded.nakup_posledna_faktura,
			predaj_vo = excluded.predaj_vo,
			mena = excluded.mena,
			sklad = excluded.sklad,
			rozvin = excluded.rozvin,
			updated_at = excluded.updated_at
	`);
	const upsertMeta = db.prepare(`
		INSERT INTO material_prices_meta (id, snapshot_generated_at, snapshot_file_mtime_ms, imported_at, row_count, rejected_count)
		VALUES (1, ?, ?, datetime('now'), ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			snapshot_generated_at = excluded.snapshot_generated_at,
			snapshot_file_mtime_ms = excluded.snapshot_file_mtime_ms,
			imported_at = excluded.imported_at,
			row_count = excluded.row_count,
			rejected_count = excluded.rejected_count
	`);
	db.transaction(() => {
		for (const row of valid) upsert.run(row);
		upsertMeta.run(generatedAt, stat.mtimeMs, valid.length, rejected);
	})();

	// úspešný súhrn importu = INFO (pôvodne console.error len kvôli stderr — oprava levelu)
	log.info('snapshot naimportovaný', { rows: valid.length, rejected, path: p });
	return {
		imported: true,
		reason: 'ok',
		rowCount: valid.length,
		rejectedCount: rejected,
		generatedAt
	};
}

export interface SnapshotMeta {
	generatedAt: string | null;
	importedAt: string | null;
	/** dní od `generatedAt` po TERAZ; `null` keď snapshot ešte nikdy nebol naimportovaný */
	daysOld: number | null;
	rowCount: number;
	rejectedCount: number;
}

function readSnapshotMetaFromDb(): SnapshotMeta {
	const meta = getMetaRow();
	if (!meta || !meta.snapshot_generated_at) {
		return { generatedAt: null, importedAt: null, daysOld: null, rowCount: 0, rejectedCount: 0 };
	}
	const genMs = Date.parse(meta.snapshot_generated_at);
	const daysOld = Number.isFinite(genMs)
		? Math.max(0, Math.floor((Date.now() - genMs) / 86400000))
		: null;
	return {
		generatedAt: meta.snapshot_generated_at,
		importedAt: meta.imported_at,
		daysOld,
		rowCount: meta.row_count,
		rejectedCount: meta.rejected_count
	};
}

/** Vek/stav aktuálne naimportovaného snapshotu — pre UI hlášku „Ceny zo snapshotu
 *  Money k {dátum}, N dní staré". Vždy najprv skúsi lazy import (čerstvejší súbor). */
export function getSnapshotMeta(): SnapshotMeta {
	maybeImportSnapshot();
	return readSnapshotMetaFromDb();
}

function getPriceRow(kod: string): PriceRow | undefined {
	const row = db
		.prepare(
			`SELECT kod, nakup_cennik AS nakupCennik, nakup_posledna_faktura AS nakupPoslednaFaktura,
			        predaj_vo AS predajVo, mena, sklad, rozvin
			 FROM material_prices WHERE kod = ?`
		)
		.get(kod) as
		| {
				kod: string;
				nakupCennik: number | null;
				nakupPoslednaFaktura: number | null;
				predajVo: number | null;
				mena: string;
				sklad: number | null;
				rozvin: number | null;
		  }
		| undefined;
	return row;
}

// ---- pre-export validácia Money kódov (#295) ----

/** Prečo je kód problematický pri exporte do Money. */
export interface KodProblem {
	kod: string;
	nazov: string;
	/** `neznamy` = kód v Money snapshote VÔBEC nie je; `bez-skladovej-karty` = je v snapshote,
	 *  ale `sklad === null` (Money preň nemá skladovú kartu). Oba prípady import PRESKOČÍ. */
	dovod: 'neznamy' | 'bez-skladovej-karty';
	popis: string;
}

export interface OdpisKodyValidacia {
	/** `true` = žiadny problém, ALEBO snapshot nie je použiteľný (degrade — NEblokuj naslepo). */
	ok: boolean;
	/** snapshot je čerstvý (≤ `SNAPSHOT_MAX_DNI`) + neprázdny → validácia má zmysel. */
	snapshotUsable: boolean;
	snapshot: SnapshotMeta;
	/** len problematické položky, ktorých PREFIX snapshot reálne pokrýva. */
	problemy: KodProblem[];
}

/** Nad koľko dní starý snapshot sa už validácii nedôveruje (degrade na warning, neblokuj). */
const SNAPSHOT_MAX_DNI = 7;

/** Písmenový prefix kódu (`ZASP` z `ZASP00014`, `PRP` z `PRP20258`) — určuje, či daný kód
 *  vôbec spadá do rozsahu snapshotu (dnes ZASP.../ZASK.../TS.../PRP.../BPP.../BPK... — reálny
 *  scope sa berie EMPIRICKY z `snapshotPrefixy()`, nie z tohto zoznamu; #359 pridal bazén BPP/BPK).
 *  POZN.: `kodPrefix` je case-insensitive + trim, ale `getPriceRow` matchuje kód PRESNE (case-sensitive,
 *  bez trimu) — takže kód s inou veľkosťou písmen / medzerami sa síce dostane do scope, ale lookup ho
 *  nenájde → označí sa `neznamy` (blok). To je ZÁMERNE konzervatívne (mangled kód = radšej blok než
 *  tichý import). Guard chytá len numerickú časť kódu — preklep v PÍSMENOVOM prefixe (`TSS` miesto `TS`)
 *  posunie kód mimo scope a NEvaliduje sa (nemáme oň dáta). */
function kodPrefix(kod: string): string {
	const m = /^[A-Za-z]+/.exec(kod.trim());
	return m ? m[0].toUpperCase() : '';
}

/** Prefixy, ktoré snapshot REÁLNE obsahuje (empirický scope) — kód s prefixom mimo tejto množiny
 *  sa NEVALIDUJE (nemáme oň dáta). Odkedy #359 pridal bazén BPP/BPK do snapshotu, bazénové odpisy
 *  UŽ v scope SÚ (validujú sa); mimo scope ostáva len rodina, ktorú snapshot naozaj neťahá. */
function snapshotPrefixy(): Set<string> {
	const rows = db.prepare('SELECT kod FROM material_prices').all() as { kod: string }[];
	const s = new Set<string>();
	for (const r of rows) {
		const p = kodPrefix(r.kod);
		if (p) s.add(p);
	}
	return s;
}

/**
 * PRE-export validácia položiek odpisu proti dennému Money snapshotu (#295). Kód, ktorého PREFIX
 * snapshot pokrýva, ale ktorý v snapshote CHÝBA alebo má `sklad === null` (Money nemá skladovú
 * kartu), by Money import TICHO preskočil (a Dominik potvrdil, že vtedy neodpíše CELÝ doklad).
 * Volajúci (`writeOdpis` pre live=1) na základe `!ok` blokuje. Keď snapshot nie je použiteľný
 * (chýba/zastaraný), vráti `ok=true`, `snapshotUsable=false` — NEblokuje naslepo, len degrade.
 */
export function validateOdpisKody(polozky: { kod: string; nazov: string }[]): OdpisKodyValidacia {
	maybeImportSnapshot();
	const snapshot = readSnapshotMetaFromDb();
	const snapshotUsable =
		snapshot.generatedAt !== null &&
		snapshot.rowCount > 0 &&
		(snapshot.daysOld ?? Infinity) <= SNAPSHOT_MAX_DNI;
	const problemy: KodProblem[] = [];
	if (snapshotUsable) {
		const prefixy = snapshotPrefixy();
		for (const p of polozky) {
			if (!prefixy.has(kodPrefix(p.kod))) continue; // mimo scope snapshotu — nevalidujeme
			const price = getPriceRow(p.kod);
			if (!price) {
				problemy.push({
					kod: p.kod,
					nazov: p.nazov,
					dovod: 'neznamy',
					popis: `Money nepozná kód ${p.kod} — import by tento riadok (a možno celý doklad) preskočil.`
				});
			} else if (price.sklad === null) {
				problemy.push({
					kod: p.kod,
					nazov: p.nazov,
					dovod: 'bez-skladovej-karty',
					popis: `Money nemá skladovú kartu pre ${p.kod} — import by ho preskočil.`
				});
			}
		}
	}
	return { ok: problemy.length === 0, snapshotUsable, snapshot, problemy };
}

export interface CenaZaM2 {
	/** €/m² z Money cenníka (pre sklo = IZOS cenník cez `nakupCennik`); `null` =
	 *  kód je v snapshote, ale cenu preň Money nemá (0/chýba) → „cena nedostupná". */
	eurM2: number | null;
	mena: string;
}

/**
 * Cena za m² pre daný Money kód zo snapshotu — pre display-only zobrazenie ceny
 * skla v nárezáku (#225). Zdroj je existujúce pole `nakupCennik` (u skiel doň
 * producent snapshotu mapne IZOS cenník). Vráti `null`, keď kód v snapshote VÔBEC
 * NIE JE (variant je namapovaný, ale cena ešte nie je k dispozícii) — rovnaká
 * honest-null hláška ako `eurM2 === null`. Sám si spustí lazy import (idempotentný).
 */
export function cenaZaM2(kod: string): CenaZaM2 | null {
	if (!kod) return null;
	maybeImportSnapshot();
	const price = getPriceRow(kod);
	if (!price) return null;
	return { eurM2: price.nakupCennik, mena: price.mena };
}

export interface CenaRiadok {
	kod: string;
	nazov: string;
	qty: number;
	mj: string;
	nakupCennik: number | null;
	nakupPoslednaFaktura: number | null;
	predajVo: number | null;
	/** JEDNOTKOVÁ marža (predajVo − nakupCennik, na jednotku) — marža sa počíta
	 *  z CENNÍKOVEJ nákupnej ceny, nie z poslednej faktúry (šéf 2026-08-12). */
	marza: number | null;
	/** dostupné množstvo na sklade. `null` = neznáme (kód nikdy nebol v Money
	 *  snapshote, ALEBO tam bol, ale Money preň nemá skladovú kartu — obe sa
	 *  zobrazujú rovnako); `0`/záporné = reálna hodnota z Money, nikdy "neznáma". */
	sklad: number | null;
	/** mena zdrojovej ceny (z Money price-booku); `EUR`, keď appka o kóde vôbec
	 *  nemá cenové dáta — nemá čo inak zobraziť. */
	mena: string;
	/** rozvin [m²/bm] pre lakovanie (#369); `null` = Money ho pre kód nemá. */
	rozvin: number | null;
}

export interface CenySucet {
	suma: number;
	/** `false`, keď aspoň jedna položka s nenulovým množstvom mala pre tento
	 *  stĺpec neznámu cenu — súčet je TEDA NEÚPLNÝ (appka to musí priznať v UI). */
	kompletne: boolean;
}

export interface CenyResult {
	radky: CenaRiadok[];
	sucty: {
		nakupCennik: CenySucet;
		nakupPoslednaFaktura: CenySucet;
		predajVo: CenySucet;
		marza: CenySucet;
	};
	/** spotreba farby na lakovanie profilov (#369) — display-only, €-náklad honest-null. */
	lakovanie: LakovanieResult;
	snapshot: SnapshotMeta;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function novySucet(): CenySucet {
	return { suma: 0, kompletne: true };
}

function pripocitaj(sucet: CenySucet, hodnota: number | null, qty: number) {
	if (hodnota === null) {
		if (qty !== 0) sucet.kompletne = false;
		return;
	}
	sucet.suma += hodnota * qty;
}

/**
 * Napojí cenové dáta na položky odpisu (JOIN podľa kódu) + spočíta súčty za
 * zákazku. Volá sa LEN pre interných (b2b cenový blok nesmie vidieť vôbec —
 * gatuje sa na úrovni route/akcie, nie tu, presne ako Money-write hranica).
 */
export function enrichPolozky(
	polozky: { kod: string; nazov: string; qty: number; mj?: string }[]
): CenyResult {
	maybeImportSnapshot();
	const sucty = {
		nakupCennik: novySucet(),
		nakupPoslednaFaktura: novySucet(),
		predajVo: novySucet(),
		marza: novySucet()
	};
	const radky: CenaRiadok[] = polozky.map((p) => {
		const price = getPriceRow(p.kod);
		const nakupCennik = price?.nakupCennik ?? null;
		const nakupPoslednaFaktura = price?.nakupPoslednaFaktura ?? null;
		const predajVo = price?.predajVo ?? null;
		const marza = nakupCennik !== null && predajVo !== null ? predajVo - nakupCennik : null;
		pripocitaj(sucty.nakupCennik, nakupCennik, p.qty);
		pripocitaj(sucty.nakupPoslednaFaktura, nakupPoslednaFaktura, p.qty);
		pripocitaj(sucty.predajVo, predajVo, p.qty);
		pripocitaj(sucty.marza, marza, p.qty);
		return {
			kod: p.kod,
			nazov: p.nazov,
			qty: p.qty,
			mj: p.mj ?? 'm',
			nakupCennik,
			nakupPoslednaFaktura,
			predajVo,
			marza,
			sklad: price?.sklad ?? null,
			mena: price?.mena ?? 'EUR',
			rozvin: price?.rozvin ?? null
		};
	});
	for (const s of Object.values(sucty)) s.suma = round2(s.suma);
	// Lakovanie (#369): spotreba farby na rozvin profilov — display-only, počítané
	// z tých istých riadkov (rozvin + dĺžka). €-náklad ostáva honest-null.
	const lakovanie = computeLakovanie(radky);
	return { radky, sucty, lakovanie, snapshot: readSnapshotMetaFromDb() };
}

// ---- predodpisové skladové varovanie (#448) ----

/** Jedno skladové varovanie pred odpisom (#448): kód, ktorého denný Money snapshot hlási nižší
 *  sklad než požadované množstvo. Honest signál — NIE blok (appka sklad nevlastní, snapshot je stale). */
export interface SkladVarovanie {
	kod: string;
	/** dostupný sklad zo snapshotu (non-null, < požadované). */
	sklad: number;
	/** požadované množstvo (SÚČET za kód v tomto odpise). */
	mnozstvo: number;
}

/**
 * Predodpisové SKLADOVÉ VAROVANIE (#448) — pre položky odpisu vráti varovanie za KAŽDÝ kód, ktorého
 * denný Money snapshot hlási `sklad != null && sklad < požadované`. Presná rovnosť (`sklad ===
 * mnozstvo`), `sklad === null` (Money nemá skladovú kartu), kód mimo snapshotu (Money ho nepozná)
 * aj nulové/záporné množstvo → žiadne varovanie: appka sklad NEVLASTNÍ, záporný sklad je v Money
 * legitímny a snapshot je 1×denne stale, takže tvrdý blok by dával falošné poplachy (settled dizajn
 * #448 — na rozdiel od `validateOdpisKody`, ktoré unknown-kod/bez-skladovej-karty BLOKUJE). Množstvo
 * sa AGREGUJE za kód (Money kontroluje sklad na CELKOVÝ dopyt kódu v doklade). Sám si spustí lazy
 * import snapshotu (idempotentný), rovnako ako `validateOdpisKody`/`enrichPolozky`.
 */
export function skladoveVarovania(polozky: { kod: string; mnozstvo: number }[]): SkladVarovanie[] {
	maybeImportSnapshot();
	// súčet požadovaného množstva za kód (LEN kladné — nulová položka nič nežiada); Map insertion
	// order určuje poradie výstupu = deterministické podľa prvého výskytu kódu
	const dopyt = new Map<string, number>();
	for (const p of polozky) {
		if (!p.kod || typeof p.mnozstvo !== 'number' || !Number.isFinite(p.mnozstvo) || p.mnozstvo <= 0)
			continue;
		dopyt.set(p.kod, (dopyt.get(p.kod) ?? 0) + p.mnozstvo);
	}
	const out: SkladVarovanie[] = [];
	for (const [kod, rawMnozstvo] of dopyt) {
		// zaokrúhli agregát na 3 desatinné (mm presnosť) — FP akumulácia (napr. 0,1+0,2=0,30000…4) by
		// inak spravila FALOŠNÉ varovanie pri koncepčne ROVNOM sklade (design: presná rovnosť = žiadne
		// varovanie). Vzor `round2` v `enrichPolozky` — tam sa súčty tiež zaokrúhľujú pred zobrazením.
		const mnozstvo = Math.round(rawMnozstvo * 1000) / 1000;
		const price = getPriceRow(kod);
		if (price && price.sklad !== null && price.sklad < mnozstvo) {
			out.push({ kod, sklad: price.sklad, mnozstvo });
		}
	}
	return out;
}
