// #578: vŕtané otvory v skle zasklenia — JEDEN zdroj pravdy pre výkres (`Nahlad2D` kreslí zámkové
// otvory ⌀46) AJ pre objednávku skla (riadok „s otvorom" a riadok „bez", aby IZOS cenil správne).
// Client-safe (bez IO) — importuje ho svelte komponent aj serverový producent.
//
// ROZHODNUTÉ (stream, 28.9., Odoo úloha 1185): Deluxe má zámkový otvor ⌀46 na KRAJNÝCH sklách
// (ľavé pole pri ľavej hrane, pravé pri pravej; jedno krídlo = jedna tabuľa), 1 otvor na tabuľu.
// Robust / Slide / Štandard-rodina do skla nevŕtajú. Ďalší typ otvoru (madlo, iný systém) = zmena TU.
// ROZHODNUTÉ (stream, 8.10., Odoo úloha 1370, #603): pri otváraní OPONA sa polovice stretávajú v
// strede a zámok nesú AJ obe stredové krídla (polia N/2−1 a N/2) — otvor pri STREDOVEJ (stretávacej)
// hrane: ľavé stredové pri pravej, pravé stredové pri ľavej. 2×2K = 4 s otvorom, 2×3K = 4 + 2 bez,
// 2×4K = 4 + 4 bez. L - P / P - L len krajné. Strana otvoru je PER TABUĽA v pravidle (`tabule`) —
// výkres ani PDF ju neodvodzujú z indexu.

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

/** #587: mm do textu polohy (celé bez desatín, inak 1 desatinné miesto s čiarkou) — PDF aj poznámka. */
export function fmtMmOtvoru(x: number): string {
	return Number.isInteger(x) ? String(x) : String(Math.round(x * 10) / 10).replace('.', ',');
}

/**
 * #587: poloha otvoru slovom — ide do POZNÁMKY riadku objednávky v Odoo (IZOS ju vidí aj bez PDF a
 * zmena polohy = zmena riadku, takže Odoo pri opätovnom odoslaní založí novú verziu; prílohy riadku
 * Odoo pri porovnaní verzií nesleduje) a na podklad.
 */
export function popisPolohyOtvoru(o: PolohaOtvoru): string {
	return (
		`otvor ⌀${fmtMmOtvoru(o.priemerMm)}: stred ${fmtMmOtvoru(o.odHranyMm)} mm od zvislej hrany, ` +
		`${fmtMmOtvoru(o.odSpodkuMm)} mm od spodku skla`
	);
}

/**
 * #587: trieda priemeru podľa kontraktu odoo-erp (`d30` = 4–30 mm, `d50` = 31–50 mm), inak `null`.
 * Uložená poloha platí len vtedy, keď sedí so spec riadku (1 otvor na tabuľu, tá istá trieda) — ak
 * obsluha spec otvorov neskôr zmení, výkres by jej odporoval → radšej žiadny (honest-null).
 */
export function triedaOtvoru(priemerMm: number): 'd30' | 'd50' | null {
	if (!(priemerMm >= 4)) return null;
	if (priemerMm <= 30) return 'd30';
	return priemerMm <= 50 ? 'd50' : null;
}

/**
 * #587: tabule riadku s otvorom podľa STRANY otvoru (ľavé krídlo = otvor pri ľavej hrane, pravé =
 * ZRKADLOVO pri pravej) — PDF výkres pre IZOS ich kreslí zvlášť, žiadne „otoč tabuľu" (vrstvené /
 * pokovované sklo má stranu). Riadok objednávky nesie len počet tabúľ, preto delenie ceil/floor:
 * `otvoryVSkle` je zrkadlové (krajné L + P; pri opone stredové P + L), pri nepárnom počte je
 * navyše ľavá — test #603 to drží pre každé N a otváranie (`tabule` z pravidla = toto delenie).
 */
export function stranyOtvorov(sOtvorom: number): { vlavo: number; vpravo: number } {
	const n = Number.isInteger(sOtvorom) && sOtvorom > 0 ? sOtvorom : 0;
	return { vlavo: Math.ceil(n / 2), vpravo: Math.floor(n / 2) };
}

/** Prípona popisu riadku objednávky skla s tabuľami s otvorom („Zasklenie N — s otvorom ⌀46"). */
export const PRIPONA_S_OTVOROM = ` — s otvorom ⌀${D_ZAMOK_MM}`;

/** Prípona otvoru ĽUBOVOĽNÉHO priemeru na konci popisu (ďalší typ otvoru = iný ⌀, rovnaký tvar). */
export const PRIPONA_OTVOR_RE = / — s otvorom ⌀\d+$/;

/**
 * #587: riadok „— s otvorom ⌀N" z nárezáka, ktorého spec otvorov obsluha RUČNE zmenila (#521 — iný
 * počet na tabuľu alebo iná trieda než ⌀ z popisu). Poloha k nemu neplatí a opakované „Pridať sklá"
 * ho nespáruje (dedup kľúč = otvory) → podklad radí atyp + vlastný výkres, nie znova pridať.
 */
