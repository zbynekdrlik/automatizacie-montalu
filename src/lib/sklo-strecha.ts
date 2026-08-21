// Mapovanie typu strešného skla pergoly na Money TS kód (cenník IZOS) — DISPLAY-ONLY
// cenová informácia (#235, cesta A). Money ODPIS sa tým NEMENÍ: strešné aj obvodové sklo
// je v pergole informatívne, žiadny Money zápis (statický guard
// tests/pergola-narez-money-safety.test.ts). Typy = A2 zoznam od Dominika (#198), kódy s
// DÔKAZOM v Money názve (read-only lookup 21.8., #235 comment 5370182946). Typ bez
// potvrdeného kódu = `null` → „cena neznáma" (honest-null), NIKDY 0 € — Money má reálne
// kódy kde Cena=0 = „nikdy zadané".
//
// PURE dátový modul (žiadne DB/SvelteKit závislosti) — priamo unit-testovateľný a
// pripravený na konzumáciu #223 (sklo v streche: rozmer + cena + odpis), ktorý raz zmení
// dnešný voľný text `strechaSklo` na výber zo `SKLO_STRECHA_TYPY` a cez `moneyKod` vytiahne
// €/m² zo snapshotu (`ceny.ts` → `cenaZaM2`). Dovtedy modul zámerne NEMÁ UI konzumenta
// (majiteľ ROZHODNUTÉ cesta A, #235: nemeniť UX pergoly, zobrazenie ceny nechať na #223).

export interface SkloStrechaTyp {
	/** kanonický názov variantu strešného skla (kľúč mapovania + budúci label v #223) */
	nazov: string;
	/** Money TS kód (cenník IZOS) alebo `null` = žiadny potvrdený kód → „cena neznáma" */
	moneyKod: string | null;
}

/** Najčastejšie varianty strešného skla pergoly (A2, #198) + ich Money TS kód. 6 potvrdených
 *  (dôkaz v Money názve), 8 zatiaľ bez kódu (Dominik doplní/založí do cenníka — otázka je na
 *  #198, tu sa NErieši). Poradie: lepené → izolačné → variácia skladby → polykarbonát → STADUR. */
export const SKLO_STRECHA_TYPY: readonly SkloStrechaTyp[] = [
	// Lepené (VSG)
	{ nazov: '4.4.2 číre', moneyKod: 'TS00070' }, // Lepené sklo 4.4.2 s čírou fóliou
	{ nazov: '4.4.2 mliečne', moneyKod: 'TS00071' }, // Lepené sklo 4.4.2 s matnou fóliou
	{ nazov: '5.5.2 číre', moneyKod: 'TS00076' }, // Lepené sklo 5.5.2 s čírou fóliou
	{ nazov: '5.5.2 mliečne', moneyKod: null }, // Money nemá 5.5.2 matný kód
	// Izolačné
	{ nazov: 'IZO 4.4.2-8-6 číre', moneyKod: 'TS00014' }, // Izolačné sklo 4.4.2-8- 6 číre
	{ nazov: 'IZO 4.4.2-8-6 mliečne', moneyKod: 'TS00129' }, // Izolačné sklo 4.4.2-8- 6 mliečne
	{ nazov: 'IZO 4.4.2-10-6', moneyKod: null },
	{ nazov: 'IZO 5.5.2-8-6', moneyKod: null },
	{ nazov: 'IZO 5.5.2-10-6', moneyKod: null },
	// Variácia skladby
	{ nazov: '4.4.2 mliečne/8/6 mliečne', moneyKod: 'TS00012' }, // Izolačné sklo 4.4.2 mliečne/8/6 mliečne
	// Polykarbonát 16 mm
	{ nazov: 'polykarbonát 16 mm číry', moneyKod: null },
	{ nazov: 'polykarbonát 16 mm mliečny', moneyKod: null },
	{ nazov: 'polykarbonát 16 mm bronz', moneyKod: null },
	// STADUR
	{ nazov: 'STADUR 24 mm', moneyKod: null }
];

/** Money TS kód pre variant strešného skla (podľa presného názvu). `null` keď typ nemá
 *  potvrdený kód alebo názov nie je v katalógu → „cena neznáma" (honest-null, nič sa
 *  nedopočítava). */
export function skloStrechaMoneyKod(nazov: string): string | null {
	return SKLO_STRECHA_TYPY.find((t) => t.nazov === nazov)?.moneyKod ?? null;
}
