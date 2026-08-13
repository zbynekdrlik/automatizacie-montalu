// Zdieľaná kompozičná logika technických hárkov (#168) — mierka + centrovanie
// zovšeobecnené z `vypocitajMierku`-štýlu (mierka.ts) a z troch nezávislých ad-hoc
// riešení, ktoré si PergolaNavrhVykres/ZaskleniaNavrhVykres/BazenNavrhVykres doteraz
// počítali každý zvlášť — fixný `baseY = r.y + r.h*0.8`-štýl odsad namiesto
// vycentrovania bol PRÍČINOU nálezu "horná tretina hárku prázdna" na zaskleniach aj
// bazéne (#168 design komentár): keď je obsah pomerovo iný než jeho oblasť (napr.
// široká/plochá kresba vo vysokej oblasti), `fitScale` vráti mierku limitovanú JEDNÝM
// rozmerom a ušetrený priestor sa pri fixnom dolnom odsade nahromadí len na JEDNEJ
// strane namiesto rovnomerného rozdelenia.
//
// Čistý TS bez závislosti na Svelte/DOM (rovnaká disciplína ako kota.ts/mierka.ts v
// tom istom adresári) — jednotkovo testovateľné, viď tests/kompozicia.test.ts.
import { fitScale } from './kota';

/** Obdĺžniková oblasť v mm (SVG user units) — rovnaký tvar, aký `VykresovyHarok.svelte`
 *  posiela do `content` snippetu (`oblast`), a aký si jednotlivé pohľady (elevácia,
 *  bokorys, pôdorys...) navzájom posielajú. Štruktúrne kompatibilné s existujúcim
 *  ad-hoc `{x,y,w,h}` tvarom — netreba nič meniť na volajúcej strane. */
export interface AreaBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface FitResult {
	/** mm → px (SVG user units) mierka */
	scale: number;
	/** ľavý horný roh obsahu (px), vycentrovaný v cieľovej oblasti */
	x0: number;
	y0: number;
	/** pravý dolný roh obsahu (px) */
	x1: number;
	y1: number;
	contentW: number;
	contentH: number;
}

/** Stred pásma 60–75 % (#168 zadanie: "cieľ ~60-75 % vnútornej šírky/výšky hárku, kde
 *  to pomer strán dovolí") — LIMITUJÚCI rozmer obsahu zaberie PRESNE toto percento
 *  dostupnej plochy, druhý rozmer (podľa pomeru strán) menej, nikdy viac. Použité ako
 *  spoločný default zo VŠETKÝCH troch hárkov — to je to, čo z tejto logiky robí
 *  "ONE shared helper", nie len zdieľaný kód, ale aj zdieľané ČÍSLO. */
export const DEFAULT_TARGET_FILL = 0.72;

/** Minimálne veľkosti písma (mm, SVG user units) — spoločná podlaha čitateľnosti pre
 *  všetky tri hárky (#168 bod 2). NIKDY nekresli menšie, bez ohľadu na to, koľko
 *  miesta kompozícia inak ušetrí. Hodnoty odvodené z existujúcej rohovej pečiatky
 *  (`TitleBlock.svelte`: tučný `tb-nazov`=4, hodnotové stĺpce 3.2–3.4) — hlavný
 *  nadpis hárku je odteraz VÄČŠÍ než pečiatkový NÁZOV (na zaskleniovom hárku bez
 *  pečiatky, #162 bod 4, je to jediné miesto, kde sa meno zákazky vôbec objaví),
 *  podnadpis/kóty/spec text aspoň na úrovni pečiatkových hodnôt. */
export const MIN_TITLE_FONT = 6;
export const MIN_SUBTITLE_FONT = 3.6;
export const MIN_DIM_FONT = 3;
export const MIN_SPEC_FONT = 3;

/** Vycentruje obsah (mmW×mmH) v `area` PRI UŽ ZNÁMEJ mierke (napr. zdieľanej medzi
 *  viacerými pohľadmi cez `sharedFitScale` nižšie) — `fitCentered` bez vlastného
 *  dopočtu mierky. Neplatný (nekladný) `scale` sa NIKDY nestane — `fitScale`/
 *  `sharedFitScale` majú vlastný obranný fallback (1), takže táto funkcia mierku
 *  len prijíma, nikdy ju sama nevaliduje. */
export function centerAt(mmW: number, mmH: number, area: AreaBox, scale: number): FitResult {
	const contentW = mmW * scale;
	const contentH = mmH * scale;
	const x0 = area.x + (area.w - contentW) / 2;
	const y0 = area.y + (area.h - contentH) / 2;
	return { scale, x0, y0, x1: x0 + contentW, y1: y0 + contentH, contentW, contentH };
}

/** Vycentruje obsah (mmW×mmH) v `area` pri mierke vypočítanej tak, aby limitujúci
 *  rozmer zaberal `targetFill` dostupnej plochy (fitScale-štýl, viď mierka.ts) —
 *  NAHRADENIE doterajšieho vzoru "fixný baseY zlomok výšky", ktorý pri pomerovo-
 *  nesediacom obsahu necháva prázdny pás z JEDNEJ strany namiesto rozdelenia
 *  rovnomerne (#168 Nálezy 1). */
export function fitCentered(
	mmW: number,
	mmH: number,
	area: AreaBox,
	targetFill: number = DEFAULT_TARGET_FILL
): FitResult {
	const scale = fitScale(mmW, mmH, area.w * targetFill, area.h * targetFill);
	return centerAt(mmW, mmH, area, scale);
}

export interface SharedFitItem {
	mmW: number;
	mmH: number;
	area: AreaBox;
}

/** Mierka zdieľaná VIACERÝMI pohľadmi na jednom hárku (napr. bokorys+pôdorys bazéna)
 *  — každý pohľad má vlastný (mmW,mmH) a vlastnú oblasť, ale musia sa kresliť v
 *  ROVNAKEJ mierke, aby ich hranice/stĺpiky (napr. deliace stĺpiky sekcií) vizuálne
 *  sedeli pod sebou (rovnaká projekčná disciplína, akú `BazenNavrhVykres.svelte` už
 *  dodržiavala cez ručný `Math.min(scaleLenW, scaleBokH, scalePodH)` — táto funkcia
 *  to zovšeobecňuje na ľubovoľný počet položiek). Vráti najMENŠIU mierku spomedzi
 *  všetkých položiek (tú, čo VŠETKÝM zmestí ich `targetFill`), nikdy viac — inak by
 *  niektorý pohľad pretiekol svoju oblasť. Prázdny zoznam → 1 (rovnaký obranný
 *  fallback ako `fitScale` pre neplatný vstup). */
export function sharedFitScale(
	items: SharedFitItem[],
	targetFill: number = DEFAULT_TARGET_FILL
): number {
	let scale = Infinity;
	for (const it of items) {
		scale = Math.min(
			scale,
			fitScale(it.mmW, it.mmH, it.area.w * targetFill, it.area.h * targetFill)
		);
	}
	return Number.isFinite(scale) ? scale : 1;
}