export function otvoryRucneZmenene(p: {
	popis: string;
	holesQty: number;
	holeSize: string;
}): boolean {
	const m = / — s otvorom ⌀(\d+)$/.exec(p.popis);
	if (!m) return false;
	return p.holesQty !== 1 || p.holeSize !== triedaOtvoru(Number(m[1]));
}

/** Trieda priemeru otvoru podľa kontraktu odoo-erp (`d50` = 31–50 mm; ⌀46 ∈ d50). */
export type TriedaOtvoru = 'd50';

/** #603: jedna tabuľa s otvorom — pole posuvu a STRANA otvoru (pri ktorej zvislej hrane skla). */
export interface OtvorTabule {
	/** index poľa (0 = ľavé) */
	pole: number;
	/** `true` = otvor pri ĽAVEJ zvislej hrane skla, `false` = pri pravej (zrkadlovo) */
	vlavo: boolean;
}

export interface OtvoryVSkle {
	/** tabule s otvorom zľava doprava, so stranou otvoru — kreslí ich výkres */
	tabule: OtvorTabule[];
	/** počet tabúľ s otvorom (= `tabule.length`) */
	sOtvorom: number;
	/** počet otvorov na JEDNU tabuľu s otvorom */
	otvorovNaTabulu: number;
	/** trieda priemeru otvoru; '' keď otvory nie sú */
	velkost: TriedaOtvoru | '';
}

const BEZ_OTVOROV: OtvoryVSkle = { tabule: [], sOtvorom: 0, otvorovNaTabulu: 0, velkost: '' };

/** #603: otváranie, pri ktorom sa polovice stretávajú v strede (hodnota `OTVARANIA` z `vstup.ts`). */
const OPONA = 'Opona';

/**
 * #603: otváranie posuvu zimnej záhrady (`PosuvInfo.otvaranie` je v type voliteľné) pre pravidlo
 * otvorov — JEDEN fallback pre výkres aj kartu (`PlanKartyMulti`) aj objednávku skla (multi akcia
 * `/zasklenia`), aby sa nemohli rozísť. `recomputeMultiVstup` ho plní vždy validovaným reťazcom;
 * 'Opona' je pôvodný default náhľadu viacerých posuvov.
 */
export function otvaraniePosuvu(otvaranie: string | undefined): string {
	return otvaranie ?? OPONA;
}

/**
 * Ktoré tabule posuvu (systém, N polí, otváranie) majú vŕtaný otvor, pri ktorej hrane a aký.
 * `otvaranie` je POVINNÉ — volajúci, ktorý ho nepošle, by ticho dostal pravidlo bez opony.
 */
export function otvoryVSkle(system: string, N: number, otvaranie: string): OtvoryVSkle {
	if (system !== 'Deluxe' || !(N >= 1)) return { ...BEZ_OTVOROV, tabule: [] };
	// krajné sklá: ľavé pole pri ľavej hrane, pravé pri pravej
	const tabule: OtvorTabule[] = [{ pole: 0, vlavo: true }];
	if (N > 1) tabule.push({ pole: N - 1, vlavo: false });
	// #603: opona — stredové krídla pri stretávacej hrane; pri prekryve (N ≤ 3) má krajná tabuľa
	// prednosť. Stred = Math.floor(N / 2) ako stredová kľučka (`poleStred` v `Nahlad2D`).
	if (otvaranie.trim() === OPONA) {
		const stred = Math.floor(N / 2);
		for (const t of [
			{ pole: stred - 1, vlavo: false },
			{ pole: stred, vlavo: true }
		])
			if (t.pole >= 0 && !tabule.some((x) => x.pole === t.pole)) tabule.push(t);
	}
	tabule.sort((a, b) => a.pole - b.pole);
	return { tabule, sOtvorom: tabule.length, otvorovNaTabulu: 1, velkost: 'd50' };
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
	otvaranie: string,
	rozmer?: RozmerOtvoru
): RiadokSklaPosuvu[] {
	const o = otvoryVSkle(system, N, otvaranie);
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
export function rozpisOtvorovSkla(system: string, N: number, otvaranie: string): string | null {
	const riadky = riadkySklaPosuvu('', system, N, otvaranie);
	const kusy = (sOtvormi: boolean) =>
		riadky
			.filter((r) => {
				const maOtvor = r.holesQty > 0;
				return maOtvor === sOtvormi;
			})
			.reduce((a, r) => a + r.pocet, 0);
	const sOtvorom = kusy(true);
	if (sOtvorom === 0) return null;
	return `z toho s otvorom ⌀${D_ZAMOK_MM}: ${sOtvorom} ks · bez otvoru: ${kusy(false)} ks`;
}
