// Bazén — zákaznícky NÁVRHOVÝ výkres, FÁZA 1 (#139, vzory OP260027 rev.3 a
// OP260055). Čistý TS bez závislosti na Svelte/DOM — geometria je jednotkovo
// testovateľná (viď tests/bazen-navrh.test.ts). NIKAM do Money nezapisuje —
// existujúci `/bazen` (Money odpis, $lib/server/bazen.ts) sa touto route vôbec
// nedotýka (viď design komentár na #139).
//
// FÁZA 1 zámerne NEKRESLÍ priečny rez sekciou (VIEW A) — tvar oblúka nie je
// kruh ani elipsa (overené proti kótam na oboch vzoroch, #163) a appka ho bez
// ďalších dát od Dominika nevie odvodiť. Miesto rezu ostáva na hárku prázdne
// s poznámkou "Rez sekciou doplní konštruktér" (BazenNavrhVykres.svelte).
//
// Každá hodnota tu je buď (a) PRIAMO odvodená z kót, ktoré sedia na OBOCH
// vzoroch — `variantaZSekcii`, `presahKolajniska`, `sekcieVysky` — alebo
// (b) povinný/voliteľný vstup od používateľa, KEĎ appka hodnotu nevie
// spoľahlivo odvodiť (šírka jednotlivej sekcie, výška čela, mierka —
// pozri komentár "ROZHODNUTÉ (2026-08-12)" na #139). Appka nikdy netlačí
// vymyslenú kótu na zákaznícky dokument.
import {
	VYKRES_REZIM_DEFAULT,
	RAL_PALETA,
	RAL_INY_KOD,
	RAL_FALLBACK_HEX,
	farbaKonstrukcie,
	ciarovaFarba,
	type VykresRezim,
	type RalOdtien,
	type FarbaKonstrukcie
} from '$lib/vykres/ral';

// RAL/farebná logika žije v `$lib/vykres/ral.ts` (generická, tretí konzument
// po pergole #150/#162 a zaskleniach #162) — re-exportované tu pod rovnakým
// menom ako v ostatných dvoch moduloch, aby vzor importu ostal jednotný.
export {
	RAL_PALETA,
	RAL_INY_KOD,
	RAL_FALLBACK_HEX,
	farbaKonstrukcie,
	ciarovaFarba,
	type RalOdtien,
	type FarbaKonstrukcie
};

export type BazenNavrhVykresRezim = VykresRezim;
export const BAZEN_NAVRH_REZIM_DEFAULT: BazenNavrhVykresRezim = VYKRES_REZIM_DEFAULT;

export const POCET_SEKCII_MIN = 1;
export const POCET_SEKCII_MAX = 12;
export const ZATVORENA_DLZKA_MIN = 1000;
export const ZATVORENA_DLZKA_MAX = 30000;
export const HLBKA_MIN = 1000;
export const HLBKA_MAX = 8000;
export const VYSKA_MIN = 100;
export const VYSKA_MAX = 3000;
export const DLZKA_KOLAJISKA_MIN = 1000;
export const DLZKA_KOLAJISKA_MAX = 40000;
export const VYSKA_CELA_MIN = 10;
export const VYSKA_CELA_MAX = 300;

export type Kolaj = 'jednokolaj' | 'dvojkolaj';
export type Smer = 'vpravo' | 'vlavo';
// smer dverí je NEZÁVISLÝ od smeru posuvu (viď `dverePopis` nižšie), ale
// zdieľa PRESNE tú istú hodnotovú množinu — jeden zdroj pravdy pre "vpravo"/
// "vlavo" (review nález #139: dva samostatné typy s identickou úniou boli
// zbytočná duplicita).
export type DvereSmer = Smer;

