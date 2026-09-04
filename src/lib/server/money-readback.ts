// POST-import readback z Money DB (#298, nadväzuje na #295 kontrolu A). Overuje going-forward, že
// Money REÁLNE naimportoval odoslaný odpis: existuje DLV doklad a jeho PocetPolozek == počet
// odoslaných riadkov. Nesúlad = viditeľný alarm na /odpisy, nie ticho (verdikt §3(B), Dominik:
// „keď chýba profil, neodpíše VÔBEC" — celý doklad, pritom súbor ide do DONE).
//
// TRANSPORT (viď design komentár #298): appka do Money NIKDY nepíše ANI nečíta cez sieť — číta LEN
// súborový snapshot `dlv-readback.json`, ktorý sem doniesol externý read-only producer
// `scripts/dlv-readback-snapshot.py` (beží na dev2, `montalu_ro` účet, credentials LEN tam) + rsync
// na VPS. 1:1 vzor `ceny.ts` (denný cenníkový snapshot) — žiadny mssql klient / tunel / credential
// v appka kontajneri. Reader je LAZY (mtime-gated), stav readbacku je ČISTÁ funkcia snapshotu +
// odpis_log + odpis_polozky, počítaná on-the-fly (žiadna uložená reconcile state).
import fs from 'node:fs';
import { db } from './db';
import { logger } from './log';
import { normZak, normOp } from './money';
import { formatDatumIsoSk } from '../datum';

const log = logger('readback');

const readbackPath = () => process.env.DLV_READBACK_PATH || '/data/ceny/dlv-readback.json';

/** Rozriešená cesta k DLV readback snapshotu — pre štartovací config log (hooks.server.ts, #245). */
export function dlvReadbackPath(): string {
	return readbackPath();
}

// ---- lazy import snapshotu (1:1 vzor ceny.ts maybeImportSnapshot) ----

interface DlvMetaRow {
	snapshot_generated_at: string | null;
	snapshot_file_mtime_ms: number | null;
	imported_at: string | null;
	row_count: number;
	rejected_count: number;
	window_days: number;
}

function getMetaRow(): DlvMetaRow | undefined {
	return db.prepare('SELECT * FROM money_dlv_meta WHERE id = 1').get() as DlvMetaRow | undefined;
}

interface ValidDlvRow {
	dlv: string;
	zakNorm: string;
	opNorm: string;
	datum: string | null;
	pocetPolozek: number;
	popis: string;
}

/**
 * Validuje jeden riadok DLV snapshotu. Štrukturálny problém (chýba/neplatný `dlv`, `zak` alebo
 * `pocetPolozek`) ⇒ CELÝ riadok sa zamietne (vráti `null`, zaloguje sa) — rovnaká disciplína ako
 * `ceny.ts` `validateRow`: jeden pokazený riadok nesmie zhodiť celý import. `zak`/`op` sa
 * normalizujú ROVNAKÝM `normZak`/`normOp` ako `money.ts`, aby párovanie s `odpis_log` sedelo.
 */
