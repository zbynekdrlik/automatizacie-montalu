// #496: Objednávka skla podklad — CRUD pre sklové položky zákazky + prílohy (atyp súbory).
// Money-NEUTRÁLNE (objednávka u dodávateľa skla, nie Money odpis).
// Handoff kontrakt pre Odoo subdev: číta z objednavka_skla + objednavka_skla_subory.
import { db } from './db';
import { normOp, normZak } from './money';
import { logger } from './log';
import {
	GLASS_SPEC_OFF,
	HOLE_SIZES,
	EDGE_FINISHES,
	type GlassSpec,
	type HoleSize,
	type EdgeFinish
} from './odoo-rozpis-lines';
import { bezRozmerov, m2Tabule, popisPozicie, zakladPozicie } from '../objednavka-skla-pozicia';
import { riadkySklaPosuvu } from '../sklo-otvory';
import { formatDatumSk, sqliteUtcToIso } from '../datum';

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
	/** #548: „iné sklo" — vlastný typ (keď nie je z katalógu). `null` pre katalógový riadok. */
	typSklaManual: string | null;
	/** #548: „iné sklo" — cena €/m² bez DPH. `null` pre katalógový riadok. */
	cenaM2Manual: number | null;
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
	/** #578: vŕtané otvory NA TABUĽU (Deluxe zámok ⌀46 → 1); default 0 = bez otvorov. */
	holesQty?: number;
	/** #578: trieda priemeru otvoru (kontrakt odoo-erp); len pri `holesQty > 0`. */
	holeSize?: HoleSize;
	createdBy: string;
}

/**
 * #578: riadky objednávky skla z JEDNÉHO posuvu zasklenia (producent `/zasklenia` single aj multi).
 * Tabule s vŕtaným otvorom (Deluxe krajné sklá, pravidlo `otvoryVSkle` = to isté ako výkres) idú
 * na samostatný riadok „<pozícia> — s otvorom ⌀46" s otvormi NA TABUĽU; zvyšok ako „<pozícia>".
 * m² sa počíta z kusov KAŽDÉHO riadku. Money-NEUTRÁLNE.
 */
export function sklaPosuvu(
	pozicia: string,
	posuv: { system: string; sklo: { sirka: number; vyska: number; pocet: number } },
	ident: { zak: string; op: string; typSkla: string; createdBy: string }
): NoveSklo[] {
	const { sirka, vyska, pocet } = posuv.sklo;
	return riadkySklaPosuvu(pozicia, posuv.system, pocet).map((rd) => ({
		zak: ident.zak,
		op: ident.op,
		modul: 'zasklenia',
		popis: rd.popis,
		sirkaMm: sirka,
		vyskaMm: vyska,
		pocet: rd.pocet,
		m2: m2Tabule(sirka, vyska, rd.pocet),
		typSkla: ident.typSkla,
		holesQty: rd.holesQty,
		holeSize: rd.holeSize || undefined,
		createdBy: ident.createdBy
	}));
}

// Max veľkosť prílohy: 10 MB
export const MAX_SUBOR_VELKOST = 10 * 1024 * 1024;

// ---- CRUD -----------------------------------------------------------------------------

const stmtInsert = db.prepare(`
	INSERT INTO objednavka_skla
		(zak, zak_norm, op, modul, popis, sirka_mm, vyska_mm, v_lavo_mm, v_pravo_mm,
		 pocet, typ_skla, sikmy, m2, rezim, created_by, spec_holes_qty, spec_hole_size)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rozmery', ?, ?, ?)
`);

/** #578: otvory z producenta → hodnoty `spec_holes_qty`/`spec_hole_size` (validované ako `nastavSpec`). */
function otvoryRiadku(s: NoveSklo): { holesQty: number; holeSize: HoleSize | '' } {
	const holesQty = s.holesQty ?? 0;
	if (!Number.isInteger(holesQty) || holesQty < 0)
		throw new Error('Neplatný počet (otvory): musí byť celé číslo >= 0.');
	if (s.holeSize !== undefined && !HOLE_SIZES.includes(s.holeSize))
		throw new Error('Neplatný priemer otvoru.');
	// otvory > 0 bez triedy → d30 (rovnako ako `nastavSpec`); bez otvorov trieda nemá zmysel
	return { holesQty, holeSize: holesQty > 0 ? s.holeSize || 'd30' : '' };
}

