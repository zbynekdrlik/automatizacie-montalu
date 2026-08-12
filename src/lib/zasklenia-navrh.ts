// Zasklenia — zákaznícky NÁVRHOVÝ výkres (#162, architektúra 1:1 podľa pergoly
// #138). Čistý TS bez závislosti na Svelte/DOM — geometria je jednotkovo
// testovateľná (viď tests/zasklenia-navrh.test.ts). NIKAM do Money nezapisuje —
// existujúci `/zasklenia` (nárezový plán → Money odpis) sa touto route vôbec
// nedotýka (viď design komentár na #162).
//
// Počet krídel `N` sa ZNOVUPOUŽÍVA priamo z `listSysStyly()` (server, rovnaký
// zdroj ako formulár na `/zasklenia`) — táto komponenta ho len prijíma ako
// vstup, nikdy ho neprepočítava paralelne.
import type { Klin } from '$lib/klin';
import type { KolajnicaRucne } from '$lib/kolajnica';
import { type VykresRezim, VYKRES_REZIM_DEFAULT } from '$lib/vykres/ral';

export const S_MIN = 300;
export const S_MAX = 20000;
export const V_MIN = 300;
export const V_MAX = 20000;
export const N_MIN = 1;
export const N_MAX = 30;

/** Rovnaké tri hodnoty ako `OTVARANIA` v `$lib/server/vstup.ts` — sem sa
 *  neimportujú (server-only modul), len ich TVAR sa opakuje pre klientsky
 *  bezpečnú `dir()` deriváciu nižšie. Zdroj pravdy pre VÝBER v dropdowne
 *  ostáva `data.otvarania` (server `load`, `OTVARANIA` z vstup.ts). */
export type Otvaranie = 'P - L' | 'L - P' | 'Opona' | '';

export interface ZaskleniaNavrhVstup {
	system: string;
	styl: string;
	/** `${system}|${styl}` — kľúč do cfg, rovnaký tvar ako všade v appke */
	sysStyl: string;
	/** počet krídel — ZNOVUPOUŽITÝ z `listSysStyly()`, nikdy neprepočítaný tu */
	n: number;
	/** celková šírka [mm] */
	s: number;
	/** celková výška [mm] */
	v: number;
	otvaranie: string;
	klin: Klin | null;
	kolajnica: KolajnicaRucne | null;
	/** voliteľný prostý textový popis objednávky (napr. "Ponuka pre XY") —
	 *  vykreslí sa ako obyčajný nadpis, NIKDY v rámčeku (#162 bod 4: žiadny
	 *  info rámček vpravo dole) */
	nazov: string;
	ral: string;
	ralKod: string;
	rezimVykresu: VykresRezim;
}

/** Smer kaskádovania krídel odvodený z `otvaranie` — rovnaká logika ako
 *  `Nahlad2D.svelte`'s `dir` (medzery sa odstránia, "P-L"/"L-P" rozlíšené,
 *  cokoľvek iné neprázdne = opona). */
export type Smer = 'PL' | 'LP' | 'OP' | '';
export function smerZOtvarania(otvaranie: string): Smer {
	const s = otvaranie.replace(/\s/g, '');
	if (s === 'P-L') return 'PL';
	if (s === 'L-P') return 'LP';
	return s ? 'OP' : '';
}

/** Šírka jedného krídla — rovnomerné delenie celkovej šírky, rovnaká
 *  zjednodušujúca konvencia ako `Nahlad2D.svelte` (`panelW = S/N`) a
 *  `checkB2BWidth` (`b2b-limits.ts`) — nie nová paralelná formula. */
export function sirkaKridla(s: number, n: number): number {
	if (!(s > 0) || !(n > 0)) return 0;
	return s / n;
}

/** X pozície deliacich stĺpikov (0-based, od 0 po `s`) pri `n` rovnomerne
 *  širokých krídlach — [0, s/n, 2·s/n, …, s]. */
export function deliaceStlpiky(s: number, n: number): number[] {
	const pocet = Math.max(1, Math.round(n));
	const sirka = sirkaKridla(s, pocet);
	return Array.from({ length: pocet + 1 }, (_, i) => Math.round(i * sirka * 10) / 10);
}

/** Chybová hláška vstupu, alebo null keď je platný. Rovnaká disciplína ako
 *  `chybaPergolaNavrhVstupu` v `$lib/pergola-navrh.ts`. */
export function chybaZaskleniaNavrhVstupu(v: ZaskleniaNavrhVstup): string | null {
	if (!v.system || !v.styl) return 'Vyber systém a štýl.';
	if (!(v.n >= N_MIN && v.n <= N_MAX)) return `Neplatný počet krídel (${N_MIN}–${N_MAX}).`;
	if (!(v.s >= S_MIN && v.s <= S_MAX)) return `Šírka musí byť ${S_MIN}–${S_MAX} mm.`;
	if (!(v.v >= V_MIN && v.v <= V_MAX)) return `Výška musí byť ${V_MIN}–${V_MAX} mm.`;
	if (v.klin) {
		if (!(v.klin.dlzka > 0) || !(v.klin.sirka > 0))
			return 'Klín — dĺžka a šírka musia byť kladné čísla.';
		if (!(v.klin.ks >= 1)) return 'Klín — počet kusov musí byť aspoň 1.';
	}
	return null;
}

export { VYKRES_REZIM_DEFAULT };
