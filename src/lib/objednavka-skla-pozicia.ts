// #563: čisté (client-safe, bez IO) helpery podkladu objednávky skla — popis pozície, plocha
// tabule, nadpis. Patrik (Odoo úloha 625, 23.9.): výrobu „nezaujíma kam to dávame" → popis riadka
// je len „Zasklenie N"; m² vyplnené vopred; nadpis = OP + zákazník. Money-NEUTRÁLNE.

// Popis riadkov spred #563 (multi producent): „Zasklenie 1: Robust 3K" — časť za dvojbodkou je
// systém/štýl, ktorý výrobu nezaujíma.
const POZICIA_SO_SYSTEMOM = /^(Zasklenie \d+):/;

/**
 * Zobrazovaný popis pozície: „Zasklenie N: <systém> <štýl>" → „Zasklenie N" (staré riadky spred
 * #563 sa tak zobrazia rovnako ako nové). Iné popisy (FIX pole, pergola, ručné riadky) nezmenené.
 */
export function popisPozicie(popis: string): string {
	const m = POZICIA_SO_SYSTEMOM.exec(popis);
	return m ? m[1]! : popis;
}

/** Plocha tabúľ riadka v m² = šírka × výška × kusy / 1e6 (jeden vzorec pre všetkých producentov). */
export function m2Tabule(sirkaMm: number, vyskaMm: number, pocet: number): number {
	return (sirkaMm * vyskaMm * pocet) / 1e6;
}

/**
 * Nadpis podkladu (za „Objednávka skla — "): OP + zákazník (vzor 37880 „OPDL260238 Bondiro").
 * Bez zákazníka len OP; bez OP číslo zákazky (servisný podklad bez odpisu aj bez OP).
 */
export function nadpisObjednavky(p: { zak: string; op: string; zakaznik: string }): string {
	const op = p.op.trim();
	if (!op) return p.zak;
	const zakaznik = p.zakaznik.trim();
	return zakaznik ? `${op} ${zakaznik}` : op;
}
