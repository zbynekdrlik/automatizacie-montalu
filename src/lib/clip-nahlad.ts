// CLIP vizualizácia zábradlia (#554) — čistá geometria SVG náhľadu výplní s priečkami.
// Klientsky bezpečné (žiadny import zo `$lib/server/*`, žiadne browser API) — kreslí ho
// komponent `ClipNahlad.svelte` a testuje sa bez DOM. Dáta (počet výplní, pozície
// priečok) prichádzajú z `computeClip` (clip.ts) — tu ich len prevedieme na kresliteľnú
// geometriu. Pozície priečok sú 1:1 zo šablóny (Patrik, Excel 37649: „priečka č.1 1003,0").

/** Jedna priečka (deliaca čiara medzi výplňami) v náhľade. */
export interface ClipPriecka {
	/** poradové číslo priečky (od 1, ako v Exceli „priečka č.1") */
	cislo: number;
	/** pozícia od ľavého kraja [mm] — replikované zo šablóny (display-only) */
	mm: number;
	/** pozícia v % z celkovej šírky — na umiestnenie čiary v mierke SVG */
	xPct: number;
}

export interface ClipNahladGeom {
	/** šírka zábradlia [mm] — viewBox nesie skutočné rozmery (mierka) */
	sirka: number;
	/** výška zábradlia [mm] */
	vyska: number;
	/** počet polí (výplní) = počet priečok + 1 */
	poleCount: number;
	/** deliace priečky (prázdne pri 1 výplni) */
	priecky: ClipPriecka[];
}

/**
 * Geometria SVG náhľadu zábradlia. `poziciePriecok` sú mm od ľavého kraja
 * (z `computeClip(...).poziciePriecok`); prázdne pole = jedna výplň (jeden obdĺžnik,
 * žiadna priečka). Počet polí = počet priečok + 1. `xPct` je pozícia čiary v % z
 * celkovej šírky — degenerovaná šírka 0 nepadne (xPct = 0).
 */
export function clipNahladGeom(
	sirka: number,
	vyska: number,
	poziciePriecok: number[]
): ClipNahladGeom {
	const priecky: ClipPriecka[] = poziciePriecok.map((mm, i) => ({
		cislo: i + 1,
		mm,
		xPct: sirka > 0 ? (mm / sirka) * 100 : 0
	}));
	return {
		sirka,
		vyska,
		poleCount: poziciePriecok.length + 1,
		priecky
	};
}