export interface BazenNavrhVstup {
	/** zatvorená dĺžka krytu [mm] — "10500"/"8570" v názve vzoru */
	zatvorenaDlzka: number;
	/** hĺbka/šírka bazéna [mm] — "3788"/"4250" v názve vzoru */
	hlbka: number;
	/** výška najvyššej (prvej) sekcie [mm] */
	vyskaMax: number;
	/** výška najnižšej (poslednej) sekcie [mm] */
	vyskaMin: number;
	pocetSekcii: number;
	/** dĺžka koľajiska [mm] — vždy väčšia než zatvorenaDlzka (presah teleskopu) */
	dlzkaKolajiska: number;
	/** ručný prepis šírky PRVEJ sekcie [mm] — kóta sa vytlačí LEN keď je zadaná
	 *  (vnorenie sekcií appka nepozná, viď hlavičkový komentár + design #139) */
	sirkaSekcieOverride?: number;
	/** 1-based index sekcie s dverami (zvýraznená oranžovo v pôdoryse) */
	dverovaSekcia: number;
	kolaj: Kolaj;
	/** smer posuvu — relevantný len pri `kolaj === 'jednokolaj'` */
	smer: Smer;
	/** smer dverí — nezávislé od `smer` (obe strany sa na vzoroch líšia) */
	dvereSmer: DvereSmer;
	/** voľný text, napr. "PREMIER" — na OP260027 vôbec nebol vyplnený, preto
	 *  VOLITEĽNÝ (rovnaký "—" idiom ako OP číslo v pergola-navrh.ts) */
	model: string;
	vyplna: string;
	aretacia: string;
	/** výška profilu čela [mm] — VŽDY vstup, nikdy dopočet (90 vs. 96,2 na
	 *  vzoroch — appka nehádže) */
	vyskaCela: number;
	op: string;
	nazov: string;
	revizia: string;
	vypracoval: string;
	rezimVykresu: BazenNavrhVykresRezim;
	ral: string;
	ralKod: string;
}

const R1 = (x: number) => Math.round(x * 10) / 10;

/** VARIANTA = "S{počet sekcií}" — OP260055 (4 sekcie) → "S4", OP260027 (5
 *  sekcií) → "S5". Nie je to iný model, je to len počet sekcií appky. */
export function variantaZSekcii(pocetSekcii: number): string {
	const n = Math.max(1, Math.round(pocetSekcii));
	return `S${n}`;
}

/** Presah koľajiska = dĺžka koľajiska − zatvorená dĺžka. Presne sedí na
 *  oboch vzoroch: 13000−10500=2500 (OP260027), 11100−8570=2530 (OP260055). */
export function presahKolajniska(dlzkaKolajiska: number, zatvorenaDlzka: number): number {
	return R1(dlzkaKolajiska - zatvorenaDlzka);
}

/** Výšky jednotlivých sekcií — lineárna kaskáda medzi najvyššou (prvá) a
 *  najnižšou (posledná) sekciou. sekcieVysky(5,1600,1320) → [1600,1530,1460,
 *  1390,1320] — 1390 je nezávisle overená kóta na VIEW A OP260027. Ručne
 *  prepísateľné vo formulári (viď design komentár na #139). */
export function sekcieVysky(pocetSekcii: number, vyskaMax: number, vyskaMin: number): number[] {
	const n = Math.max(1, Math.round(pocetSekcii));
	if (n === 1) return [R1(vyskaMax)];
	const krok = (vyskaMax - vyskaMin) / (n - 1);
	return Array.from({ length: n }, (_, i) => R1(vyskaMax - krok * i));
}