export function pridajSklo(s: NoveSklo): number {
	const otvory = otvoryRiadku(s);
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
		s.createdBy,
		otvory.holesQty,
		otvory.holeSize
	);
	log.info('sklo polozka pridana', {
		id: r.lastInsertRowid,
		zak: s.zak,
		modul: s.modul,
		holesQty: otvory.holesQty
	});
	return Number(r.lastInsertRowid);
}

// ---- Ručný riadok (#545) --------------------------------------------------------------

/** Vstup pre ručne pridaný riadok objednávky skla. Typ skla je POVINNÝ. `modul` je voliteľný
 *  override (#546: pergola honest-null vetva zadáva `modul='pergola'`); default `'manual'`. */
export interface ManualSklo {
	zak: string;
	/** Pôvod riadku — default `'manual'` (sekcia „Pridané položky"); `'pergola'` pre honest-null
	 *  strešné sklo zadané operátorom (#546). */
	modul?: string;
	/** OP objednávky riadka (#546) — pergola honest-null vetva pozná OP z formulára (ako automatický
	 *  producent `pridatSkla` → `op: ident.op`), nech sa operátorom zadané OP nestratí. Default `''`
	 *  (ručný podklad `pridatRiadok` nastavuje jedno OP na CELÝ podklad cez `nastavOp`). */
	op?: string;
	popis: string;
	/** Katalógový typ skla (XOR s `typSklaManual`+`cenaM2Manual`). */
	typSkla?: string;
	/** #548: „iné sklo" — vlastný typ (XOR s `typSkla`). */
	typSklaManual?: string;
	/** #548: „iné sklo" — cena €/m² bez DPH (> 0, s `typSklaManual`). */
	cenaM2Manual?: number;
	/** Šírka mm. #565: `null` = nezadaná — povolené LEN pri `rezim='atyp'` + `vykres`. */
	sirkaMm: number | null;
	/** Výška mm. #565: `null` = nezadaná — povolené LEN pri `rezim='atyp'` + `vykres`. */
	vyskaMm: number | null;
	pocet: number;
	rezim: 'rozmery' | 'atyp';
	/** #565: výkres priložený v TOM ISTOM odoslaní (už validovaný `validujSubor`). Uloží sa v tej
	 *  istej transakcii ako riadok — riadok bez rozmerov nikdy neostane bez výkresu. */
	vykres?: { nazov: string; data: Buffer };
	createdBy: string;
}

/**
 * #545: pridá RUČNÝ riadok objednávky skla (`modul='manual'`, sekcia „Pridané položky") — pre ATYP
 * podľa výkresu, V.O., priobjednané sklo a servisné objednávky bez nárezáku. #546: voliteľný `modul`
 * override (default `'manual'`) — pergola honest-null vetva zadáva `modul='pergola'`, aby riadok
 * pristál v sekcii „Pergola". Reuse `pridajSklo` (Money-NEUTRÁLNE). Typ skla POVINNÝ (prázdny →
 * throw, nič sa neuloží); rozmery celé > 0, počet celý >= 1; `m2 = š×v×ks/1e6` (ako FIX producent).
 * `rezim='atyp'` sa nastaví po vložení
 * (`pridajSklo` vkladá vždy s `rezim='rozmery'`), aby atyp riadok rovno ponúkol prílohu.
 */
/** #548: cena €/m² validná = konečné číslo > 0; zaokrúhlená na 2 desatinné (kontrakt bez DPH). */
function validnaManualCena(x: unknown): number {
	const n = typeof x === 'number' ? x : Number(x);
	if (!Number.isFinite(n) || n <= 0) throw new Error('Cena za m² musí byť číslo väčšie ako 0.');
	return Math.round(n * 100) / 100;
}

