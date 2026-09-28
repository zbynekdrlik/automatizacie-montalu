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

/** #587: vzdialenosť STREDU zámkového otvoru od zvislej hrany skla [mm] (Dominik 2026-07-14) —
 *  náhľad (`Nahlad2D`), riadok objednávky skla aj PDF výkres pre IZOS čítajú TÚTO konštantu. */
export const OKRAJ_ZAMOK_MM = 50;

/** #587: predvolená výška vŕtania zámku = stred otvoru od SPODKU skla [mm]. Formulár ju ponúka,
 *  multi posuv vlastné pole nemá → náhľad aj objednávka použijú tento default. */
export const VRTANIE_ZAMKU_DEFAULT_MM = 1050;

/** #587: poloha vŕtaného otvoru v tabuli (stred) — ukladá sa k riadku objednávky skla „s otvorom". */
export interface PolohaOtvoru {
	/** stred otvoru od ZVISLEJ hrany skla [mm] (ľavé krídlo = ľavá hrana, pravé zrkadlovo) */
	odHranyMm: number;
	/** stred otvoru od SPODNEJ hrany skla [mm] (= výška vŕtania zámku) */
	odSpodkuMm: number;
	/** priemer otvoru [mm] */
	priemerMm: number;
}

/**
 * #587: poloha zámkového otvoru v skle `sirkaMm × vyskaMm` pri výške vŕtania `vrtanieZamku`.
 * `null` (honest-null — výkres sa negeneruje, podklad upozorní), keď by otvor nebol CELÝ v skle
 * (stred ± polomer mimo výšky, odsadenie + polomer mimo šírky) alebo vstup nie je platné číslo.
 * Náhľad takú výšku len oreže do skla (kreslenie), objednávka dodávateľovi ju nesmie domýšľať.
 */
export function polohaOtvoru(
	vrtanieZamku: number,
	sirkaMm: number,
	vyskaMm: number
): PolohaOtvoru | null {
	const r = D_ZAMOK_MM / 2;
	if (![vrtanieZamku, sirkaMm, vyskaMm].every((x) => Number.isFinite(x) && x > 0)) return null;
	if (vrtanieZamku - r < 0 || vrtanieZamku + r > vyskaMm) return null;
	if (OKRAJ_ZAMOK_MM + r > sirkaMm) return null;
	return { odHranyMm: OKRAJ_ZAMOK_MM, odSpodkuMm: vrtanieZamku, priemerMm: D_ZAMOK_MM };
}

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
	/** #587: poloha otvoru (len riadok „s otvorom" a len keď producent poznal rozmer skla);
	 *  `null` = otvor sa do skla nezmestí (honest-null). Riadok bez otvoru kľúč nemá. */
	otvor?: PolohaOtvoru | null;
}

/** #587: rozmer skla posuvu + výška vŕtania — z nich producent spočíta polohu otvoru. */
export interface RozmerOtvoru {
	vrtanieZamku: number;
	sirkaMm: number;
	vyskaMm: number;
}

/**
 * Rozdelí tabule posuvu na riadky objednávky skla: pri otvoroch riadok „<pozícia> — s otvorom ⌀46"
 * (kusy s otvorom) + riadok „<pozícia>" (zvyšok; pri 0 kusoch nevznikne), inak jeden riadok.
 */
export function riadkySklaPosuvu(
	pozicia: string,
	system: string,
	N: number,
	rozmer?: RozmerOtvoru
): RiadokSklaPosuvu[] {
	const o = otvoryVSkle(system, N);
	if (o.sOtvorom === 0) return [{ popis: pozicia, pocet: N, holesQty: 0, holeSize: '' }];
	const sOtvorom: RiadokSklaPosuvu = {
		popis: `${pozicia}${PRIPONA_S_OTVOROM}`,
		pocet: o.sOtvorom,
		holesQty: o.otvorovNaTabulu,
		holeSize: o.velkost
	};
	// #587: poloha otvoru k riadku — ten istý bod, ktorý kreslí náhľad (PDF výkres pre IZOS)
	if (rozmer) sOtvorom.otvor = polohaOtvoru(rozmer.vrtanieZamku, rozmer.sirkaMm, rozmer.vyskaMm);
	const riadky: RiadokSklaPosuvu[] = [sOtvorom];
	const bez = N - o.sOtvorom;
	if (bez > 0) riadky.push({ popis: pozicia, pocet: bez, holesQty: 0, holeSize: '' });
	return riadky;
}

/**
 * #587: rozpis tabúľ posuvu do karty „Sklo (mm)" nárezáku — „z toho s otvorom ⌀46: 2 ks · bez
 * otvoru: 2 ks". Z TOHO ISTÉHO pravidla ako riadky objednávky skla (`riadkySklaPosuvu`), takže
 * nárezák a objednávka nemôžu nesedieť. `null` pre systém bez otvorov (karta nič nepridá).
 */
export function rozpisOtvorovSkla(system: string, N: number): string | null {
	const riadky = riadkySklaPosuvu('', system, N);
	const kusy = (s: boolean) =>
		riadky.filter((r) => r.holesQty > 0 === s).reduce((a, r) => a + r.pocet, 0);
	const sOtvorom = kusy(true);
	if (sOtvorom === 0) return null;
	return `z toho s otvorom ⌀${D_ZAMOK_MM}: ${sOtvorom} ks · bez otvoru: ${kusy(false)} ks`;
}
