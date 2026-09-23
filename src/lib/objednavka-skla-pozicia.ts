// #563: čisté (client-safe, bez IO) helpery podkladu objednávky skla — popis pozície, plocha
// tabule, nadpis. Patrik (Odoo úloha 625, 23.9.): výrobu „nezaujíma kam to dávame" → popis riadka
// je len „Zasklenie N"; m² vyplnené vopred; nadpis = OP + zákazník. Money-NEUTRÁLNE.

// Pozícia zasklenia na začiatku popisu: nové riadky „Zasklenie N", staré multi „Zasklenie N: Robust 3K".
const POZICIA = /^(Zasklenie \d+)(?::|$)/;

/**
 * Popis POZÍCIE riadka (zobrazenie + Odoo `description`/`note`). LEN pre `modul='zasklenia'`:
 * „Zasklenie N[: <systém> <štýl>]" → „Zasklenie N"; starý single riadok spred #563 (popis len
 * „<systém> <štýl>" = jediný posuv) → „Zasklenie 1". Iné moduly (FIX pole, pergola, ručné riadky —
 * voľný text operátora) NEMENÍ, ani keď text začína „Zasklenie N:".
 */
export function popisPozicie(popis: string, modul: string): string {
	if (modul !== 'zasklenia') return popis;
	const m = POZICIA.exec(popis.trim());
	return m ? m[1]! : 'Zasklenie 1';
}

/** Plocha tabúľ riadka v m² = šírka × výška × kusy / 1e6 (jeden vzorec pre všetkých producentov). */
export function m2Tabule(sirkaMm: number, vyskaMm: number, pocet: number): number {
	return (sirkaMm * vyskaMm * pocet) / 1e6;
}

/** Rozmerové polia riadka potrebné na zobrazenie rozmeru (podmnožina `SkloPolozka`). */
export interface RozmerTabule {
	sirkaMm: number;
	vyskaMm: number | null;
	vLavoMm: number | null;
	vPravoMm: number | null;
	sikmy: boolean;
}

/**
 * #565: riadok BEZ rozmerov = atyp zadaný výkresom (Patrik, Odoo úloha 1051 — viac tvarov, jeden
 * rozmer neexistuje). Uložený ako `sirka_mm = 0` (stĺpec NOT NULL, bez migrácie), `vyska_mm = NULL`.
 * Šikmý FIX (výška null, ale v_lavo/v_pravo) sem NEPATRÍ.
 */
export function bezRozmerov(p: RozmerTabule): boolean {
	return !p.sikmy && p.sirkaMm <= 0;
}

/** Zobrazenie rozmeru riadka podkladu: „š × v mm", „š × Ľ/P mm (šikmé)", bez rozmerov „podľa výkresu". */
export function fmtRozmerTabule(p: RozmerTabule): string {
	if (bezRozmerov(p)) return 'podľa výkresu';
	if (p.sikmy) {
		return `${Math.round(p.sirkaMm)} × ${Math.round(p.vLavoMm ?? 0)}/${Math.round(p.vPravoMm ?? 0)} mm (šikmé)`;
	}
	return `${Math.round(p.sirkaMm)} × ${Math.round(p.vyskaMm ?? 0)} mm`;
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
