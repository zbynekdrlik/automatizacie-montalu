// #578: vŕtané otvory v skle zasklenia — JEDEN zdroj pravdy pre výkres (`Nahlad2D` kreslí zámkové
// otvory ⌀46) AJ pre objednávku skla (riadok „s otvorom" a riadok „bez", aby IZOS cenil správne).
// Client-safe (bez IO) — importuje ho svelte komponent aj serverový producent.
//
// ROZHODNUTÉ (stream, 28.9., Odoo úloha 1185): Deluxe má zámkový otvor ⌀46 na KRAJNÝCH sklách
// (ľavé pole pri ľavej hrane, pravé pri pravej; jedno krídlo = jedna tabuľa), 1 otvor na tabuľu.
// Robust / Slide / Štandard-rodina do skla nevŕtajú. Štýl (opona, 2x…) pravidlo NEmení — výkres
// kreslí otvory rovnako na poliach 0 a N−1. Ďalší typ otvoru (madlo, iný systém) = zmena TU.

/** Priemer zámkového otvoru Deluxe [mm] (Dominik 2026-07-14). */
export const D_ZAMOK_MM = 46;

/** Prípona popisu riadku objednávky skla s tabuľami s otvorom („Zasklenie N — s otvorom ⌀46"). */
export const PRIPONA_S_OTVOROM = ` — s otvorom ⌀${D_ZAMOK_MM}`;

/** Prípona otvoru ĽUBOVOĽNÉHO priemeru na konci popisu (ďalší typ otvoru = iný ⌀, rovnaký tvar). */
export const PRIPONA_OTVOR_RE = / — s otvorom ⌀\d+$/;

/** Trieda priemeru otvoru podľa kontraktu odoo-erp (`d50` = 31–50 mm; ⌀46 ∈ d50). */
export type TriedaOtvoru = 'd50';

export interface OtvoryVSkle {
	/** indexy polí (0 = ľavé), ktorých sklo má otvor — kreslí ich výkres */
	indexy: number[];
	/** počet tabúľ s otvorom (= `indexy.length`) */
	sOtvorom: number;
	/** počet otvorov na JEDNU tabuľu s otvorom */
	otvorovNaTabulu: number;
	/** trieda priemeru otvoru; '' keď otvory nie sú */
	velkost: TriedaOtvoru | '';
}

const BEZ_OTVOROV: OtvoryVSkle = { indexy: [], sOtvorom: 0, otvorovNaTabulu: 0, velkost: '' };

/** Ktoré tabule posuvu (systém, N polí) majú vŕtaný otvor a aký. */
export function otvoryVSkle(system: string, N: number): OtvoryVSkle {
	if (system !== 'Deluxe' || !(N >= 1)) return { ...BEZ_OTVOROV, indexy: [] };
	const indexy = N === 1 ? [0] : [0, N - 1];
	return { indexy, sOtvorom: indexy.length, otvorovNaTabulu: 1, velkost: 'd50' };
}

/** Jeden riadok objednávky skla odvodený z posuvu (pozícia + kusy + otvory na tabuľu). */
export interface RiadokSklaPosuvu {
	popis: string;
	pocet: number;
	holesQty: number;
	holeSize: TriedaOtvoru | '';
}

/**
 * Rozdelí tabule posuvu na riadky objednávky skla: pri otvoroch riadok „<pozícia> — s otvorom ⌀46"
 * (kusy s otvorom) + riadok „<pozícia>" (zvyšok; pri 0 kusoch nevznikne), inak jeden riadok.
 */
export function riadkySklaPosuvu(pozicia: string, system: string, N: number): RiadokSklaPosuvu[] {
	const o = otvoryVSkle(system, N);
	if (o.sOtvorom === 0) return [{ popis: pozicia, pocet: N, holesQty: 0, holeSize: '' }];
	const riadky: RiadokSklaPosuvu[] = [
		{
			popis: `${pozicia}${PRIPONA_S_OTVOROM}`,
			pocet: o.sOtvorom,
			holesQty: o.otvorovNaTabulu,
			holeSize: o.velkost
		}
	];
	const bez = N - o.sOtvorom;
	if (bez > 0) riadky.push({ popis: pozicia, pocet: bez, holesQty: 0, holeSize: '' });
	return riadky;
}
