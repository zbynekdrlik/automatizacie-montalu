// #496: Objednávka skla podklad — CRUD pre sklové položky zákazky + prílohy (atyp súbory).
// Money-NEUTRÁLNE (objednávka u dodávateľa skla, nie Money odpis).
// Handoff kontrakt pre Odoo subdev: číta z objednavka_skla + objednavka_skla_subory.
import { db } from './db';
import { normZak } from './money';
import { logger } from './log';

const log = logger('objednavka-skla');

// ---- Typy (handoff kontrakt) ----------------------------------------------------------

/** Jedna sklová položka objednávky. Pre pravouhlé sklo: sirka_mm × vyska_mm.
 *  Pre šikmý FIX (lichobežník): sirka_mm × v_lavo_mm / v_pravo_mm. */
export interface SkloPolozka {
	id: number;
	zak: string;
	zakNorm: string;
	op: string;
	modul: string;
	popis: string;
	sirkaMm: number;
	vyskaMm: number | null;
	vLavoMm: number | null;
	vPravoMm: number | null;
	pocet: number;
	typSkla: string;
	sikmy: boolean;
	m2: number | null;
	rezim: 'rozmery' | 'atyp';
	createdAt: string;
	createdBy: string;
}

/** Príloha (PDF/DXF/iný) k atyp položke. */
export interface SkloSubor {
	id: number;
	polozkaId: number;
	nazov: string;
	typ: string;
	velkost: number;
	createdAt: string;
}

// ---- Vstup ----------------------------------------------------------------------------

export interface NoveSklo {
	zak: string;
	op?: string;
	modul: string;
	popis: string;
	sirkaMm: number;
	vyskaMm?: number | null;
	vLavoMm?: number | null;
	vPravoMm?: number | null;
	pocet: number;
	typSkla: string;
	sikmy?: boolean;
	m2?: number | null;
	createdBy: string;
}

// Max veľkosť prílohy: 10 MB
export const MAX_SUBOR_VELKOST = 10 * 1024 * 1024;

// ---- CRUD -----------------------------------------------------------------------------

const stmtInsert = db.prepare(`
	INSERT INTO objednavka_skla
		(zak, zak_norm, op, modul, popis, sirka_mm, vyska_mm, v_lavo_mm, v_pravo_mm,
		 pocet, typ_skla, sikmy, m2, rezim, created_by)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rozmery', ?)
`);

export function pridajSklo(s: NoveSklo): number {
	const r = stmtInsert.run(
		s.zak,
		normZak(s.zak),
		s.op ?? '',
		s.modul,
		s.popis,
		s.sirkaMm,
		s.vyskaMm ?? null,
		s.vLavoMm ?? null,
		s.vPravoMm ?? null,
		s.pocet,
		s.typSkla,
		s.sikmy ? 1 : 0,
		s.m2 ?? null,
		s.createdBy
	);
	log.info('sklo polozka pridana', { id: r.lastInsertRowid, zak: s.zak, modul: s.modul });
	return Number(r.lastInsertRowid);
}

/** Hromadné pridanie skiel (po výpočte modulu). Vracia počet vložených. */
export function pridajSklaHromadne(polozky: NoveSklo[]): number {
	let count = 0;
	db.transaction(() => {
		for (const s of polozky) {
			pridajSklo(s);
			count++;
		}
	})();
	return count;
}

const stmtListPre = db.prepare(`
	SELECT id, zak, zak_norm, op, modul, popis, sirka_mm, vyska_mm,
	       v_lavo_mm, v_pravo_mm, pocet, typ_skla, sikmy, m2, rezim,
	       created_at, created_by
	FROM objednavka_skla
	WHERE zak_norm = ? OR upper(replace(zak_norm,' ','')) = ?
	ORDER BY modul, created_at
`);

interface SkloRow {
	id: number;
	zak: string;
	zak_norm: string;
	op: string;
	modul: string;
	popis: string;
	sirka_mm: number;
	vyska_mm: number | null;
	v_lavo_mm: number | null;
	v_pravo_mm: number | null;
	pocet: number;
	typ_skla: string;
	sikmy: number;
	m2: number | null;
	rezim: string;
	created_at: string;
	created_by: string;
}

