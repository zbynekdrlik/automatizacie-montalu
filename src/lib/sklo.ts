// Zdieľané pomôcky pre SKLO v zaskleniach — používa ich formulár, plán aj náhľad.
// Display-only: nič odtiaľto nevstupuje do Money odpisu.

/**
 * Predvolené sklo pre nový posuv: VŽDY ČÍRE, ak ho zvolený systém má
 * (Patrik 2026-07-27: „pri posuvoch ako primárne sklo vždy číre"), inak prvé
 * v poradí katalógu.
 *
 * Money-neutrálne: sklozávislé riadky (redukcia 6 mm, ZASP00091) existujú LEN
 * v Slide, a tam majú 4/8/4 mliečne aj 4/8/4 číre `redukcia_zero = 1` — takže
 * zmena predvoľby nemení ani jeden odpisový riadok. Overené testom.
 */
export function defaultSklo(skla: string[]): string {
	return skla.find((g) => g.toLowerCase().includes('číre')) ?? skla[0] ?? '';
}

/**
 * Rozmer skla v tvare, ktorý dielňa kopíruje priamo do objednávky skla:
 * jednotka hneď za číslom, medzera × medzera (Patrik 2026-07-27: „1050mm x
 * 2115mm … by som si to vedel hneď kopírovať na objednávku skla").
 * Sklo sa objednáva na celé milimetre, takže zaokrúhľujeme.
 */
export function fmtSkloRozmer(sirka: number, vyska: number): string {
	return `${Math.round(sirka)}mm × ${Math.round(vyska)}mm`;
}