/**
 * #548: rozriešenie typu skla ručného riadka — EXKLUZÍVNE (XOR): buď katalógový `typSkla`, ALEBO
 * „iné sklo" (`typSklaManual` + `cenaM2Manual` > 0). Nikdy oboje, nikdy nič (throw). Vracia, čo sa
 * uloží do stĺpcov (`typ_skla`, `typ_skla_manual`, `cena_m2_manual`).
 */
export function rozriesTypSkla(s: {
	typSkla?: string;
	typSklaManual?: string;
	cenaM2Manual?: number;
}): { typSkla: string; typSklaManual: string | null; cenaM2Manual: number | null } {
	const catalog = (s.typSkla ?? '').trim();
	const manualTyp = (s.typSklaManual ?? '').trim();
	const maManual = manualTyp.length > 0 || s.cenaM2Manual != null;
	if (catalog && maManual)
		throw new Error('Zadajte buď typ skla z katalógu, ALEBO vlastný typ + cenu — nie oboje.');
	if (!catalog && !maManual)
		throw new Error('Vyberte typ skla z katalógu, alebo zadajte vlastný typ skla + cenu za m².');
	if (maManual) {
		if (!manualTyp) throw new Error('Vlastný typ skla je povinný.');
		return {
			typSkla: '',
			typSklaManual: manualTyp,
			cenaM2Manual: validnaManualCena(s.cenaM2Manual)
		};
	}
	return { typSkla: catalog, typSklaManual: null, cenaM2Manual: null };
}

/**
 * #565: rozmery ručného riadka. Bez rozmerov (OBE nezadané) LEN pri atype s výkresom v tom istom
 * odoslaní (Patrik, Odoo úloha 1051 — výkres s viacerými tvarmi, jeden rozmer neexistuje) →
 * `null` (uloží sa `sirka_mm=0` — stĺpec NOT NULL, bez migrácie — `vyska_mm=NULL`, `m2=NULL`).
 * Atyp bez výkresu aj bez rozmerov → throw (Odoo príjem atyp bez prílohy odmietne). Inak (aj jeden
 * zadaný rozmer) platí doterajšia validácia: obe celé > 0.
 */
function rozmeryManual(s: ManualSklo): { sirkaMm: number; vyskaMm: number } | null {
	if (s.sirkaMm == null && s.vyskaMm == null && s.rezim === 'atyp') {
		if (s.vykres) return null;
		throw new Error(
			'Atyp bez výkresu potrebuje šírku a výšku — alebo priložte výkres (rozmery sú potom nepovinné).'
		);
	}
	const { sirkaMm, vyskaMm } = s;
	if (typeof sirkaMm !== 'number' || !Number.isInteger(sirkaMm) || sirkaMm <= 0)
		throw new Error('Šírka musí byť celé číslo > 0.');
	if (typeof vyskaMm !== 'number' || !Number.isInteger(vyskaMm) || vyskaMm <= 0)
		throw new Error('Výška musí byť celé číslo > 0.');
	return { sirkaMm, vyskaMm };
}

export function pridajSkloManual(s: ManualSklo): number {
	const { typSkla, typSklaManual, cenaM2Manual } = rozriesTypSkla(s);
	const rozmery = rozmeryManual(s);
	if (!Number.isInteger(s.pocet) || s.pocet < 1)
		throw new Error('Počet kusov musí byť celé číslo >= 1.');

	// #565: bez rozmerov → m² NEZNÁME (null, nikdy 0 do súčtov); plochu určí dodávateľ z výkresu.
	const m2 = rozmery ? m2Tabule(rozmery.sirkaMm, rozmery.vyskaMm, s.pocet) : null;
	// Insert + manuál/atyp UPDATE ATOMICKY (jeden logický riadok) — `pridajSklo` vkladá vždy
	// `rezim='rozmery'` a manuálne stĺpce NULL; doplnia sa v tej istej transakcii (#545 review 🔵).
	const id = db.transaction(() => {
		const id = pridajSklo({
			zak: s.zak,
			op: s.op,
			modul: (s.modul ?? 'manual').trim() || 'manual',
			popis: (s.popis ?? '').trim(),
			sirkaMm: rozmery?.sirkaMm ?? 0,
			vyskaMm: rozmery?.vyskaMm ?? null,
			pocet: s.pocet,
			typSkla,
			m2,
			createdBy: s.createdBy
		});
		if (typSklaManual) stmtSetManual.run('', typSklaManual, cenaM2Manual, id);
		if (s.rezim === 'atyp') nastavRezim(id, 'atyp');
		// #565 review: výkres v TEJ ISTEJ transakcii — keď jeho uloženie zlyhá, nevznikne ani riadok
		// (riadok 0 × 0 bez výkresu by Odoo príjem odmietol). Vynútený bezpečný MIME (ako `nahratSubor`).
		if (s.vykres) pridajSubor(id, s.vykres.nazov, 'application/octet-stream', s.vykres.data);
		return id;
	})();
	logCudzieRiadky([s]);
	return id;
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
	logCudzieRiadky(polozky);
	return count;
}

