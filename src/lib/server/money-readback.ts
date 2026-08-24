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
		warn(`riadok ${idx} (${dlv}): neplatný „pocetPolozek" (${JSON.stringify(pocetRaw)}) — zamietnutý`);
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
	return { imported: true, reason: 'ok', rowCount: valid.length, rejectedCount: rejected, generatedAt };
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

/**
 * PLACEHOLDER (#298 RED): appka DNES po exporte NIČ neoveruje — každý LIVE odpis je „neoverený".
 * GREEN commit nahradí telo reálnou klasifikáciou proti Money DLV snapshotu.
 */
export function readbackStav(odpisLogIds: number[]): Map<number, ReadbackVysledok> {
	maybeImportDlvReadback();
	const out = new Map<number, ReadbackVysledok>();
	for (const id of odpisLogIds) out.set(id, { stav: 'caka', dovod: '', dlv: null, moneyPocet: null, riadkov: 0 });
	return out;
}
