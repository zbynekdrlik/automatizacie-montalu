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
	const file = (parsed ?? {}) as { generatedAt?: unknown; rows?: unknown };
	const generatedAt = typeof file.generatedAt === 'string' ? file.generatedAt : null;
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
		INSERT INTO money_dlv_meta (id, snapshot_generated_at, snapshot_file_mtime_ms, imported_at, row_count, rejected_count)
		VALUES (1, ?, ?, datetime('now'), ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			snapshot_generated_at = excluded.snapshot_generated_at,
			snapshot_file_mtime_ms = excluded.snapshot_file_mtime_ms,
			imported_at = excluded.imported_at,
			row_count = excluded.row_count,
			rejected_count = excluded.rejected_count
	`);
	db.transaction(() => {
		db.prepare('DELETE FROM money_dlv').run();
		for (const row of valid) insert.run(row);
		upsertMeta.run(generatedAt, stat.mtimeMs, valid.length, rejected);
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
 *    okna / odpis nemá položkové dáta) → v UI „neoverené", NIKDY neblokuje export. */
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
/** DLV s `datum` staršou než (odoslanie − táto tolerancia) sa NEpočíta k tomuto odpisu — je to
 *  starší doklad (napr. predošlé duplicitné odoslanie). Tolerancia kryje TZ posun (verdikt: konštantný
 *  2 h) + drobný clock-skew, aby doklad tesne pred/po odoslaní stále napároval. */
const DATUM_TOL_S = 12 * 60 * 60;
/** Odpis starší než toto sa neoveruje (`caka`) — producer číta LEN nedávne DLV okno, takže „žiadny
 *  DLV" pri starom odpise NIE JE dôkaz skipu. Musí byť ≤ producerovo DLV okno. */
const READBACK_WINDOW_S = 30 * 24 * 60 * 60;

interface OdpisRow {
	id: number;
	zakNorm: string;
	opNorm: string;
	createdEpoch: number;
	vsetky: number;
	nenulove: number;
}

interface DlvCand {
	dlv: string;
	opNorm: string;
	pocet: number;
	datumEpoch: number | null;
}

function klasifikuj(
	o: OdpisRow,
	cands: DlvCand[],
	genEpoch: number | null,
	nowEpoch: number
): ReadbackVysledok {
	const base = { dlv: null, moneyPocet: null, riadkov: o.vsetky } as const;
	// odpis bez položiek (pred #154) alebo bez použiteľného snapshotu ⇒ nedá sa overiť
	if (o.vsetky === 0 || genEpoch === null) return { stav: 'caka', dovod: '', ...base };

	// relevantné DLV: OP kompatibilné (ak ho oboje nesie) + datum nie je zjavne spred odoslania
	const rel = cands.filter((c) => {
		const opOk = !c.opNorm || !o.opNorm || c.opNorm === o.opNorm;
		const datumOk = c.datumEpoch === null || c.datumEpoch >= o.createdEpoch - DATUM_TOL_S;
		return opOk && datumOk;
	});

	if (rel.length > 0) {
		// pásmo [počet_nenulových .. počet_všetkých]: Money môže (ale nemusí) rátať nulové riadky.
		// `reduce` (bez init) na neprázdnom poli vráti prvok (nie undefined) — žiadny indexový prístup.
		const vBand = rel.filter((c) => c.pocet >= o.nenulove && c.pocet <= o.vsetky);
		if (vBand.length > 0) {
			// najvyšší v pásme = presná zhoda s počtom_všetkých, keď taký doklad existuje
			const pick = vBand.reduce((a, b) => (b.pocet > a.pocet ? b : a));
			return { stav: 'ok', dovod: '', dlv: pick.dlv, moneyPocet: pick.pocet, riadkov: o.vsetky };
		}
		// DLV existuje, ale počet nesedí (reálny riadok preskočený / doklad zlúčený) ⇒ ALARM
		const pick = rel.reduce((a, b) => (b.pocet > a.pocet ? b : a));
		return {
			stav: 'nesulad',
			dovod: 'pocet',
			dlv: pick.dlv,
			moneyPocet: pick.pocet,
			riadkov: o.vsetky
		};
	}

	// žiadny relevantný DLV: alarm LEN keď Money mal čas (snapshot čerstvejší než odoslanie+grace) A
	// odpis je v readback okne (producer ho reálne číta) — inak „neoverené", nikdy falošný alarm
	const moneyMalCas = genEpoch > o.createdEpoch + GRACE_S;
	const vOkne = o.createdEpoch >= nowEpoch - READBACK_WINDOW_S;
	if (moneyMalCas && vOkne) return { stav: 'nesulad', dovod: 'chyba-doklad', ...base };
	return { stav: 'caka', dovod: '', ...base };
}

/**
 * Stav overenia LIVE odpisov proti Money DLV snapshotu — ČISTÁ funkcia (odpis_log + odpis_polozky +
 * money_dlv), počítaná on-the-fly (žiadna uložená reconcile state). Najprv LAZY refresh snapshotu.
 * Vracia záznam LEN pre LIVE odpisy z `odpisLogIds` (TEST odpisy do Money nikdy nešli → bez záznamu).
 * Všetka časová matematika je v SQL cez `strftime('%s', …)` (SQLite berie uložený `datetime('now')`
 * ako UTC) — vyhýbame sa `Date.parse` na space-oddelenom čase (V8 by ho bral ako lokálny).
 */
export function readbackStav(odpisLogIds: number[]): Map<number, ReadbackVysledok> {
	maybeImportDlvReadback();
	const out = new Map<number, ReadbackVysledok>();
	if (odpisLogIds.length === 0) return out;

	const ph = odpisLogIds.map(() => '?').join(',');
	const odpisy = db
		.prepare(
			`SELECT l.id AS id, l.zak_norm AS zakNorm, l.op_norm AS opNorm,
				CAST(strftime('%s', l.created_at) AS INTEGER) AS createdEpoch,
				(SELECT COUNT(*) FROM odpis_polozky p WHERE p.odpis_log_id = l.id) AS vsetky,
				(SELECT COUNT(*) FROM odpis_polozky p WHERE p.odpis_log_id = l.id AND p.qty != 0) AS nenulove
			 FROM odpis_log l
			 WHERE l.live = 1 AND l.id IN (${ph})`
		)
		.all(...odpisLogIds) as OdpisRow[];
	if (odpisy.length === 0) return out;

	const genRow = db
		.prepare(
			`SELECT CAST(strftime('%s', snapshot_generated_at) AS INTEGER) AS gen
			 FROM money_dlv_meta WHERE id = 1 AND snapshot_generated_at IS NOT NULL`
		)
		.get() as { gen: number | null } | undefined;
	const genEpoch = genRow?.gen ?? null;
	const nowEpoch = (
		db.prepare("SELECT CAST(strftime('%s','now') AS INTEGER) AS now").get() as {
			now: number;
		}
	).now;

	const candStmt = db.prepare(
		`SELECT dlv, op_norm AS opNorm, pocet_polozek AS pocet,
			CASE WHEN datum IS NULL THEN NULL ELSE CAST(strftime('%s', datum) AS INTEGER) END AS datumEpoch
		 FROM money_dlv WHERE zak_norm = ?`
	);
	for (const o of odpisy) {
		const cands = candStmt.all(o.zakNorm) as DlvCand[];
		out.set(o.id, klasifikuj(o, cands, genEpoch, nowEpoch));
	}
	return out;
}