// #514: idempotentné pridanie — pre „Pridať sklá" na výsledkovej obrazovke zasklení, ktoré
// (po zrušení redirectu) ostáva na stránke, takže dvojklik nesmie duplikovať. Zhoda na
// GEOMETRICKEJ identite riadka (SQL; `IS` je null-safe — v_lavo/v_pravo sú pri pravouhlom skle
// NULL) + na POZÍCII (`popisPozicie`). Rezim/created_* sa do identity neráta (rovnaké fyzické sklo).
// #563: pozícia namiesto surového popisu — riadok spred zmeny producenta („Slide 3K",
// „Zasklenie 1: Robust 3K") je TÁ ISTÁ pozícia ako nový „Zasklenie 1" → opakované „Pridať sklá"
// po nasadení ho NEzduplikuje (duplicitná objednávka u dodávateľa skla).
// #578: aj OTVORY na tabuľu sú identita — Deluxe riadok „s otvorom" a riadok „bez" môžu mať
// rovnakú geometriu aj kusy (4K = 2 + 2); rozlišuje ich otvor (a prípona pozície).
const stmtRovnake = db.prepare(`
	SELECT popis FROM objednavka_skla
	WHERE zak_norm = ? AND op = ? AND modul = ?
	  AND sirka_mm IS ? AND vyska_mm IS ? AND v_lavo_mm IS ? AND v_pravo_mm IS ?
	  AND pocet = ? AND typ_skla = ? AND spec_holes_qty = ?
`);

function existujeRovnaka(s: NoveSklo): boolean {
	const kandidati = stmtRovnake.all(
		normZak(s.zak),
		s.op ?? '',
		s.modul,
		s.sirkaMm,
		s.vyskaMm ?? null,
		s.vLavoMm ?? null,
		s.vPravoMm ?? null,
		s.pocet,
		s.typSkla,
		s.holesQty ?? 0
	) as { popis: string }[];
	const pozicia = popisPozicie(s.popis, s.modul);
	return kandidati.some((k) => popisPozicie(k.popis, s.modul) === pozicia);
}

// #578 prechod: riadok spred rozlíšenia otvorov = CELÝ posuv jedným riadkom (N ks, 0 otvorov) na
// tej istej pozícii. Nový producent ho rozdelí na „s otvorom" + „bez" — ani jeden sa s ním nespáruje
// (iné kusy), takže bez prevodu by opakované „Pridať sklá" pridalo tabule NAVYŠE (dvojitá
// objednávka). Starý riadok sa preto PREVEDIE na riadok „s otvorom" (id + prílohy ostanú); zvyšok
// „bez" sa potom vloží bežne → výsledok = ako čerstvé pridanie.
const stmtStaryCelok = db.prepare(`
	SELECT id, popis FROM objednavka_skla
	WHERE zak_norm = ? AND op = ? AND modul = ?
	  AND sirka_mm IS ? AND vyska_mm IS ? AND v_lavo_mm IS ? AND v_pravo_mm IS ?
	  AND pocet = ? AND typ_skla = ? AND spec_holes_qty = 0
`);
const stmtPrevedNaOtvor = db.prepare(`
	UPDATE objednavka_skla SET popis = ?, pocet = ?, m2 = ?, spec_holes_qty = ?, spec_hole_size = ?
	WHERE id = ?
`);

