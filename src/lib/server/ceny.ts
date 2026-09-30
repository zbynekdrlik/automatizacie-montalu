// Cenový zoznam materiálu k zákazke — fáza 1 (#154, ROZHODNUTÉ 2026-08-12: ceny +
// dostupnosť, read-only). Appka NIKDY nepíše do Money — číta LEN denný snapshot
// súbor, ktorý sem doniesol `scripts/ceny-snapshot.py` (beží mimo appky, tam kde
// je Money dosiahnuteľné) + rsync na VPS (viď design komentár na tikete pre celý
// dátový tok). Chýbajúca cena je vždy `null` ("cena neznáma"), nikdy 0 — Money má
// reálne kódy, kde `Cena=0` znamená "nikdy zadané", nie "zadarmo" (overené live).
//
// #599 krok ceny (ROZHODNUTÉ owner 30.9. „ano prepnut ceny hned"): ZDROJ cien sa volí
// AUTOMATICKY — keď Odoo kanál `get_prices` odpovie (`odoo-prices.ts`), ceny (aj rozvin a
// stĺpec sklad) sú LEN z Odoo a chýbajúca cena je „neznáma" (žiadny Money fallback per
// položka); keď kanál chýba (404/403 — dnešný PROD, odoo-erp 8706) / výpadok / dev-CI bez
// Odoo → denný Money snapshot ako doteraz. Snapshot tabuľka `material_prices` sa Odoo cenami
// NIKDY neprepisuje (číta ju ďalej validácia kódov + skladové varovanie).
import fs from 'node:fs';
import { db } from './db';
import { logger } from './log';
import { computeLakovanie, type LakovanieResult } from '$lib/lakovanie';
import { odooCenyPreKody, zaznamenajZdroj, type CenyZdroj } from './odoo-prices';
import { odooProduktyPreKody, odooSkladPreKody } from './odoo-katalog';

const log = logger('ceny');

