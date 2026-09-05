// Popisky nad nárezovým plánom. Display-only — do Money odpisu NEJDE nič odtiaľto.
//
// Patrik 2026-07-28: badge nad viac-posuvovým plánom hlásil paušálne „Zimná záhrada",
// aj keď šlo o čokoľvek iné (balkón, samostatné posuvy). Má ťahať názov systému, ktorý
// plán naozaj počíta.
import { nazovSystemu } from './system-nazvy';

/** Slovenské množné číslo: 1 posuv, 2–4 posuvy, 5+ posuvov.
 *  Zachované pre backward compat (interné typy / iné moduly). */
export function posuvySlovom(n: number): string {
	if (n === 1) return '1 posuv';
	if (n >= 2 && n <= 4) return `${n} posuvy`;
	return `${n} posuvov`;
}

/** Slovenské množné číslo: 1 zasklenie, 2–4 zasklenia, 5+ zasklení.
 *  (#468) User-facing label pre multi režim zasklení. */
export function zaskleniaSlovom(n: number): string {
	if (n === 1) return '1 zasklenie';
	if (n >= 2 && n <= 4) return `${n} zasklenia`;
	return `${n} zasklení`;
}

/**
 * Badge nad viac-zaskleniový plánom: systém(y), ktoré plán ťahá + počet zasklení.
 * Jeden systém → „Štandard plus · 3 zasklenia”. Zmiešané → všetky, v poradí.
 *
 * Systémy sa vypisujú ZOBRAZOVANÝM názvom (`nazovSystemu`), nie kľúčom konfigurácie —
 * dedup ide ešte po kľúči, aby sa dva rôzne systémy nikdy nezliali do jedného.
 */
export function popisMulti(posuvy: { system: string }[]): string {
	const systemy = [...new Set(posuvy.map((p) => p.system).filter(Boolean))].map(nazovSystemu);
	const hlavicka = systemy.length ? systemy.join(', ') : 'Zasklenia';
	return `${hlavicka} · ${zaskleniaSlovom(posuvy.length)}`;
}