function prevedStaryCelok(s: NoveSklo, polozky: NoveSklo[]): boolean {
	if (s.modul !== 'zasklenia' || !((s.holesQty ?? 0) > 0)) return false;
	const zaklad = zakladPozicie(s.popis, s.modul);
	// kusy CELÉHO posuvu = súčet riadkov tej istej pozície a toho istého skla v tomto pridaní
	const celok = polozky
		.filter(
			(p) =>
				p.modul === s.modul &&
				zakladPozicie(p.popis, p.modul) === zaklad &&
				p.sirkaMm === s.sirkaMm &&
				p.vyskaMm === s.vyskaMm &&
				p.typSkla === s.typSkla
		)
		.reduce((sum, p) => sum + p.pocet, 0);
	const kandidati = stmtStaryCelok.all(
		normZak(s.zak),
		s.op ?? '',
		s.modul,
		s.sirkaMm,
		s.vyskaMm ?? null,
		s.vLavoMm ?? null,
		s.vPravoMm ?? null,
		celok,
		s.typSkla
	) as { id: number; popis: string }[];
	const stary = kandidati.find((k) => popisPozicie(k.popis, s.modul) === zaklad);
	if (!stary) return false;
	const otvory = otvoryRiadku(s);
	stmtPrevedNaOtvor.run(s.popis, s.pocet, s.m2 ?? null, otvory.holesQty, otvory.holeSize, stary.id);
	log.info('stary riadok posuvu prevedeny na riadok s otvorom', {
		id: stary.id,
		zak: s.zak,
		celok,
		sOtvorom: s.pocet
	});
	return true;
}

/** Ako `pridajSklaHromadne`, ale IDEMPOTENTNE — riadok, ktorý už (identicky) existuje,
 *  preskočí. Vracia počet NOVO vložených (#578: aj prevedených starých riadkov). Umožňuje
 *  opakované „Pridať sklá" nad tým istým spočítaným plánom bez duplikácie (#514).
 *  Money-NEUTRÁLNE (objednavka_skla). */
export function pridajSklaHromadneIdempotentne(polozky: NoveSklo[]): number {
	let pridane = 0;
	db.transaction(() => {
		for (const s of polozky) {
			if (existujeRovnaka(s)) continue;
			if (!prevedStaryCelok(s, polozky)) pridajSklo(s);
			pridane++;
		}
	})();
	logCudzieRiadky(polozky);
	return pridane;
}

// #521: spec_* stĺpce v SELECT-e (rovnaké poradie ako v `mapRow`).
const SPEC_SELECT =
	'spec_warm_edge, spec_colored_frame, spec_muntin_cross_qty, spec_holes_qty, spec_hole_size, ' +
	'spec_cutout_small_qty, spec_cutout_large_qty, spec_edge_finish, spec_hst, spec_tempering_own_glass';