export interface PriceRow {
	kod: string;
	nakupCennik: number | null;
	nakupPoslednaFaktura: number | null;
	/** nakupSkladovaKarta (#506): Artikly_Artikl.PosledniCena — posledná nákupná cena
	 *  na skladovej karte. Pre BPK komponenty JEDINÝ nákupný zdroj (NC cenník = 0).
	 *  Appka ju používa ako FALLBACK keď nakupCennik je null. */
	nakupSkladovaKarta: number | null;
	predajVo: number | null;
	// predajPcmo (#364): predajná cena z cenníka PCMO (Predajný cenník polykarbonát MO).
	// Hlavne BPK bazénové komponenty (61/173 kódov), ale pokrýva aj PCD/PRK/ZAS.
	// ZÁMERNE NIE nakupCennik — iný sémantický význam (predajná, nie nákupná).
	predajPcmo: number | null;
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
		// nakupSkladovaKarta (#506): fallback nákupná cena zo skladovej karty
		nakupSkladovaKarta: priceOrNull(r.nakupSkladovaKarta, 'nakupSkladovaKarta', rowLog),
		predajVo,
		// predajPcmo (#364): predajná cena z PCMO cenníka. `priceOrNull` 1:1 — rovnaká
		// sémantika (0 = nikdy zadané → null). PCMO je predajný cenník, ZÁMERNE NIE nakupCennik.
		predajPcmo: priceOrNull(r.predajPcmo, 'predajPcmo', rowLog),
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
		INSERT INTO material_prices (kod, nakup_cennik, nakup_posledna_faktura, nakup_skladova_karta, predaj_vo, predaj_pcmo, mena, sklad, rozvin, updated_at)
		VALUES (@kod, @nakupCennik, @nakupPoslednaFaktura, @nakupSkladovaKarta, @predajVo, @predajPcmo, @mena, @sklad, @rozvin, datetime('now'))
		ON CONFLICT(kod) DO UPDATE SET
			nakup_cennik = excluded.nakup_cennik,
			nakup_posledna_faktura = excluded.nakup_posledna_faktura,
			nakup_skladova_karta = excluded.nakup_skladova_karta,
			predaj_vo = excluded.predaj_vo,
			predaj_pcmo = excluded.predaj_pcmo,
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
			        nakup_skladova_karta AS nakupSkladovaKarta,
			        predaj_vo AS predajVo, predaj_pcmo AS predajPcmo, mena, sklad, rozvin
			 FROM material_prices WHERE kod = ?`
		)
		.get(kod) as
		| {
				kod: string;
				nakupCennik: number | null;
				nakupPoslednaFaktura: number | null;
				nakupSkladovaKarta: number | null;
				predajVo: number | null;
				predajPcmo: number | null;
				mena: string;
				sklad: number | null;
				rozvin: number | null;
		  }
		| undefined;
	return row;
}

// ---- zdroj cien: Odoo `get_prices` alebo Money snapshot (#599 krok ceny) ----

/** Cenové riadky pre sadu kódov z JEDNÉHO zdroja (celý výpočet ide z rovnakého zdroja). */
export interface CenovyZdroj {
	zdroj: CenyZdroj;
	/** riadok pre kód, `undefined` = zdroj kód nepozná (cena neznáma). */
	riadok(kod: string): PriceRow | undefined;
}

/**
 * Zvolí zdroj cien pre `kody`: Odoo kanál odpovedá → LEN Odoo riadky (kód mimo Odoo = `undefined`,
 * NIKDY snapshot); inak Money snapshot (lazy import). Odoo riadok ide cez TÚ ISTÚ `validateRow` ako
 * snapshot (0 → neznáma, `predajVo` len ZASP), `predajPcmo` a `nakupSkladovaKarta` Odoo nemá → null.
 * Zdroj sa zaznamená (`zaznamenajZdroj` — INFO log pri zmene).
 */
export async function cenovyZdroj(kody: string[]): Promise<CenovyZdroj> {
	// snapshot sa lazy importuje VŽDY (lacný `statSync`): jeho meta aj riadky čítajú aj iní
	// konzumenti (vek pre UI, validácia kódov, skladové varovanie) nezávisle od zdroja cien
	maybeImportSnapshot();
	const odoo = await odooCenyPreKody(kody);
	if (odoo.zdroj === 'odoo') {
		zaznamenajZdroj('material', 'odoo');
		const riadky = new Map<string, PriceRow>();
		let i = 0;
		for (const r of odoo.ceny.values()) {
			const row = validateRow({ ...r, predajPcmo: null, nakupSkladovaKarta: null }, i++, (m) =>
				log.warn(`odoo get_prices: ${m}`)
			);
			if (row) riadky.set(row.kod, row);
		}
		const chybaju = kody.filter((k) => k && !riadky.has(k));
		if (chybaju.length > 0)
			log.debug('ceny z Odoo: kódy bez ceny v Odoo (cena neznáma)', { kody: chybaju });
		return { zdroj: 'odoo', riadok: (kod) => riadky.get(kod) };
	}
	zaznamenajZdroj('material', 'snapshot');
	return { zdroj: 'snapshot', riadok: getPriceRow };
}

// ---- pre-export validácia Money kódov (#295) ----

/** Prečo je kód problematický pri exporte do Money. */
export interface KodProblem {
	kod: string;
	nazov: string;
	/** `neznamy` = kód nie je aktívny v Odoo katalógu (#599; pri Odoo výpadku: v Money snapshote VÔBEC
	 *  nie je); `bez-skladovej-karty` = je v snapshote, ale `sklad === null` (Money preň nemá skladovú
	 *  kartu). Oba prípady Money import PRESKOČÍ. */
	dovod: 'neznamy' | 'bez-skladovej-karty';
	popis: string;
}

export interface OdpisKodyValidacia {
	/** `true` = žiadny problém, ALEBO (snapshot zdroj) snapshot nie je použiteľný (degrade — NEblokuj
	 *  naslepo). */
	ok: boolean;
	/** #599: `odoo` = kódy overené proti Odoo `product.product`; `snapshot` = Odoo nedostupné
	 *  (nenakonfigurované / výpadok) → fallback na denný Money snapshot (pôvodná #295 validácia). */
	zdroj: 'odoo' | 'snapshot';
	/** snapshot je čerstvý (≤ `SNAPSHOT_MAX_DNI`) + neprázdny → snapshot kontroly (pri Odoo zdroji len
	 *  `bez-skladovej-karty`) majú zmysel. */
	snapshotUsable: boolean;
	snapshot: SnapshotMeta;
	/** len problematické položky (snapshot zdroj: len tie, ktorých PREFIX snapshot reálne pokrýva). */
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

/** Hláška pre neznámy kód — ROVNAKÁ pre Odoo aj snapshot zdroj (#599: používateľ nevidí rozdiel). */
function neznamyKod(p: { kod: string; nazov: string }): KodProblem {
	return {
		kod: p.kod,
		nazov: p.nazov,
		dovod: 'neznamy',
		popis: `Money nepozná kód ${p.kod} — import by tento riadok (a možno celý doklad) preskočil.`
	};
}

/** Hláška pre kód bez Money skladovej karty (import by ho preskočil) — Odoo aj snapshot zdroj. */
function bezSkladovejKarty(p: { kod: string; nazov: string }): KodProblem {
	return {
		kod: p.kod,
		nazov: p.nazov,
		dovod: 'bez-skladovej-karty',
		popis: `Money nemá skladovú kartu pre ${p.kod} — import by ho preskočil.`
	};
}

/** Stav denného Money snapshotu pre validáciu: použiteľný = čerstvý (≤ `SNAPSHOT_MAX_DNI`) + neprázdny. */
function snapshotPreValidaciu(): { snapshot: SnapshotMeta; snapshotUsable: boolean } {
	maybeImportSnapshot();
	const snapshot = readSnapshotMetaFromDb();
	const snapshotUsable =
		snapshot.generatedAt !== null &&
		snapshot.rowCount > 0 &&
		(snapshot.daysOld ?? Infinity) <= SNAPSHOT_MAX_DNI;
	return { snapshot, snapshotUsable };
}

/**
 * PRE-export validácia položiek odpisu (#295) — brána pred zápisom do Money pre live=1: kód, ktorý by
 * Money import TICHO preskočil (a Dominik potvrdil, že vtedy neodpíše CELÝ doklad), zablokuje zápis.
 * Volajúci (`writeOdpis` pre live=1) na základe `!ok` blokuje (s auditovaným override).
 *
 * #599: EXISTENCIU kódu rozhoduje Odoo `product.product` (katalóg syncovaný z Money, rovnaké
 * `default_code`) — kód je platný, keď v Odoo existuje ako AKTÍVNY produkt; Odoo pokrýva CELÝ katalóg,
 * takže sa validujú všetky rodiny (nie len prefixy snapshotu). Kým je cieľom odpisu Money (do cutu,
 * odoo-erp 1122), ostáva aj #295 poistka `bez-skladovej-karty` zo snapshotu (keď je použiteľný) — je
 * to vlastnosť Money importu, Odoo `is_storable` ju nenahrádza. Pri NEDOSTUPNOM Odoo (nenakonfigurované,
 * chyba, timeout 3 s, 403) FALLBACK na celú snapshot validáciu + WARN pri výpadku — odpis sa NIKDY
 * neblokuje len kvôli výpadku Odoo (snapshot fallback blokuje presne ako pred #599).
 */
export async function validateOdpisKody(
	polozky: { kod: string; nazov: string }[]
): Promise<OdpisKodyValidacia> {
	const katalog = await odooProduktyPreKody(polozky.map((p) => p.kod));
	if (katalog.zdroj === 'odoo') {
		const { snapshot, snapshotUsable } = snapshotPreValidaciu();
		const problemy: KodProblem[] = [];
		for (const p of polozky) {
			if (!p.kod || !p.kod.trim()) continue; // prázdny kód nemá čo overiť (ako mimo-scope snapshotu)
			if (!katalog.produkty.has(p.kod)) problemy.push(neznamyKod(p));
			else if (snapshotUsable && getPriceRow(p.kod)?.sklad === null)
				problemy.push(bezSkladovejKarty(p));
		}
		if (problemy.length > 0)
			log.info('validácia kódov (Odoo): problémové kódy', {
				problemy: problemy.map((p) => `${p.kod}:${p.dovod}`)
			});
		return { ok: problemy.length === 0, zdroj: 'odoo', snapshotUsable, snapshot, problemy };
	}
	if (katalog.dovod === 'chyba')
		log.warn('validácia kódov: Odoo katalóg nedostupný — fallback na Money snapshot', {
			kody: polozky.length
		});
	else log.debug('validácia kódov: Odoo nenakonfigurované — Money snapshot');
	return validateOdpisKodySnapshot(polozky);
}

/**
 * Snapshot validácia (#295, fallback od #599): kód, ktorého PREFIX snapshot pokrýva, ale ktorý
 * v snapshote CHÝBA alebo má `sklad === null` (Money nemá skladovú kartu) → problém. Keď snapshot
 * nie je použiteľný (chýba/zastaraný), vráti `ok=true`, `snapshotUsable=false` — NEblokuje naslepo.
 */
function validateOdpisKodySnapshot(polozky: { kod: string; nazov: string }[]): OdpisKodyValidacia {
	const { snapshot, snapshotUsable } = snapshotPreValidaciu();
	const problemy: KodProblem[] = [];
	if (snapshotUsable) {
		const prefixy = snapshotPrefixy();
		for (const p of polozky) {
			if (!prefixy.has(kodPrefix(p.kod))) continue; // mimo scope snapshotu — nevalidujeme
			const price = getPriceRow(p.kod);
			if (!price) problemy.push(neznamyKod(p));
			else if (price.sklad === null) problemy.push(bezSkladovejKarty(p));
		}
	}
	return { ok: problemy.length === 0, zdroj: 'snapshot', snapshotUsable, snapshot, problemy };
}

export interface CenaZaM2 {
	/** €/m² z cenníka IZOS (`nakupCennik` TS kódu — Odoo `get_prices` alebo Money snapshot); `null`
	 *  = kód zdroj pozná, ale cenu preň nemá (0/chýba) → „cena nedostupná". */
	eurM2: number | null;
	mena: string;
}

/** €/m² TS kódu z už zvoleného zdroja (`cenovyZdroj`); `null` = kód zdroj vôbec nepozná. */
export function cenaZaM2Zo(zdroj: CenovyZdroj, kod: string): CenaZaM2 | null {
	if (!kod) return null;
	const price = zdroj.riadok(kod);
	if (!price) return null;
	return { eurM2: price.nakupCennik, mena: price.mena };
}

/**
 * Cena za m² pre daný TS kód — display-only cena skla (#225, strešné sklo #223). Zdroj = Odoo
 * `get_prices` keď kanál odpovedá, inak Money snapshot (`cenovyZdroj`). Vráti `null`, keď kód zdroj
 * VÔBEC NEPOZNÁ — rovnaká honest-null hláška ako `eurM2 === null`.
 */
export async function cenaZaM2(kod: string): Promise<CenaZaM2 | null> {
	if (!kod) return null;
	return cenaZaM2Zo(await cenovyZdroj([kod]), kod);
}

export interface CenaRiadok {
	kod: string;
	nazov: string;
	qty: number;
	mj: string;
	nakupCennik: number | null;
	nakupPoslednaFaktura: number | null;
	predajVo: number | null;
	// predajPcmo (#364): predajná cena z PCMO cenníka. Display-only orientačná cena.
	predajPcmo: number | null;
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
		predajPcmo: CenySucet;
		marza: CenySucet;
	};
	/** spotreba farby na lakovanie profilov (#369) — display-only, €-náklad honest-null. */
	lakovanie: LakovanieResult;
	/** #599: odkiaľ sú ceny — `odoo` (kanál `get_prices` odpovedal) alebo `snapshot` (denný Money
	 *  snapshot, kým Odoo kanál nie je). UI ho ukáže pri cenách (`ceny-zdroj`). */
	zdroj: CenyZdroj;
	/** meta Money snapshotu (vek pre UI) — relevantné len pri `zdroj === 'snapshot'`. */
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
 * #599: zdroj = Odoo `get_prices` keď odpovedá (inak Money snapshot) — celý výpočet z JEDNÉHO zdroja.
 */
export async function enrichPolozky(
	polozky: { kod: string; nazov: string; qty: number; mj?: string }[]
): Promise<CenyResult> {
	const zdroj = await cenovyZdroj(polozky.map((p) => p.kod));
	const sucty = {
		nakupCennik: novySucet(),
		nakupPoslednaFaktura: novySucet(),
		predajVo: novySucet(),
		predajPcmo: novySucet(),
		marza: novySucet()
	};
	const radky: CenaRiadok[] = polozky.map((p) => {
		const price = zdroj.riadok(p.kod);
		// nakupCennik (#506): NC cenník je primárny; keď je null, použij skladovú kartu
		// (Artikly_Artikl.PosledniCena) ako fallback — pre BPK komponenty jediný zdroj.
		const nakupCennik = price?.nakupCennik ?? price?.nakupSkladovaKarta ?? null;
		const nakupPoslednaFaktura = price?.nakupPoslednaFaktura ?? null;
		const predajVo = price?.predajVo ?? null;
		const predajPcmo = price?.predajPcmo ?? null;
		const marza = nakupCennik !== null && predajVo !== null ? predajVo - nakupCennik : null;
		pripocitaj(sucty.nakupCennik, nakupCennik, p.qty);
		pripocitaj(sucty.nakupPoslednaFaktura, nakupPoslednaFaktura, p.qty);
		pripocitaj(sucty.predajVo, predajVo, p.qty);
		pripocitaj(sucty.predajPcmo, predajPcmo, p.qty);
		pripocitaj(sucty.marza, marza, p.qty);
		return {
			kod: p.kod,
			nazov: p.nazov,
			qty: p.qty,
			mj: p.mj ?? 'm',
			nakupCennik,
			nakupPoslednaFaktura,
			predajVo,
			predajPcmo,
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
	return { radky, sucty, lakovanie, zdroj: zdroj.zdroj, snapshot: readSnapshotMetaFromDb() };
}

// ---- predodpisové skladové varovanie (#448, zdroj Odoo od #599 krok 3) ----

/** Jedno skladové varovanie pred odpisom (#448): kód, ktorého sklad je nižší než požadované
 *  množstvo. Honest signál — NIE blok (appka sklad nevlastní).
 *  #451: `nazov` pridaný pre UI — výrazné varovanie s akciou „Odobrať z odpisu" musí ukázať
 *  ČO je za daným kódom, nielen číslo artiklu. */
export interface SkladVarovanie {
	kod: string;
	/** ľudsky čitateľný názov položky (z odpisu). */
	nazov: string;
	/** dostupný sklad (< požadované) — NIŽŠIA zo známych hodnôt (viď `zdroj`). */
	sklad: number;
	/** požadované množstvo (SÚČET za kód v tomto odpise). */
	mnozstvo: number;
	/** #599: odkiaľ je `sklad` — `odoo` = `stock.quant` (interné lokácie), `snapshot` = denný
	 *  Money snapshot. UI ho ukáže, aby bolo jasné, či ide o živý Odoo stav alebo dátum snapshotu. */
	zdroj: 'odoo' | 'snapshot';
}

/**
 * Predodpisové SKLADOVÉ VAROVANIE (#448) — pre položky odpisu vráti varovanie za KAŽDÝ kód, ktorého
 * sklad je `< požadované`. Presná rovnosť, neznámy sklad (kód mimo Odoo aj snapshotu, `sklad === null`
 * = Money nemá skladovú kartu, Odoo produkt nesledovaný skladom) aj nulové/záporné množstvo → žiadne
 * varovanie: appka sklad NEVLASTNÍ, záporný sklad je legitímny → tvrdý blok by dával falošné poplachy
 * (settled dizajn #448 — na rozdiel od `validateOdpisKody`, ktoré neznámy kód BLOKUJE). Množstvo sa
 * AGREGUJE za kód (Money kontroluje sklad na CELKOVÝ dopyt kódu v doklade).
 *
 * #599 krok 3 — ZDROJ skladu (ROZHODNUTÉ main 30.9. + nález na tickete):
 *   - Odoo `stock.quant` (súčet interných kvantov, `odooSkladPreKody`) je primárny zdroj.
 *   - KÝM je Money snapshot POUŽITEĽNÝ (čerstvý ≤ 7 dní, ako `validateOdpisKody`) — Money je ešte
 *     cieľ odpisu (do cutu odoo-erp 1122) — rozhoduje NIŽŠIA z hodnôt Odoo / snapshot: sonda 30.9.
 *     ukázala, že Odoo sklad Money NEzrkadlí (väčšinou vyšší o nedávnu spotrebu) a Money pri
 *     nedostatku celý doklad TICHO zahodí — čisté Odoo by také varovanie stratilo. Po cute snapshot
 *     zastará → ostane čisté Odoo, bez ďalšej zmeny kódu.
 *   - Odoo nedostupné (nenakonfigurované / výpadok / timeout 3 s) → snapshot ako pred #599 (aj
 *     zastaraný — lepší signál než žiadny); nikdy chyba, nikdy blok.
 */
export async function skladoveVarovania(
	polozky: { kod: string; nazov: string; mnozstvo: number }[]
): Promise<SkladVarovanie[]> {
	// súčet požadovaného množstva za kód (LEN kladné — nulová položka nič nežiada); Map insertion
	// order určuje poradie výstupu = deterministické podľa prvého výskytu kódu
	const dopyt = new Map<string, { mnozstvo: number; nazov: string }>();
	for (const p of polozky) {
		if (!p.kod || typeof p.mnozstvo !== 'number' || !Number.isFinite(p.mnozstvo) || p.mnozstvo <= 0)
			continue;
		const existing = dopyt.get(p.kod);
		dopyt.set(p.kod, {
			mnozstvo: (existing?.mnozstvo ?? 0) + p.mnozstvo,
			nazov: existing?.nazov ?? p.nazov
		});
	}
	if (dopyt.size === 0) return [];

	const { snapshotUsable } = snapshotPreValidaciu(); // spustí aj lazy import snapshotu
	const odoo = await odooSkladPreKody([...dopyt.keys()]);
	// snapshot sa berie, keď Odoo nie je (vždy, ako pred #599), alebo popri Odoo, kým je čerstvý
	const ajSnapshot = odoo.zdroj !== 'odoo' || snapshotUsable;
	if (odoo.zdroj !== 'odoo' && odoo.dovod === 'chyba')
		log.debug('skladové varovanie: Odoo sklad nedostupný — Money snapshot', { kody: dopyt.size });

	const out: SkladVarovanie[] = [];
	for (const [kod, { mnozstvo: rawMnozstvo, nazov }] of dopyt) {
		// zaokrúhli agregát na 3 desatinné (mm presnosť) — FP akumulácia (napr. 0,1+0,2=0,30000…4) by
		// inak spravila FALOŠNÉ varovanie pri koncepčne ROVNOM sklade (design: presná rovnosť = žiadne
		// varovanie). Vzor `round2` v `enrichPolozky` — tam sa súčty tiež zaokrúhľujú pred zobrazením.
		const mnozstvo = Math.round(rawMnozstvo * 1000) / 1000;
		const zSnapshotu = ajSnapshot ? (getPriceRow(kod)?.sklad ?? null) : null;
		// review #599: produkt, ktorý Odoo sleduje, ale nemá v ňom ŽIADNY interný kvant, je pri známom
		// Money sklade „neznámy", nie 0 — Odoo dnes Money nezrkadlí a falošné varovanie by viedlo k
		// odobratiu reálneho materiálu z odpisu. Bez Money hodnoty (po cute) ostáva Odoo 0.
		const bezKvantovAleMoneyVie =
			odoo.zdroj === 'odoo' && odoo.bezKvantov.has(kod) && zSnapshotu !== null;
		const zOdoo = odoo.zdroj === 'odoo' && !bezKvantovAleMoneyVie ? odoo.sklad.get(kod) : undefined;
		const kandidati: { sklad: number; zdroj: SkladVarovanie['zdroj'] }[] = [];
		if (zOdoo !== undefined) kandidati.push({ sklad: zOdoo, zdroj: 'odoo' });
		if (zSnapshotu !== null) kandidati.push({ sklad: zSnapshotu, zdroj: 'snapshot' });
		if (kandidati.length === 0) continue; // sklad neznámy → žiadne varovanie
		// nižšia hodnota vyhráva; pri zhode Odoo (prvé v poli — živý stav)
		const najnizsi = kandidati.reduce((a, b) => (b.sklad < a.sklad ? b : a));
		if (najnizsi.sklad < mnozstvo) out.push({ kod, nazov, mnozstvo, ...najnizsi });
		if (zOdoo !== undefined && zSnapshotu !== null && zOdoo !== zSnapshotu)
			log.debug('skladové varovanie: Odoo a Money snapshot sa líšia', {
				kod,
				odoo: zOdoo,
				snapshot: zSnapshotu
			});
	}
	return out;
}
