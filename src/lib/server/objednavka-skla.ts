// #496: Objednávka skla podklad — CRUD pre sklové položky zákazky + prílohy (atyp súbory).
// Money-NEUTRÁLNE (objednávka u dodávateľa skla, nie Money odpis).
// Handoff kontrakt pre Odoo subdev: číta z objednavka_skla + objednavka_skla_subory.
import { db } from './db';
import { normZak } from './money';
import { logger } from './log';
import {
	GLASS_SPEC_OFF,
	type GlassSpec,
	type HoleSize,
	type EdgeFinish
} from './odoo-rozpis-lines';

const log = logger('objednavka-skla');

const HOLE_SIZES: readonly (HoleSize | '')[] = ['', 'd30', 'd50'];
const EDGE_FINISHES: readonly EdgeFinish[] = ['none', 'ksr', 'trapez_brusena', 'trapez_lestena'];

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
	/** #521: voliteľná špecifikácia tabule pre Odoo IZOS oceňovanie (default vypnutá). */
	spec: GlassSpec;
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

// #514: idempotentné pridanie — pre „Pridať sklá" na výsledkovej obrazovke zasklení, ktoré
// (po zrušení redirectu) ostáva na stránke, takže dvojklik nesmie duplikovať. Zhoda na
// GEOMETRICKEJ + popisnej identite riadka; `IS` je null-safe (v_lavo/v_pravo sú pri
// pravouhlom skle NULL). Rezim/created_* sa do identity neráta (rovnaké fyzické sklo).
const stmtRovnaka = db.prepare(`
	SELECT id FROM objednavka_skla
	WHERE zak_norm = ? AND op = ? AND modul = ? AND popis = ?
	  AND sirka_mm IS ? AND vyska_mm IS ? AND v_lavo_mm IS ? AND v_pravo_mm IS ?
	  AND pocet = ? AND typ_skla = ?
	LIMIT 1
`);

function existujeRovnaka(s: NoveSklo): boolean {
	return !!stmtRovnaka.get(
		normZak(s.zak),
		s.op ?? '',
		s.modul,
		s.popis,
		s.sirkaMm,
		s.vyskaMm ?? null,
		s.vLavoMm ?? null,
		s.vPravoMm ?? null,
		s.pocet,
		s.typSkla
	);
}

/** Ako `pridajSklaHromadne`, ale IDEMPOTENTNE — riadok, ktorý už (identicky) existuje,
 *  preskočí. Vracia počet NOVO vložených. Umožňuje opakované „Pridať sklá" nad tým istým
 *  spočítaným plánom bez duplikácie (#514). Money-NEUTRÁLNE (objednavka_skla). */
export function pridajSklaHromadneIdempotentne(polozky: NoveSklo[]): number {
	let pridane = 0;
	db.transaction(() => {
		for (const s of polozky) {
			if (existujeRovnaka(s)) continue;
			pridajSklo(s);
			pridane++;
		}
	})();
	return pridane;
}

// #521: spec_* stĺpce v SELECT-e (rovnaké poradie ako v `mapRow`).
const SPEC_SELECT =
	'spec_warm_edge, spec_colored_frame, spec_muntin_cross_qty, spec_holes_qty, spec_hole_size, ' +
	'spec_cutout_small_qty, spec_cutout_large_qty, spec_edge_finish, spec_hst, spec_tempering_own_glass';