const stmtListPre = db.prepare(`
	SELECT id, zak, zak_norm, op, modul, popis, sirka_mm, vyska_mm,
	       v_lavo_mm, v_pravo_mm, pocet, typ_skla, sikmy, m2, rezim,
	       typ_skla_manual, cena_m2_manual,
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
	typ_skla_manual: string | null;
	cena_m2_manual: number | null;
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

// ---- Cudzie riadky podkladu (#571) ----------------------------------------------------

/** Riadky podkladu zákazky od INÉHO používateľa: celkový počet + autori (najstarší riadok autora). */
export interface CudzieRiadky {
	pocet: number;
	/** `od` = najstarší `created_at` autora (SQLite UTC tvar), zoradené od najstaršieho. */
	autori: { user: string; od: string }[];
}

// Rovnaký WHERE ako `stmtListPre` (aj legacy `zak_norm` s medzerami) — banner počíta presne riadky,
// ktoré podklad zobrazuje. Prázdny `created_by` (bez autora) sa neráta.
const stmtCudzie = db.prepare(`
	SELECT created_by AS user, COUNT(*) AS pocet, MIN(created_at) AS od
	FROM objednavka_skla
	WHERE (zak_norm = ? OR upper(replace(zak_norm,' ','')) = ?)
	  AND created_by <> '' AND created_by <> ?
	GROUP BY created_by
	ORDER BY od, created_by
`);

/**
 * #571: podklad je kľúčovaný číslom zákazky (`zak_norm`), nie používateľom → opakovane použitý
 * (skúšobný) názov zákazky zdieľa podklad viacerých ľudí. Vráti riadky toho istého podkladu od
 * INÉHO používateľa ako `username` (prázdny `created_by` ignoruje). Bez prihláseného mena
 * (`''`) nevieme porovnať → nič. Len čítanie — nikdy neblokuje ani nemaže.
 */
export function cudzieRiadky(zakRaw: string, username: string): CudzieRiadky {
	if (!username) return { pocet: 0, autori: [] };
	const norm = normZak(zakRaw);
	const rows = stmtCudzie.all(norm, norm, username) as {
		user: string;
		pocet: number;
		od: string;
	}[];
	return {
		pocet: rows.reduce((s, r) => s + r.pocet, 0),
		autori: rows.map((r) => ({ user: r.user, od: r.od }))
	};
}

function riadkovSk(n: number): string {
	if (n === 1) return 'riadok';
	return n >= 2 && n <= 4 ? 'riadky' : 'riadkov';
}

/**
 * #571: hláška pre operátora „Táto zákazka už obsahuje N riadkov od <user> (<dátum>) — pridávaš
 * do existujúceho podkladu", alebo `null` keď cudzie riadky nie sú. Dátum cez `sqliteUtcToIso` +
 * `formatDatumSk` (Europe/Bratislava — nie UTC default kontajnera, `timestamps.md`).
 */
export function textCudzichRiadkov(c: CudzieRiadky): string | null {
	if (c.pocet <= 0 || c.autori.length === 0) return null;
	const autori = c.autori
		.map((a) => `${a.user} (${formatDatumSk(sqliteUtcToIso(a.od))})`)
		.join(', ');
	return `Táto zákazka už obsahuje ${c.pocet} ${riadkovSk(c.pocet)} od ${autori} — pridávaš do existujúceho podkladu`;
}

/** #571: `cudzieRiadky` + `textCudzichRiadkov` naraz — hláška pre výsledok producenta aj load
 *  podkladu. BEZ logu (load beží pri každom reloade); loguje zápisová vrstva (`logCudzieRiadky`). */
export function upozornenieCudzie(zakRaw: string, username: string): string | null {
	return textCudzichRiadkov(cudzieRiadky(zakRaw, username));
}

/** #571: po ZÁPISE do podkladu (všetci producenti: zasklenia, FIX, pergola, ručný riadok) zaloguj,
 *  keď používateľ pridal do podkladu s riadkami iného používateľa — raz na (zákazka, autor). */
function logCudzieRiadky(polozky: { zak: string; createdBy: string }[]): void {
	const videne = new Set<string>();
	for (const s of polozky) {
		const kluc = `${normZak(s.zak)}\u0000${s.createdBy}`;
		if (videne.has(kluc)) continue;
		videne.add(kluc);
		const c = cudzieRiadky(s.zak, s.createdBy);
		if (c.pocet > 0)
			log.info('pridane do podkladu s cudzimi riadkami', {
				zak: s.zak,
				user: s.createdBy,
				pocet: c.pocet,
				autori: c.autori.map((a) => a.user)
			});
	}
}

// ---- OP objednávky (#545) -------------------------------------------------------------

// Jedno OP pre celý podklad (servisná objednávka bez odpisu): zapíše sa do `op` VŠETKÝCH riadkov
// zákazky (rovnaký WHERE ako `stmtListPre` — pokrýva aj legacy `zak_norm` s medzerami).
const stmtSetOpAll = db.prepare(`
	UPDATE objednavka_skla SET op = ?
	WHERE zak_norm = ? OR upper(replace(zak_norm,' ','')) = ?
`);

/**
 * #545: nastaví (normalizované cez `normOp`) OP objednávky pre CELÝ podklad zákazky — jedno OP na
 * podklad, uložené do `op` stĺpca všetkých riadkov. Prázdne/neplatné OP → throw (akcia → fail 400).
 * Vracia normalizované OP. Money-NEUTRÁLNE (objednávka u dodávateľa, nie odpis).
 */
export function nastavOpZakazky(zakRaw: string, opRaw: string): string {
	const op = normOp(opRaw ?? '');
	if (!op) throw new Error('OP objednávky je prázdne alebo neplatné.');
	const norm = normZak(zakRaw);
	stmtSetOpAll.run(op, norm, norm);
	log.info('objednavka OP nastavené', { zak: zakRaw, op });
	return op;
}

/**
 * #545: spoločné OP riadkov podkladu (pre upload OP precedenciu). Vráti `''` keď žiadny riadok nemá
 * OP, samotné OP keď sú všetky (neprázdne) rovnaké, `null` keď sa OP riadkov ROZCHÁDZAJÚ (mixed →
 * volajúci to hlási ako chybu „nastavte jedno OP").
 */
export function opPodkladu(zakRaw: string): string | null {
	const ops = new Set(
		listSklaPreZakazku(zakRaw)
			.map((r) => (r.op ?? '').trim())
			.filter((o) => o.length > 0)
	);
	if (ops.size === 0) return '';
	if (ops.size > 1) return null;
	return [...ops][0]!;
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
		// #563: riadky spred #563 (zasklenia/pergola producent m² neukladal) → dopočítaj z rozmerov,
		// keď je výška (pravouhlé sklo). Uložené m² má prednosť (FIX lichobežník nesie vlastnú plochu);
		// šikmý bez výšky a bez m² ostáva null (žiadny odhad).
		m2: r.m2 ?? (r.vyska_mm != null ? m2Tabule(r.sirka_mm, r.vyska_mm, r.pocet) : null),
		rezim: r.rezim === 'atyp' ? 'atyp' : 'rozmery',
		typSklaManual: r.typ_skla_manual ?? null,
		cenaM2Manual: r.cena_m2_manual ?? null,
		spec: mapSpec(r),
		createdAt: r.created_at,
		createdBy: r.created_by
	};
}

/** SkloRow spec_* stĺpce → `GlassSpec` (INTEGER 0/1 → bool; neplatné texty → predvolené). */
function mapSpec(r: SkloRow): GlassSpec {
	const hole = HOLE_SIZES.includes(r.spec_hole_size as HoleSize)
		? (r.spec_hole_size as HoleSize | '')
		: '';
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

// #540: typ skla riadka — pri výbere z Odoo `montalu.glass.type` pickera sa uloží Odoo `code` do
// existujúceho `typ_skla` stĺpca (= `glass_order.items[].glass_type`). Money-NEUTRÁLNE (objednávka).
// #548: pri prepnutí SPÄŤ na katalógový typ VYNULUJ manuálne stĺpce — inak by riadok ostal v XOR-
// -zakázanom stave (typ_skla AJ typ_skla_manual) a `buildGlassOrderItem` by ticho poslal staré
// „iné sklo" (glass_type by vynechal). Symetria k `nastavTypManual` (ktorý vynuluje typ_skla).
const stmtNastavTyp = db.prepare(
	'UPDATE objednavka_skla SET typ_skla = ?, typ_skla_manual = NULL, cena_m2_manual = NULL WHERE id = ?'
);

export function nastavTypSkla(id: number, typ: string): void {
	const t = (typ ?? '').trim();
	if (!t) throw new Error('Typ skla je prázdny.');
	stmtNastavTyp.run(t, id);
	log.info('sklo typ zmenený', { id, typ: t });
}

// #548: „iné sklo" — vlastný typ + cena/m². Katalógový `typ_skla` sa vynuluje (builder vtedy pošle
// `glass_type_manual` + `price_m2_manual` a `glass_type` vynechá). Money-NEUTRÁLNE (cena dodávateľa).
const stmtSetManual = db.prepare(
	'UPDATE objednavka_skla SET typ_skla = ?, typ_skla_manual = ?, cena_m2_manual = ? WHERE id = ?'
);

/**
 * #548: nastaví na EXISTUJÚCOM riadku „iné sklo" (vlastný typ + cena €/m² bez DPH > 0). Vynuluje
 * katalógový `typ_skla`. Neplatná cena / prázdny typ → throw pred zápisom (akcia → fail 400).
 */
export function nastavTypManual(id: number, typManual: string, cenaM2Manual: number): void {
	const { typSklaManual, cenaM2Manual: cena } = rozriesTypSkla({
		typSklaManual: typManual,
		cenaM2Manual
	});
	stmtSetManual.run('', typSklaManual, cena, id);
	log.info('sklo iné-sklo nastavené', { id, typManual: typSklaManual });
}

const stmtNastavRezim = db.prepare('UPDATE objednavka_skla SET rezim = ? WHERE id = ?');
/** #565: rozmerové stĺpce riadka (pre `bezRozmerov` guardy v `nastavRezim` / `zmazSubor`). */
interface RozmerRow {
	sirka_mm: number;
	vyska_mm: number | null;
	v_lavo_mm: number | null;
	v_pravo_mm: number | null;
	sikmy: number;
}

function rozmerZRiadku(r: RozmerRow) {
	return {
		sirkaMm: r.sirka_mm,
		vyskaMm: r.vyska_mm,
		vLavoMm: r.v_lavo_mm,
		vPravoMm: r.v_pravo_mm,
		sikmy: r.sikmy === 1
	};
}

const stmtRozmerRiadku = db.prepare(
	'SELECT sirka_mm, vyska_mm, v_lavo_mm, v_pravo_mm, sikmy FROM objednavka_skla WHERE id = ?'
);

export function nastavRezim(id: number, rezim: 'rozmery' | 'atyp'): void {
	if (rezim === 'rozmery') {
		// #565: riadok BEZ rozmerov (atyp podľa výkresu) do režimu rozmery NIE — Odoo príjem by
		// riadok 0 × 0 v režime rozmery odmietol (UserError → zlyhá CELÁ objednávka skla).
		const r = stmtRozmerRiadku.get(id) as RozmerRow | undefined;
		if (r && bezRozmerov(rozmerZRiadku(r)))
			throw new Error(
				'Riadok nemá rozmery (podľa výkresu) — do režimu rozmery ho nemožno prepnúť. Zmažte ho a pridajte s rozmermi.'
			);
	}
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
	if (!Number.isInteger(x) || x < 0)
		throw new Error(`Neplatný počet (${pole}): musí byť celé číslo >= 0.`);
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

// #565 review: riadok súboru + počet výkresov jeho riadka (guard „posledný výkres riadka bez rozmerov")
const stmtSuborRiadok = db.prepare(`
	SELECT s.sirka_mm, s.vyska_mm, s.v_lavo_mm, s.v_pravo_mm, s.sikmy,
	       (SELECT COUNT(*) FROM objednavka_skla_subory x WHERE x.polozka_id = s.id) AS pocet_suborov
	FROM objednavka_skla_subory f JOIN objednavka_skla s ON s.id = f.polozka_id
	WHERE f.id = ?
`);

export function zmazSubor(id: number): void {
	const r = stmtSuborRiadok.get(id) as (RozmerRow & { pocet_suborov: number }) | undefined;
	// #565 review: riadok BEZ rozmerov (atyp podľa výkresu) nesmie ostať bez výkresu — Odoo príjem by
	// atyp bez prílohy odmietol a zlyhala by CELÁ objednávka skla.
	if (r && r.pocet_suborov <= 1 && bezRozmerov(rozmerZRiadku(r)))
		throw new Error(
			'Riadok bez rozmerov musí mať výkres — najprv nahrajte iný výkres, alebo zmažte celý riadok.'
		);
	stmtZmazSubor.run(id);
	log.info('subor zmazany', { id });
}