function validateDlvRow(raw: unknown, idx: number, warn: (m: string) => void): ValidDlvRow | null {
	if (!raw || typeof raw !== 'object') {
		warn(`riadok ${idx}: nie je objekt — zamietnutý`);
		return null;
	}
	const r = raw as Record<string, unknown>;
	const dlv = typeof r.dlv === 'string' ? r.dlv.trim() : '';
	if (!dlv) {
		warn(`riadok ${idx}: chýba/neplatný „dlv" — zamietnutý`);
		return null;
	}
	const zakRaw = typeof r.zak === 'string' ? r.zak.trim() : '';
	if (!zakRaw) {
		warn(`riadok ${idx} (${dlv}): chýba/neplatný „zak" — zamietnutý`);
		return null;
	}
	const pocetRaw = r.pocetPolozek;
	if (typeof pocetRaw !== 'number' || !Number.isFinite(pocetRaw) || pocetRaw < 0) {
		warn(
			`riadok ${idx} (${dlv}): neplatný „pocetPolozek" (${JSON.stringify(pocetRaw)}) — zamietnutý`
		);
		return null;
	}
	const datum = typeof r.datum === 'string' && r.datum.trim() ? r.datum.trim() : null;
	const opRaw = typeof r.op === 'string' ? r.op.trim() : '';
	const popis = typeof r.popis === 'string' ? r.popis.trim() : '';
	return {
		dlv,
		zakNorm: normZak(zakRaw),
		opNorm: opRaw ? normOp(opRaw) : '',
		datum,
		pocetPolozek: Math.trunc(pocetRaw),
		popis
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
 * LAZY import DLV readback snapshotu: no-op, keď súbor chýba alebo sa mtime nezmenil (lacná
 * `fs.statSync` na KAŽDÉ volanie — appka je jeden proces). Zlý riadok sa preskočí + zaloguje,
 * NIKDY nezhodí celý import. 1:1 vzor `ceny.ts maybeImportSnapshot`.
 */
export function maybeImportDlvReadback(): ImportResult {
	const p = readbackPath();
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
		log.error('čítanie DLV readback snapshotu zlyhalo', { path: p, error: e });
		return { imported: false, reason: 'read-error' };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		log.error('JSON parse DLV readback snapshotu zlyhal', { path: p, error: e });
		return { imported: false, reason: 'parse-error' };
	}
	const file = (parsed ?? {}) as { generatedAt?: unknown; rows?: unknown; windowDays?: unknown };
	const generatedAt = typeof file.generatedAt === 'string' ? file.generatedAt : null;
	// #298 review: producerovo DLV okno (dni) — app si podľa neho zaklampuje readback okno. 0 = neznáme.
	const windowDays =
		typeof file.windowDays === 'number' && Number.isFinite(file.windowDays) && file.windowDays > 0
			? Math.trunc(file.windowDays)
			: 0;
	const rowsRaw = Array.isArray(file.rows) ? file.rows : [];

	let rejected = 0;
	const valid: ValidDlvRow[] = [];
	rowsRaw.forEach((r, i) => {
		const row = validateDlvRow(r, i, (m) => log.warn(`dlv-readback: ${m}`));
		if (!row) {
			rejected++;
			return;
		}
		valid.push(row);
	});

	// snapshot je AUTORITATÍVNY zoznam nedávnych DLV — starý obsah zahoď, nahraď čerstvým (na rozdiel
	// od `material_prices`, ktorý je UPSERT bez mazania: tam kód nikdy nezmizne, tu DLV window rotuje).
	const insert = db.prepare(`
		INSERT INTO money_dlv (dlv, zak_norm, op_norm, datum, pocet_polozek, popis, updated_at)
		VALUES (@dlv, @zakNorm, @opNorm, @datum, @pocetPolozek, @popis, datetime('now'))
		ON CONFLICT(dlv) DO UPDATE SET
			zak_norm = excluded.zak_norm,
			op_norm = excluded.op_norm,
			datum = excluded.datum,
			pocet_polozek = excluded.pocet_polozek,
			popis = excluded.popis,
			updated_at = excluded.updated_at
	`);
	const upsertMeta = db.prepare(`
		INSERT INTO money_dlv_meta (id, snapshot_generated_at, snapshot_file_mtime_ms, imported_at, row_count, rejected_count, window_days)
		VALUES (1, ?, ?, datetime('now'), ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			snapshot_generated_at = excluded.snapshot_generated_at,
			snapshot_file_mtime_ms = excluded.snapshot_file_mtime_ms,
			imported_at = excluded.imported_at,
			row_count = excluded.row_count,
			rejected_count = excluded.rejected_count,
			window_days = excluded.window_days
	`);
	db.transaction(() => {
		db.prepare('DELETE FROM money_dlv').run();
		for (const row of valid) insert.run(row);
		upsertMeta.run(generatedAt, stat.mtimeMs, valid.length, rejected, windowDays);
	})();

	log.info('DLV readback snapshot naimportovaný', { rows: valid.length, rejected, path: p });
	return {
		imported: true,
		reason: 'ok',
		rowCount: valid.length,
		rejectedCount: rejected,
		generatedAt
	};
}

export interface DlvReadbackMeta {
	generatedAt: string | null;
	importedAt: string | null;
	/** dní od `generatedAt` po TERAZ; `null` keď snapshot ešte nikdy nebol naimportovaný */
	daysOld: number | null;
	rowCount: number;
	rejectedCount: number;
}

function readMetaFromDb(): DlvReadbackMeta {
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

/** Vek/stav aktuálne naimportovaného DLV readback snapshotu — pre UI hlášku. Vždy najprv skúsi
 *  lazy import (čerstvejší súbor). */
export function getDlvReadbackMeta(): DlvReadbackMeta {
	maybeImportDlvReadback();
	return readMetaFromDb();
}

// ---- on-the-fly stav readbacku ----

/** Stav overenia jedného LIVE odpisu proti Money DLV snapshotu.
 *  - `ok` = DLV existuje a `PocetPolozek` sedí (v pásme počet_nenulových..počet_všetkých).
 *  - `nesulad` = ALARM: buď DLV chýba (`chyba-doklad` — Money doklad ticho zahodil), alebo existuje,
 *    ale `PocetPolozek` je nižší než počet reálnych (nenulových) riadkov (`pocet` — riadok preskočený).
 *  - `caka` = zatiaľ sa nedá overiť (snapshot chýba / je starší než odpis / odpis je mimo readback
 *    okna / odpis nemá položkové dáta / odpis je PARKOVANÝ `caka=1` a Money ho ešte neimportoval) →
 *    v UI „neoverené", NIKDY neblokuje export ani falošne nealarmuje. */
export type ReadbackStav = 'ok' | 'nesulad' | 'caka';
export type ReadbackDovod = '' | 'pocet' | 'chyba-doklad';

export interface ReadbackVysledok {
	stav: ReadbackStav;
	dovod: ReadbackDovod;
	/** napárovaný DLV (`ok`/`pocet`); `null` keď žiadny relevantný DLV. */
	dlv: string | null;
	/** pozorovaný `PocetPolozek` z Money (`ok`/`pocet`); `null` inak. */
	moneyPocet: number | null;
	/** počet odoslaných riadkov (COUNT odpis_polozky). */
	riadkov: number;
}

/** Snapshot musí byť generovaný aspoň o toľko po odoslaní, aby sme „chýbajúci DLV" vyhlásili za
 *  Money skip (a nie „ešte nedobehol import"). Money watcher importuje v sekundách, toto je rezerva. */
const GRACE_S = 10 * 60;
/** DLV, ktorého kalendárny DÁTUM je viac než toľko KALENDÁRNYCH dní pred kalendárnym dňom odoslania
 *  (Europe/Bratislava), sa NEpočíta k tomuto odpisu — je to starší doklad (napr. predošlé duplicitné
 *  odoslanie). Porovnanie je DATE-ONLY aware: Money `datum` (`DatumVystaveni`) je date-only — polnoc
 *  kalendárneho dňa. Predošlá sekundová tolerancia (12 h) proti mid-day odoslaniu zamietla reálny
 *  doklad TOHO ISTÉHO dňa (odoslané 12:28 − polnoc = 12h28m > 12h; #308). 1 deň kryje TZ posun,
 *  near-midnight hranicu aj drobný clock-skew; stále zamietne reálne staršie doklady (2+ dni). */
const DATUM_TOL_DAYS = 1;
/** Odpis starší než toto sa neoveruje (`caka`) — producer číta LEN nedávne DLV okno, takže „žiadny
 *  DLV" pri starom odpise NIE JE dôkaz skipu. Musí byť ≤ producerovo DLV okno. */
const READBACK_WINDOW_S = 30 * 24 * 60 * 60;

/** „YYYY-MM-DD" → celočíselné číslo kalendárneho dňa (dní od epochy). Kalendárny dátum bez TZ —
 *  Money `datum` UŽ JE bratislavský kalendárny deň (`.slice(0,10)` odreže prípadný čas). */
function isoDayNum(isoDate: string): number {
	const [y, m, d] = isoDate.slice(0, 10).split('-');
	return Math.floor(Date.UTC(Number(y), Number(m) - 1, Number(d)) / 86400000);
}

/** Bratislavský kalendárny deň odpisu z jeho UTC epoch (`createdEpoch` zo SQL `strftime('%s')`).
 *  Cez audítovaný `formatDatumIsoSk` (Intl + IANA zóna, DST-safe) — NIKDY `Date.parse` na SQLite
 *  space-oddelenom čase (V8 by ho bral ako lokálny; #298/#114 pasca). */
function bratDayNum(epochS: number): number {
	return isoDayNum(formatDatumIsoSk(new Date(epochS * 1000).toISOString()));
}

interface OdpisRow {
	id: number;
	zakNorm: string;
	opNorm: string;
	/** #298 review: 1 = „čaká na materiál" odpis PARKOVANÝ v `NA ODPIS/<subdir>` — Money ho NEIMPORTUJE,
	 *  kým ho človek ručne nepresunie do dlv-import. Chýbajúci DLV pri `caka=1` NIE je skip ⇒ `caka`. */
	caka: number;
	/** #299: 1 = appka DETEKOVALA ručný presun tohto parkovaného odpisu zo staging do Money importu
	 *  (`odpis_log.presunute_at` nie je NULL). Presunutý odpis UŽ nie je parkovaný → VSTÚPI do matchingu
	 *  (reálny Money verdikt), takže výluka platí len pre `caka=1 AND presunute=0`. */
	presunute: number;
	/** #299: epoch (s) DETEKCIE presunu (`presunute_at`), alebo NULL keď nepresunutý. Pre presunutý
	 *  odpis sa `chyba-doklad`/okno merajú od PRESUNU (nie od vytvorenia) — súbor mohol doraziť do Money
	 *  až presunom, takže starý parkovaný odpis presunutý DNES by inak dal falošný ⛔ (snapshot ešte
	 *  nemá jeho DLV) a &gt;30d-parkovaný by nikdy nealarmoval. Viď `refEpoch` vo `priradGroup`. */
	presunuteEpoch: number | null;
	createdEpoch: number;
	/** bratislavský kalendárny deň odoslania (dní od epochy) — pre date-only porovnanie s DLV datum. */
	bratDay: number;
	vsetky: number;
	nenulove: number;
}

interface DlvCand {
	dlv: string;
	opNorm: string;
	pocet: number;
	/** kalendárny deň Money `datum` (date-only, dní od epochy); `null` keď DLV nemá datum. */
	datumDay: number | null;
}

const CAKA_VYSLEDOK = (o: OdpisRow): ReadbackVysledok => ({
	stav: 'caka',
	dovod: '',
	dlv: null,
	moneyPocet: null,
	riadkov: o.vsetky
});

/**
 * Priradí Money DLV k odpisom JEDNEJ zákazky (`zak_norm`) EXKLUZÍVNE — každý DLV overí NAJVIAC JEDEN
 * odpis (#298 review 🟡). Bez toho by jeden prežitý DLV validoval viacero odpisov tej istej zákazky
 * (napr. zasklenia+pergola+bazén zdieľajú zak+op, alebo „Uvoľniť"+re-send) a tichý drop by prešiel
 * ako `ok`. Dvojfázový greedy: NAJPRV napáruj presné (v pásme) doklady, POTOM zvyšné; odpis bez
 * dokladu = alarm `chyba-doklad` LEN keď Money mal čas a odpis je v okne. Parkované (`caka=1`) odpisy
 * sa z matchingu VYLUČUJÚ úplne (dostanú `caka`) — appka ich do Money neposlala (#308).
 * POZN.: úplná per-send exkluzivita potrebuje per-send diskriminátor v Money doklade (napr. názov
 * súboru) — bez neho ostáva (b) „re-send rovnakého obsahu" slabé miesto (UNVERIFIED, provisioning #298).
 */
function priradGroup(
	group: OdpisRow[],
	cands: DlvCand[],
	genEpoch: number | null,
	windowS: number
): Map<number, ReadbackVysledok> {
	const res = new Map<number, ReadbackVysledok>();
	const claimed = new Set<string>();
	// PARKOVANÝ caka=1 odpis NEVSTUPUJE do matchingu (#308): appka ho do Money zámerne neposlala; do
	// dlv-import ho môže presunúť LEN človek ručne. Párovanie len po zak+počte-v-pásme je preto
	// nespoľahlivé: cross-match na cudzí doklad → falošný `pocet` (živý ZAK2026450), a prípadný claim by
	// ukradol doklad legit súrodencovi. Vždy „neoverené" (`caka`) — nikdy alarm ani claim.
	// #299 VÝNIMKA: keď appka DETEKOVALA ručný presun (`presunute=1`), odpis UŽ je reálne v Money →
	// VSTÚPI do matchingu (dostane reálny verdikt namiesto trvalého ⏳). Výluka teda platí len pre
	// caka=1 A ešte-nepresunutý (`presunute=0`).
	const active: OdpisRow[] = [];
	for (const o of group) {
		if (o.caka === 1 && o.presunute === 0) res.set(o.id, CAKA_VYSLEDOK(o));
		else active.push(o);
	}
	// kompatibilné NEzabraté DLV: OP sedí (ak ho oboje nesie) + datum nie je zjavne spred odoslania.
	// Dátum sa porovnáva ako KALENDÁRNY deň (Money `datum` je date-only, polnoc), nie sekundy (#308).
	const compat = (o: OdpisRow): DlvCand[] =>
		cands.filter(
			(c) =>
				!claimed.has(c.dlv) &&
				(!c.opNorm || !o.opNorm || c.opNorm === o.opNorm) &&
				(c.datumDay === null || c.datumDay >= o.bratDay - DATUM_TOL_DAYS)
		);
	// staršie odpisy páruj skôr (staršie odoslanie ~ starší doklad) — deterministické priradenie
	const sorted = [...active].sort((a, b) => a.createdEpoch - b.createdEpoch);

	// FÁZA 1: overiteľné odpisy s DOKLADOM V PÁSME [nenulove..vsetky] (Money môže/nemusí rátať nulové
	// riadky). Najvyšší v pásme = presná zhoda s počtom_všetkých, keď taký doklad existuje.
	for (const o of sorted) {
		if (o.vsetky === 0 || genEpoch === null) continue; // rozhodne sa v FÁZE 2 ako caka
		const vBand = compat(o).filter((c) => c.pocet >= o.nenulove && c.pocet <= o.vsetky);
		if (vBand.length > 0) {
			const pick = vBand.reduce((a, b) => (b.pocet > a.pocet ? b : a));
			claimed.add(pick.dlv);
			res.set(o.id, {
				stav: 'ok',
				dovod: '',
				dlv: pick.dlv,
				moneyPocet: pick.pocet,
				riadkov: o.vsetky
			});
		}
	}

	// FÁZA 2: zvyšné AKTÍVNE odpisy (parkované caka=1 sú už vyriešené vyššie ako `caka`). Zostal
	// kompatibilný (mimo pásma) doklad ⇒ počet nesedí (ALARM `pocet`). Žiadny doklad ⇒ chýbajúci
	// doklad (ALARM `chyba-doklad`) LEN keď Money mal čas + odpis je v okne; inak „neoverené" (`caka`).
	for (const o of sorted) {
		if (res.has(o.id)) continue;
		if (o.vsetky === 0 || genEpoch === null) {
			res.set(o.id, CAKA_VYSLEDOK(o));
			continue;
		}
		const rest = compat(o);
		if (rest.length > 0) {
			const pick = rest.reduce((a, b) => (b.pocet > a.pocet ? b : a));
			claimed.add(pick.dlv);
			res.set(o.id, {
				stav: 'nesulad',
				dovod: 'pocet',
				dlv: pick.dlv,
				moneyPocet: pick.pocet,
				riadkov: o.vsetky
			});
			continue;
		}
		// #299: pre PRESUNUTÝ odpis meraj „Money mal čas" + „v okne" od PRESUNU, nie od vytvorenia —
		// súbor mohol doraziť do Money až ručným presunom, takže starý parkovaný odpis presunutý dnes by
		// inak dal falošný `chyba-doklad` (snapshot ešte nemá jeho čerstvý DLV) a >30d-parkovaný presun by
		// vypadol z okna a nikdy nealarmoval. `max(created, presunute)` = presunute pre presunutý (presun
		// je vždy po vytvorení); pre nepresunutý ostáva createdEpoch. Nepresunutý caka=1 sa sem nedostane.
		const refEpoch =
			o.presunute === 1 && o.presunuteEpoch !== null
				? Math.max(o.createdEpoch, o.presunuteEpoch)
				: o.createdEpoch;
		const moneyMalCas = genEpoch > refEpoch + GRACE_S;
		// okno sa meria od GENEROVANIA snapshotu (producer číta DLV okno relatívne k svojmu behu),
		// nie od „teraz" — pri zastaranom snapshote by inak odpis vypadol z okna nesprávne (#298 review).
		const vOkne = refEpoch >= genEpoch - windowS;
		if (moneyMalCas && vOkne) {
			res.set(o.id, {
				stav: 'nesulad',
				dovod: 'chyba-doklad',
				dlv: null,
				moneyPocet: null,
				riadkov: o.vsetky
			});
		} else {
			res.set(o.id, CAKA_VYSLEDOK(o));
		}
	}
	return res;
}

/**
 * Stav overenia LIVE odpisov proti Money DLV snapshotu — ČISTÁ funkcia (odpis_log + odpis_polozky +
 * money_dlv), počítaná on-the-fly (žiadna uložená reconcile state). Najprv LAZY refresh snapshotu.
 * Vracia záznam LEN pre LIVE odpisy z `odpisLogIds` (TEST odpisy do Money nikdy nešli → bez záznamu).
 * Odpisy zoskupí po `zak_norm` a priradí DLV EXKLUZÍVNE (jeden DLV = najviac jeden odpis, viď
 * `priradGroup`). Všetka časová matematika je v SQL cez `strftime('%s', …)` (SQLite berie uložený
 * `datetime('now')` ako UTC) — vyhýbame sa `Date.parse` na space-oddelenom čase (V8 by ho bral ako lokálny).
 */
export function readbackStav(odpisLogIds: number[]): Map<number, ReadbackVysledok> {
	maybeImportDlvReadback();
	const out = new Map<number, ReadbackVysledok>();
	if (odpisLogIds.length === 0) return out;

	const ph = odpisLogIds.map(() => '?').join(',');
	const odpisy = (
		db
			.prepare(
				`SELECT l.id AS id, l.zak_norm AS zakNorm, l.op_norm AS opNorm, l.caka AS caka,
				CASE WHEN l.presunute_at IS NOT NULL THEN 1 ELSE 0 END AS presunute,
				CAST(strftime('%s', l.presunute_at) AS INTEGER) AS presunuteEpoch,
				CAST(strftime('%s', l.created_at) AS INTEGER) AS createdEpoch,
				(SELECT COUNT(*) FROM odpis_polozky p WHERE p.odpis_log_id = l.id) AS vsetky,
				(SELECT COUNT(*) FROM odpis_polozky p WHERE p.odpis_log_id = l.id AND p.qty != 0) AS nenulove
			 FROM odpis_log l
			 WHERE l.live = 1 AND l.id IN (${ph})`
			)
			.all(...odpisLogIds) as Omit<OdpisRow, 'bratDay'>[]
	).map((o) => ({ ...o, bratDay: bratDayNum(o.createdEpoch) }));
	if (odpisy.length === 0) return out;

	const genRow = db
		.prepare(
			`SELECT CAST(strftime('%s', snapshot_generated_at) AS INTEGER) AS gen, window_days AS windowDays
			 FROM money_dlv_meta WHERE id = 1 AND snapshot_generated_at IS NOT NULL`
		)
		.get() as { gen: number | null; windowDays: number } | undefined;
	const genEpoch = genRow?.gen ?? null;
	// zaklampuj readback okno na producerovo (keď ho pozná) — kratšie producer okno inak spôsobí
	// falošné „chýba doklad" pri odpisoch, ktoré producer už nečíta (#298 review).
	const prodWindowS =
		genRow && genRow.windowDays > 0 ? genRow.windowDays * 86400 : READBACK_WINDOW_S;
	const windowS = Math.min(READBACK_WINDOW_S, prodWindowS);

	// datum sa berie RAW (date-only string) a prevedie na kalendárny deň v JS (`isoDayNum`) — porovnanie
	// je date-only aware (Money `datum` je polnoc kalendárneho dňa), nie sekundové proti mid-day (#308).
	const candStmt = db.prepare(
		`SELECT dlv, op_norm AS opNorm, pocet_polozek AS pocet, datum
		 FROM money_dlv WHERE zak_norm = ?`
	);
	// zoskup odpisy po zákazke — DLV sa priraďujú EXKLUZÍVNE v rámci jednej zákazky
	const byZak = new Map<string, OdpisRow[]>();
	for (const o of odpisy) {
		const g = byZak.get(o.zakNorm);
		if (g) g.push(o);
		else byZak.set(o.zakNorm, [o]);
	}
	for (const [zak, group] of byZak) {
		const cands = (
			candStmt.all(zak) as { dlv: string; opNorm: string; pocet: number; datum: string | null }[]
		).map((c) => {
			// NEplatný datum (producer-side korupcia, napr. „garbage" / nezarovnaný „2026-8-1") → NaN.
			// Degraduj ho na `null` = BEZPEČNÁ „dátum neznámy → kompatibilné" cesta (rovnako ako chýbajúci
			// datum), nie na tiché vylúčenie DLV (NaN >= x je vždy false → falošný „chýba doklad", presný
			// opak cieľa #308). Starý strftime('%s') tiež degradoval na NULL/kompatibilné (#308 review 🟡).
			const day = c.datum ? isoDayNum(c.datum) : NaN;
			return {
				dlv: c.dlv,
				opNorm: c.opNorm,
				pocet: c.pocet,
				datumDay: Number.isFinite(day) ? day : null
			};
		});
		for (const [id, r] of priradGroup(group, cands, genEpoch, windowS)) out.set(id, r);
	}
	return out;
}

// ---- súhrn readback alarmov pre /odpisy banner (#448) ----

/** Jeden LIVE odpis, ktorý Money podľa readbacku NEnaimportoval (alarm) — pre súhrnný červený banner
 *  na vrchu /odpisy. `dovod`: `chyba-doklad` (Money doklad chýba) alebo `pocet` (počet položiek
 *  nesedí). */
export interface ReadbackAlarm {
	id: number;
	zak: string;
	op: string;
	dovod: ReadbackDovod;
}

export interface ReadbackAlarmySuhrn {
	/** počet LIVE odpisov s readback alarmom (`nesulad`). */
	pocet: number;
	polozky: ReadbackAlarm[];
}

/**
 * Agreguje UŽ vypočítané `readbackStav()` výsledky do súhrnu pre červený banner na vrchu /odpisy
 * (#448). Alarm = LIVE odpis so `stav === 'nesulad'` (Money doklad chýba / počet nesedí). `ok`,
 * `caka` (vrátane parkovaných `caka=1` a odpisov mimo readback okna) aj non-live (do Money nešli) sa
 * VYLUČUJÚ. Čistá funkcia nad tým, čo `/odpisy` load už načítal — žiadny nový dotaz do DB, banner sa
 * vykreslí SSR pri načítaní stránky (nie až po scrollnutí na konkrétny riadok, Patrikov #448 problém).
 */
export function agregujReadbackAlarmy(
	odpisy: {
		id: number;
		zak: string;
		op: string;
		live: boolean;
		readback: ReadbackVysledok | null;
	}[]
): ReadbackAlarmySuhrn {
	const polozky: ReadbackAlarm[] = [];
	for (const o of odpisy) {
		if (o.live && o.readback && o.readback.stav === 'nesulad') {
			polozky.push({ id: o.id, zak: o.zak, op: o.op, dovod: o.readback.dovod });
		}
	}
	return { pocet: polozky.length, polozky };
}