const stmtListPre = db.prepare(`
	SELECT id, zak, zak_norm, op, modul, popis, sirka_mm, vyska_mm,
	       v_lavo_mm, v_pravo_mm, pocet, typ_skla, sikmy, m2, rezim,
	       ${SPEC_SELECT},
	       created_at, created_by
	FROM objednavka_skla
	WHERE zak_norm = ? OR upper(replace(zak_norm,' ','')) = ?
	ORDER BY modul, created_at, id
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
	spec_warm_edge: number;
	spec_colored_frame: number;
	spec_muntin_cross_qty: number;
	spec_holes_qty: number;
	spec_hole_size: string;
	spec_cutout_small_qty: number;
	spec_cutout_large_qty: number;
	spec_edge_finish: string;
	spec_hst: number;
	spec_tempering_own_glass: number;
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
		spec: mapSpec(r),
		createdAt: r.created_at,
		createdBy: r.created_by
	};
}

/** SkloRow spec_* stĺpce → `GlassSpec` (INTEGER 0/1 → bool; neplatné texty → predvolené). */
function mapSpec(r: SkloRow): GlassSpec {
	const hole = HOLE_SIZES.includes(r.spec_hole_size as HoleSize) ? (r.spec_hole_size as HoleSize | '') : '';
	const edge = EDGE_FINISHES.includes(r.spec_edge_finish as EdgeFinish)
		? (r.spec_edge_finish as EdgeFinish)
		: 'none';
	return {
		warmEdge: r.spec_warm_edge === 1,
		coloredFrame: r.spec_colored_frame === 1,
		muntinCrossQty: r.spec_muntin_cross_qty ?? 0,
		holesQty: r.spec_holes_qty ?? 0,
		holeSize: hole,
		cutoutSmallQty: r.spec_cutout_small_qty ?? 0,
		cutoutLargeQty: r.spec_cutout_large_qty ?? 0,
		edgeFinish: edge,
		hst: r.spec_hst === 1,
		temperingOwnGlass: r.spec_tempering_own_glass === 1
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

// #521: špecifikácia tabule (spec_* stĺpce). Neplatná hodnota = throw PRED zápisom (kontrakt
// montalu-narezak-upload.md: neplatný počet/hrana = UserError) — server akcia to chytí → fail 400.
const stmtNastavSpec = db.prepare(`
	UPDATE objednavka_skla SET
		spec_warm_edge = ?, spec_colored_frame = ?, spec_muntin_cross_qty = ?,
		spec_holes_qty = ?, spec_hole_size = ?, spec_cutout_small_qty = ?,
		spec_cutout_large_qty = ?, spec_edge_finish = ?, spec_hst = ?, spec_tempering_own_glass = ?
	WHERE id = ?
`);

function nezapornyCely(x: number, pole: string): number {
	if (!Number.isInteger(x) || x < 0) throw new Error(`Neplatný počet (${pole}): musí byť celé číslo >= 0.`);
	return x;
}

/** Validuje `GlassSpec` (hodí Error na neplatnú hodnotu) — jediné miesto validácie spec vstupu. */
export function validateSpec(spec: GlassSpec): void {
	nezapornyCely(spec.muntinCrossQty, 'priečky');
	nezapornyCely(spec.holesQty, 'otvory');
	nezapornyCely(spec.cutoutSmallQty, 'výrezy 35×60');
	nezapornyCely(spec.cutoutLargeQty, 'výrezy 60×120');
	if (!HOLE_SIZES.includes(spec.holeSize)) throw new Error('Neplatný priemer otvoru.');
	if (!EDGE_FINISHES.includes(spec.edgeFinish)) throw new Error('Neplatné opracovanie hrany.');
}

export function nastavSpec(id: number, spec: GlassSpec): void {
	validateSpec(spec);
	// otvory > 0 bez zvolenej triedy → default d30 (4–30 mm), aby Odoo nedefaultlo na d50
	const holeSize = spec.holesQty > 0 ? (spec.holeSize === 'd50' ? 'd50' : 'd30') : '';
	stmtNastavSpec.run(
		spec.warmEdge ? 1 : 0,
		spec.coloredFrame ? 1 : 0,
		spec.muntinCrossQty,
		spec.holesQty,
		holeSize,
		spec.cutoutSmallQty,
		spec.cutoutLargeQty,
		spec.edgeFinish,
		spec.hst ? 1 : 0,
		spec.temperingOwnGlass ? 1 : 0,
		id
	);
	log.info('sklo spec zmenený', { id });
}

/** Predvolený (vypnutý) spec — re-export pre UI/akcie. */
export { GLASS_SPEC_OFF };

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
