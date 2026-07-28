// Popisky nad nárezovým plánom. Display-only — do Money odpisu NEJDE nič odtiaľto.
//
// Patrik 2026-07-28: badge nad viac-posuvovým plánom hlásil paušálne „Zimná záhrada",
// aj keď šlo o čokoľvek iné (balkón, samostatné posuvy). Má ťahať názov systému, ktorý
// plán naozaj počíta.

/** Slovenské množné číslo: 1 posuv, 2–4 posuvy, 5+ posuvov. */
export function posuvySlovom(n: number): string {
	if (n === 1) return '1 posuv';
	if (n >= 2 && n <= 4) return `${n} posuvy`;
	return `${n} posuvov`;
}

/**
 * Badge nad viac-posuvovým plánom: systém(y), ktoré plán ťahá + počet posuvov.
 * Jeden systém → „Štandard + · 3 posuvy“. Zmiešané → všetky, v poradí posuvov.
 */
export function popisMulti(posuvy: { system: string }[]): string {
	const systemy = [...new Set(posuvy.map((p) => p.system).filter(Boolean))];
	const hlavicka = systemy.length ? systemy.join(', ') : 'Zasklenia';
	return `${hlavicka} · ${posuvySlovom(posuvy.length)}`;
}
