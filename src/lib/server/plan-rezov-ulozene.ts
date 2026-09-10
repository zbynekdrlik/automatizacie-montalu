// #505: Plán rezov — CRUD pre uložené plány (vstupná tabuľka + nastavenia).
// Money-NEUTRÁLNE (žiaden odpis, žiadny zápis do Money — externý nákup).
// Vzor: objednavka-skla.ts (prepared statements, typed rows, logger).
import { db } from './db';
import { logger } from './log';

const log = logger('plan-rezov-ulozene');

// ---- Typy -------------------------------------------------------------------------

/** Uložený plán rezov (bez rekomputovaného výsledku — ten sa dopočíta pri otvorení). */
export interface UlozenyPlan {
	id: number;
	nazov: string;
	zak: string;
	cadText: string;
	dlzkaTyce: number;
	reznaMedzera: number;
	createdAt: string;
	createdBy: string;
}

/** Riadok zoznamu (bez cadText — ten je potenciálne veľký). */
export interface UlozenyPlanPrehlad {
	id: number;
	nazov: string;
	zak: string;
	dlzkaTyce: number;
	reznaMedzera: number;
	createdAt: string;
	createdBy: string;
}

// ---- Vstup -------------------------------------------------------------------------

export interface NovyPlan {
	nazov: string;
	zak?: string;
	cadText: string;
	dlzkaTyce: number;
	reznaMedzera: number;
	createdBy: string;
}

// ---- CRUD --------------------------------------------------------------------------

const stmtInsert = db.prepare(`
	INSERT INTO plan_rezov_ulozene
		(nazov, zak, cad_text, dlzka_tyce, rezna_medzera, created_by)
	VALUES (?, ?, ?, ?, ?, ?)
`);

export function ulozPlan(p: NovyPlan): number {
	const r = stmtInsert.run(
		p.nazov,
		p.zak ?? '',
		p.cadText,
		p.dlzkaTyce,
		p.reznaMedzera,
		p.createdBy
	);
	log.info('plan ulozeny', { id: r.lastInsertRowid, nazov: p.nazov, zak: p.zak ?? '' });
	return Number(r.lastInsertRowid);
}

const stmtList = db.prepare(`
	SELECT id, nazov, zak, dlzka_tyce, rezna_medzera, created_at, created_by
	FROM plan_rezov_ulozene
	ORDER BY created_at DESC, id DESC
`);

interface PlanRow {
	id: number;
	nazov: string;
	zak: string;
	cad_text?: string;
	dlzka_tyce: number;
	rezna_medzera: number;
	created_at: string;
	created_by: string;
}

export function listPlany(): UlozenyPlanPrehlad[] {
	const rows = stmtList.all() as PlanRow[];
	return rows.map((r) => ({
		id: r.id,
		nazov: r.nazov,
		zak: r.zak,
		dlzkaTyce: r.dlzka_tyce,
		reznaMedzera: r.rezna_medzera,
		createdAt: r.created_at,
		createdBy: r.created_by
	}));
}

const stmtGet = db.prepare(`
	SELECT id, nazov, zak, cad_text, dlzka_tyce, rezna_medzera, created_at, created_by
	FROM plan_rezov_ulozene
	WHERE id = ?
`);

export function getPlan(id: number): UlozenyPlan | null {
	const r = stmtGet.get(id) as (PlanRow & { cad_text: string }) | undefined;
	if (!r) return null;
	return {
		id: r.id,
		nazov: r.nazov,
		zak: r.zak,
		cadText: r.cad_text,
		dlzkaTyce: r.dlzka_tyce,
		reznaMedzera: r.rezna_medzera,
		createdAt: r.created_at,
		createdBy: r.created_by
	};
}

const stmtDelete = db.prepare('DELETE FROM plan_rezov_ulozene WHERE id = ?');

export function zmazPlan(id: number): void {
	stmtDelete.run(id);
	log.info('plan zmazany', { id });
}