/** X pozície deliacich hraníc sekcií (0-based, od 0 po `zatvorenaDlzka`) pri
 *  `pocetSekcii` ROVNOMERNE širokých sekciách — LEN vizuálne polohy pre
 *  kreslenie deliacich čiar v bokoryse/pôdoryse, appka ich NIKDY netlačí ako
 *  kótu šírky (skutočné vnorenie sekcií nepozná). Posledná hranica je
 *  EXPLICITNE priradená `zatvorenaDlzka` (rovnaká oprava ako `deliaceStlpiky`
 *  v zasklenia-navrh.ts #162 review nález — zaokrúhľovanie po jednotlivých
 *  krokoch by inak pri niektorých kombináciách skončilo mimo skutočnej dĺžky).
 *
 *  `sirkaPrvejOverride` (review nález #139): keď je zadaná ručná šírka prvej
 *  sekcie, PRVÁ hranica sa nakreslí PRESNE tam (nie na schematickom
 *  rovnomernom delení) a zvyšná dĺžka sa rovnomerne rozdelí medzi ostávajúce
 *  sekcie — inak by kóta ručne zadanej šírky ukazovala na hranicu, ktorá ju
 *  vôbec nemeria (vizuálne klamlivé, aj keď číselne správne). Bez override
 *  (alebo pri 1 sekcii, kde "zvyšok" nedáva zmysel) sa správa nezmenene ako
 *  predtým. */
export function sekciePozicie(
	zatvorenaDlzka: number,
	pocetSekcii: number,
	sirkaPrvejOverride?: number
): number[] {
	const n = Math.max(1, Math.round(pocetSekcii));
	if (sirkaPrvejOverride !== undefined && sirkaPrvejOverride > 0 && n > 1) {
		const prva = Math.min(sirkaPrvejOverride, zatvorenaDlzka);
		const zvysok = Math.max(0, zatvorenaDlzka - prva);
		const sirkaOstatnych = zvysok / (n - 1);
		const out = [0, R1(prva)];
		for (let i = 2; i <= n; i++) out.push(R1(prva + sirkaOstatnych * (i - 1)));
		out[n] = R1(zatvorenaDlzka);
		return out;
	}
	const sirka = zatvorenaDlzka > 0 ? zatvorenaDlzka / n : 0;
	const out = Array.from({ length: n + 1 }, (_, i) => R1(i * sirka));
	out[n] = R1(zatvorenaDlzka);
	return out;
}

/** POSUV popis — dvojkoľaj (obojsmerný posuv) nemá smer, jednokoľaj má.
 *  dvojkoľaj → "OBOJSMERNÝ" (OP260027), jednokoľaj → "JEDNOKOĽAJ VPRAVO"/
 *  "JEDNOKOĽAJ VĽAVO" (OP260055: "JEDNOKOLAJ VPRAVO"). */
export function posuvPopis(kolaj: Kolaj, smer: Smer): string {
	if (kolaj === 'dvojkolaj') return 'OBOJSMERNÝ';
	return smer === 'vlavo' ? 'JEDNOKOĽAJ VĽAVO' : 'JEDNOKOĽAJ VPRAVO';
}

/** DVERE popis — smer dverí je NEZÁVISLÝ od smeru posuvu (OP260055 má POSUV
 *  "JEDNOKOLAJ VPRAVO" ale DVERE "VLAVO" — dve rôzne strany). */
export function dverePopis(dvereSmer: DvereSmer): string {
	return dvereSmer === 'vlavo' ? 'VĽAVO' : 'VPRAVO';
}

/** Predvyplnený názov výkresu z rozmerov — "{zatvorenaDlzka}x{hlbka}x{vyskaMax}",
 *  rovnaký tvar ako oba vzorové súbory ("10500x3788x1600"/"8570x4250x750").
 *  LEN placeholder/predvyplnenie — nikdy prepíše ručne zadaný `nazov` (viď
 *  `BazenNavrhVykres.svelte`, rovnaký "predvyplní sa, dá sa prepísať" idiom
 *  ako `vstup.nazov || 'PERGOLA — NÁVRH'` v pergola-navrh). Tretie číslo v
 *  názve vzoru (OP260027: "…x1700") sa NEZHODUJE s kótou 1600 na výkrese
 *  (viď design komentár #139) — appka preto vždy vypíše `vyskaMax` (skutočná
 *  kóta), nikdy hodnotu z niečoho iného. */
