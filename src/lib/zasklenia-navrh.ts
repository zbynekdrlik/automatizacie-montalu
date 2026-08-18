// Zasklenia — zákaznícky NÁVRHOVÝ výkres (#162, architektúra 1:1 podľa pergoly
// #138). Čistý TS bez závislosti na Svelte/DOM — geometria je jednotkovo
// testovateľná (viď tests/zasklenia-navrh.test.ts). NIKAM do Money nezapisuje —
// existujúci `/zasklenia` (nárezový plán → Money odpis) sa touto route vôbec
// nedotýka (viď design komentár na #162).
//
// Počet krídel `N` sa ZNOVUPOUŽÍVA priamo z `listSysStyly()` (server, rovnaký
// zdroj ako formulár na `/zasklenia`) — táto komponenta ho len prijíma ako
// vstup, nikdy ho neprepočítava paralelne.
import { KLIN_MAX_KS, KLIN_MAX_ROZMER, type Klin } from '$lib/klin';
import type { KolajnicaRucne } from '$lib/kolajnica';
import { type VykresRezim, VYKRES_REZIM_DEFAULT } from '$lib/vykres/ral';

// Spodný sanity-floor pre rozmery zasklenia. 100 mm = fyzicky reálne minimum pre
// akékoľvek zasklievacie/vetracie okienko (#216 — Patrik, interní: vetracie okienko
// ~1 zo 100 zákaziek sa nesmie blokovať). Presnú geometrickú spodnú hranicu pre daný
// systém stráži engine (`undersizeCut` v $lib/server/compute) — profil/sklo ≤ 0 mm
// zlyhá nahlas. Toto je jediný zdroj pravdy pre rozmerové medze (vstup.ts + oba
// .svelte formuláre ho importujú). b2b limity (checkB2BWidth ≥ 800) sú oddelené.
export const S_MIN = 100;
export const S_MAX = 20000;
export const V_MIN = 100;
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
 *  širokých krídlach — [0, s/n, 2·s/n, …, s]. Posledná hranica je EXPLICITNE
 *  priradená `s` (nie len dopočítaná násobením) — zaokrúhľovanie po jednotlivých
 *  krokoch (`i · sirka`) by inak pri niektorých s/n kombináciách skončilo o
 *  0,1 mm mimo skutočnej celkovej šírky (#162 review nález 🔵: invariant
 *  "posledná hranica == s" bol doteraz len náhodný, nie vynútený). */
export function deliaceStlpiky(s: number, n: number): number[] {
	const pocet = Math.max(1, Math.round(n));
	const sirka = sirkaKridla(s, pocet);
	const out = Array.from({ length: pocet + 1 }, (_, i) => Math.round(i * sirka * 10) / 10);
	out[pocet] = Math.round(s * 10) / 10;
	return out;
}

/** Chybová hláška vstupu, alebo null keď je platný. Rovnaká disciplína ako
 *  `chybaPergolaNavrhVstupu` v `$lib/pergola-navrh.ts`. */
export function chybaZaskleniaNavrhVstupu(v: ZaskleniaNavrhVstup): string | null {
	if (!v.system || !v.styl) return 'Vyber systém a štýl.';
	if (!(v.n >= N_MIN && v.n <= N_MAX)) return `Neplatný počet krídel (${N_MIN}–${N_MAX}).`;
	if (!(v.s >= S_MIN && v.s <= S_MAX)) return `Šírka musí byť ${S_MIN}–${S_MAX} mm.`;
	if (!(v.v >= V_MIN && v.v <= V_MAX)) return `Výška musí byť ${V_MIN}–${V_MAX} mm.`;
	if (v.klin) {
		// #162 review nález: rovnaké pravidlá ako `parseKlin` v `$lib/server/vstup.ts`
		// (klín na `/zasklenia`) — polovične vyplnený klín (napr. len dĺžka bez
		// šírky) je REÁLNA chyba, nie tichý fallback; aspoň JEDNA výška musí byť
		// kladná (v1=v2=0 by dal neviditeľný plochý klin), druhá smie byť 0
		// (klín dobehnutý do ostra).
		const rozmerOk = (x: number) => x > 0 && x <= KLIN_MAX_ROZMER;
		const vyskaOk = (x: number) => x >= 0 && x <= KLIN_MAX_ROZMER;
		if (!rozmerOk(v.klin.dlzka)) return `Klín — dĺžka musí byť 1–${KLIN_MAX_ROZMER} mm.`;
		if (!rozmerOk(v.klin.sirka)) return `Klín — šírka musí byť 1–${KLIN_MAX_ROZMER} mm.`;
		if (!vyskaOk(v.klin.v1) || !vyskaOk(v.klin.v2))
			return `Klín — výšky musia byť 0–${KLIN_MAX_ROZMER} mm.`;
		if (!(v.klin.v1 > 0 || v.klin.v2 > 0)) return 'Klín — zadaj aspoň jednu výšku.';
		if (!(v.klin.ks >= 1 && v.klin.ks <= KLIN_MAX_KS))
			return `Klín — počet kusov musí byť 1–${KLIN_MAX_KS}.`;
	}
	return null;
}

/** Jedno POHYBLIVÉ krídlo — 0-based index + smer posunu na SVG x-osi (-1 = doľava,
 *  1 = doprava). */
export interface PohyblivyPanel {
	index: number;
	znamienko: -1 | 1;
}

/** Ktoré krídlo(á) sú POHYBLIVÉ (a ktorým smerom) pri danom počte krídel a smere
 *  otvárania — #168 bod 3 ("z výkresu sa nedá vyčítať, ktoré pole je pohyblivé").
 *  Rovnaká konvencia ako `vodiaceIndexy()` v `$lib/vizual/geo/zasklenia.ts`
 *  (zákaznícky 3D náhľad, #170) — zámerne NEZÁVISLÁ implementácia (tento súbor je
 *  technický návrhový výkres, nie vizuál — žiadny import z `$lib/vizual/**`, viď
 *  design komentár #168, aby `src/lib/vizual/**` ostal nedotknutý).
 *
 *  'PL' (P-L) = jedno krídlo VĽAVO (idx 0) ide doľava; 'LP' (L-P) = jedno krídlo
 *  VPRAVO (idx n-1) ide doprava; 'OP' (opona) = OBE krajné krídlá sa rozchádzajú od
 *  stredu. Jediné krídlo (n≤1, typicky FIX) sa NIKDY neoznačuje ako pohyblivé —
 *  žiadna dráha, na výber niet. Prázdny smer ('' — appka `otvaranie` nezadala)
 *  → nič neoznačíme (nikdy hádanie). */
export function pohyblivePanely(n: number, smer: Smer): PohyblivyPanel[] {
	if (!(n > 1) || !smer) return [];
	if (smer === 'PL') return [{ index: 0, znamienko: -1 }];
	if (smer === 'LP') return [{ index: n - 1, znamienko: 1 }];
	// 'OP' — opona, oba kraje sa rozchádzajú od stredu
	return [
		{ index: 0, znamienko: -1 },
		{ index: n - 1, znamienko: 1 }
	];
}

export { VYKRES_REZIM_DEFAULT };
