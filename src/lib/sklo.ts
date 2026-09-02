// Zdieľané pomôcky pre SKLO v zaskleniach — používa ich formulár, plán aj náhľad.
// Display-only: nič odtiaľto nevstupuje do Money odpisu.

/**
 * Predvolené sklo pre nový posuv:
 *  - **Deluxe**: primárne sklo „10 mm" (Patrik 2026-09-02, #431 — predtým prvé
 *    v poradí = 6 mm; Deluxe nemá „číre"); ak by 10 mm sklo v ponuke nebolo,
 *    spadne na spoločné pravidlo nižšie.
 *  - ostatné systémy: VŽDY ČÍRE, ak ho systém má (Patrik 2026-07-27: „pri
 *    posuvoch ako primárne sklo vždy číre"), inak prvé v poradí katalógu.
 *
 * Predvoľba je len prednastavenie — obsluha sklo stále VOLÍ a odpis sa počíta
 * zo ZVOLENÉHO skla, takže odpis pre KONKRÉTNE sklo je nezmenený. POZOR: pri
 * Deluxe posun predvoľby 6→10 mm mení, KTORÉ sklo je prednastavené (10 mm dáva
 * úplnejší odpis — 10 mm krytky sú v Money, 6 mm sú vynechané pre 0 ks sklad,
 * #354). Sklo vplýva na odpis troma kanálmi: Slide (`redukcia_zero`), Deluxe
 * (`hrubka` vyberá kladka/klzný profil) a Štandard +/Štandard (IZO sklo prepína
 * nárezák cez `sysStylPre`). Overené testom (`tests/sklo-default.test.ts`).
 */
export function defaultSklo(skla: string[], system?: string): string {
	// Deluxe: primárne 10 mm (#431). Bez tejto vetvy by predvoľba padla na prvé
	// v poradí (6 mm). Match na „10 mm" v názve („Float kalené 10 mm"); ak sa
	// nenájde, prejde na spoločné pravidlo (graceful degrade, nikdy pád).
	if (system === 'Deluxe') {
		const desat = skla.find((g) => g.toLowerCase().includes('10 mm'));
		if (desat) return desat;
	}
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