export function listSklaPreZakazku(zakRaw: string): SkloPolozka[] {
	const norm = normZak(zakRaw);
	const rows = stmtListPre.all(norm, norm) as SkloRow[];
	return rows.map(mapRow);
}

function mapRow(r: SkloRow): SkloPolozka {
	return {
		id: r.id,
		zak: r.zak,
		zakNorm: r.zak_norm,
		op: r.op,
		modul: r.modul,
		popis: r.popis,
		sirkaMm: r.sirka_mm,
		vyskaMm: r.vyska_mm,
		vLavoMm: r.v_lavo_mm,
		vPravoMm: r.v_pravo_mm,
		pocet: r.pocet,
		typSkla: r.typ_skla,
		sikmy: r.sikmy === 1,
		m2: r.m2,
		rezim: r.rezim === 'atyp' ? 'atyp' : 'rozmery',
		createdAt: r.created_at,
		createdBy: r.created_by
	};
}

const stmtGet = db.prepare('SELECT * FROM objednavka_skla WHERE id = ?');

export function getSkloPolozka(id: number): SkloPolozka | null {
	const r = stmtGet.get(id) as SkloRow | undefined;
	return r ? mapRow(r) : null;
}

const stmtNastavRezim = db.prepare('UPDATE objednavka_skla SET rezim = ? WHERE id = ?');

export function nastavRezim(id: number, rezim: 'rozmery' | 'atyp'): void {
	stmtNastavRezim.run(rezim, id);
	log.info('sklo rezim zmeneny', { id, rezim });
}

const stmtZmaz = db.prepare('DELETE FROM objednavka_skla WHERE id = ?');

export function zmazPolozku(id: number): void {
	stmtZmaz.run(id);
	log.info('sklo polozka zmazana', { id });
}

// ---- Prílohy (súbory) -----------------------------------------------------------------

const stmtInsertSubor = db.prepare(`
	INSERT INTO objednavka_skla_subory (polozka_id, nazov, typ, velkost, data)
	VALUES (?, ?, ?, ?, ?)
`);

export function pridajSubor(polozkaId: number, nazov: string, typ: string, data: Buffer): number {
	if (data.length > MAX_SUBOR_VELKOST) {
		throw new Error(
			`Súbor "${nazov}" je príliš veľký (${data.length} B, max ${MAX_SUBOR_VELKOST} B).`
		);
	}
	const r = stmtInsertSubor.run(polozkaId, nazov, typ, data.length, data);
	log.info('subor pridany', { id: r.lastInsertRowid, polozkaId, nazov, velkost: data.length });
	return Number(r.lastInsertRowid);
}

const stmtListSubory = db.prepare(`
	SELECT id, polozka_id, nazov, typ, velkost, created_at
	FROM objednavka_skla_subory
	WHERE polozka_id = ?
	ORDER BY created_at
`);

interface SuborRow {
	id: number;
	polozka_id: number;
	nazov: string;
	typ: string;
	velkost: number;
	created_at: string;
}

export function listSubory(polozkaId: number): SkloSubor[] {
	const rows = stmtListSubory.all(polozkaId) as SuborRow[];
	return rows.map((r) => ({
		id: r.id,
		polozkaId: r.polozka_id,
		nazov: r.nazov,
		typ: r.typ,
		velkost: r.velkost,
		createdAt: r.created_at
	}));
}

const stmtGetSuborData = db.prepare('SELECT data FROM objednavka_skla_subory WHERE id = ?');

export function getSuborData(id: number): Buffer | null {
	const r = stmtGetSuborData.get(id) as { data: Buffer } | undefined;
	return r ? r.data : null;
}

const stmtGetSuborMeta = db.prepare(
	'SELECT nazov, typ, velkost FROM objednavka_skla_subory WHERE id = ?'
);

export function getSuborMeta(id: number): { nazov: string; typ: string; velkost: number } | null {
	const r = stmtGetSuborMeta.get(id) as { nazov: string; typ: string; velkost: number } | undefined;
	return r ?? null;
}

const stmtZmazSubor = db.prepare('DELETE FROM objednavka_skla_subory WHERE id = ?');

export function zmazSubor(id: number): void {
	stmtZmazSubor.run(id);
	log.info('subor zmazany', { id });
}
