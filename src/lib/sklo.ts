// Zdieľané pomôcky pre SKLO v zaskleniach — používa ich formulár, plán aj náhľad.
// Display-only: nič odtiaľto nevstupuje do Money odpisu.
import { SYSTEMY_SKLO_VYBERA_IZO, jeIzoSklo } from './styl';

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
 * Deluxe posun predvoľby 6→10 mm mení, KTORÉ sklo je prednastavené — 10 mm aj
 * 6 mm krytky sú od #431 kolo 2 v Money podľa RAL (6 mm R9006/R9005, 10 mm
 * R9006/R7016), 10 mm ostáva len predvolené sklo. Sklo vplýva na odpis troma kanálmi: Slide (`redukcia_zero`), Deluxe
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
	// Štandard +/Štandard/Štandard Drevo (#235, v43): katalóg teraz obsahuje IZO sklá
	// s „číre" v názve (napr. „Izolačné sklo 4/8/4 číre"). Bez tejto vetvy by sa IZO
	// sklo stalo defaultom (prvé „číre" v katalógu) a zmenilo Money povrch — sysStylPre
	// by vybral IZO nárezák + pridavnaKolajnicaDefault by zaškrtol koľajnicu.
	// Fix: pre systémy kde skloVyberaIzo, hľadaj „číre" LEN v non-IZO sklách.
	if (system && SYSTEMY_SKLO_VYBERA_IZO.includes(system)) {
		const nonIzo = skla.filter((g) => !jeIzoSklo(g));
		const cire = nonIzo.find((g) => g.toLowerCase().includes('číre'));
		if (cire) return cire;
		if (nonIzo.length > 0) return nonIzo[0]!;
		// fallback: ak by neostalo žiadne non-IZO sklo, použi prvé akékoľvek
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

// ---- Vlastná (nekatalógová) skladba skla v nárezáku (#235 slice 2) ----
//
// Patrik (11.9., úloha 625): v nárezáku objednáva aj skladby, ktoré nie sú v katalógu
// (napr. „5esg/14/5esg"), a doteraz ich ručne prepisoval. `SKLO_INE` je SENTINEL voľby
// v glass selecte — NIE je to riadok v `glass_types`. Keď je zvolený, sklo je zadané
// voľným textom (`skloPresne`) + hrúbkovou triedou skladby (`skloTrieda`):
//   • VÝPOČET beží zo SYNTETICKÉHO skla odvodeného z triedy (server `skloPre`) —
//     bit-identicky ako katalógové sklo tej istej triedy;
//   • CENA je honest-null (`glassMoneyKod(sentinel)` → null → „cena nedostupná");
//   • ZOBRAZENIE na pláne/tlači/objednávke je `skloPresne` (text).
export const SKLO_INE = 'Iné (vlastná skladba)';

/** Hrúbkové triedy skladby ponúkané pri vlastnom skle (mm). Odvodené znaky:
 *  - hrúbková trieda (`hrubkaTrieda` 6/16): >=16 ⇒ izolačné dvojsklo, inak jednoduché
 *    (Slide `redukcia_zero`, Štandard IZO nárezák, triedová korekcia);
 *  - Deluxe fyzická hrúbka (kladka/klzný profil): 10 ⇒ 10 mm, inak 6 mm;
 *  - tesnenie (Štandard): 4⇒ZASK00005, 6⇒ZASK00006, 10⇒nezname, 16/24⇒izolačné/bez gumy. */
export const SKLO_TRIEDY = [4, 6, 10, 16, 24] as const;
export type SkloTrieda = (typeof SKLO_TRIEDY)[number];

/** Je `x` jedna z povolených hrúbkových tried vlastného skla? */
export function jeSkloTrieda(x: unknown): x is SkloTrieda {
	return typeof x === 'number' && (SKLO_TRIEDY as readonly number[]).includes(x);
}

/** Hrúbková trieda skladby (6|16) syntetického vlastného skla z Patrikovej triedy
 *  — jednoduché sklo (4/6/10 mm) ⇒ 6, izolačné dvojsklo (16/24 mm) ⇒ 16. */
export function ineHrubkaTrieda(trieda: SkloTrieda): 6 | 16 {
	return trieda >= 16 ? 16 : 6;
}

/** Fyzická hrúbka skla (mm) syntetického vlastného skla — vyberá Deluxe kladka/klzný
 *  profil; mimo Deluxe je 0 (bit-identické s katalógom — hrubka je Deluxe-only). */
export function ineHrubka(system: string, trieda: SkloTrieda): number {
	if (system !== 'Deluxe') return 0;
	return trieda === 10 ? 10 : 6;
}