export function predvyplnenyNazov(zatvorenaDlzka: number, hlbka: number, vyskaMax: number): string {
	if (!(zatvorenaDlzka > 0) || !(hlbka > 0) || !(vyskaMax > 0)) return '';
	return `${R1(zatvorenaDlzka)}x${R1(hlbka)}x${R1(vyskaMax)}`;
}

/** Chybová hláška vstupu, alebo null keď je platný. Rovnaká disciplína ako
 *  `chybaPergolaNavrhVstupu` / `chybaZaskleniaNavrhVstupu`. */
export function chybaBazenNavrhVstupu(v: BazenNavrhVstup): string | null {
	if (!(v.zatvorenaDlzka >= ZATVORENA_DLZKA_MIN && v.zatvorenaDlzka <= ZATVORENA_DLZKA_MAX))
		return `Zatvorená dĺžka musí byť ${ZATVORENA_DLZKA_MIN}–${ZATVORENA_DLZKA_MAX} mm.`;
	if (!(v.hlbka >= HLBKA_MIN && v.hlbka <= HLBKA_MAX))
		return `Hĺbka musí byť ${HLBKA_MIN}–${HLBKA_MAX} mm.`;
	if (!(v.vyskaMax >= VYSKA_MIN && v.vyskaMax <= VYSKA_MAX))
		return `Výška najvyššej sekcie musí byť ${VYSKA_MIN}–${VYSKA_MAX} mm.`;
	if (!(v.vyskaMin >= VYSKA_MIN && v.vyskaMin <= VYSKA_MAX))
		return `Výška najnižšej sekcie musí byť ${VYSKA_MIN}–${VYSKA_MAX} mm.`;
	if (v.vyskaMin > v.vyskaMax)
		return 'Výška najnižšej sekcie nemôže byť väčšia než výška najvyššej.';
	if (!(v.pocetSekcii >= POCET_SEKCII_MIN && v.pocetSekcii <= POCET_SEKCII_MAX))
		return `Počet sekcií musí byť ${POCET_SEKCII_MIN}–${POCET_SEKCII_MAX}.`;
	if (!(v.dlzkaKolajiska >= DLZKA_KOLAJISKA_MIN && v.dlzkaKolajiska <= DLZKA_KOLAJISKA_MAX))
		return `Dĺžka koľajiska musí byť ${DLZKA_KOLAJISKA_MIN}–${DLZKA_KOLAJISKA_MAX} mm.`;
	// review nález #139: PÔVODNE len `<` — dovolilo rovnosť (presah=0), čo
	// odporuje vlastnému typovému komentáru "vždy väčšia než zatvorenaDlzka"
	// (BazenNavrhVstup.dlzkaKolajiska) AJ domain pravidlu (presah = reálny
	// presah teleskopu). Rovnosť navyše vyrobí DEGENEROVANÚ (nulovej dĺžky)
	// "presah" kótu v BazenNavrhVykres.svelte — x0===x1 aj y0===y1 — presne ten
	// istý `each_key_duplicate` pád, ktorý `.claude/rules/vykres.md` už
	// dokumentuje pre `<Kota>` s `y0===y1`.
	if (v.dlzkaKolajiska <= v.zatvorenaDlzka)
		return 'Dĺžka koľajiska musí byť väčšia než zatvorená dĺžka (presah musí byť kladný).';
	if (v.sirkaSekcieOverride !== undefined && !(v.sirkaSekcieOverride > 0))
		return 'Ručná šírka sekcie musí byť kladné číslo.';
	const n = Math.max(1, Math.round(v.pocetSekcii));
	if (!(v.dverovaSekcia >= 1 && v.dverovaSekcia <= n)) return `Dverová sekcia musí byť 1–${n}.`;
	if (!(v.vyskaCela >= VYSKA_CELA_MIN && v.vyskaCela <= VYSKA_CELA_MAX))
		return `Výška čela musí byť ${VYSKA_CELA_MIN}–${VYSKA_CELA_MAX} mm.`;
	return null;
}
