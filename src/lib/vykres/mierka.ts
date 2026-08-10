// Čestný výpočet tlačovej MIERKY pre rohovú pečiatku návrhového výkresu (#137, bod 4
// zadania: „tlač z prehliadača negarantuje presnú mierku 1:20 na papieri. Pečiatka
// uvedie vypočítanú približnú mierku, alebo „—", NIKDY nepravdivé 1:20.").
//
// Prehliadačová tlač do PDF nevie zaručiť fyzickú presnosť (užívateľove nastavenia
// tlačiarne, "Fit to page" a pod.), takže táto funkcia vracia len ORIENTAČNÝ,
// VYPOČÍTANÝ pomer medzi reálnym rozmerom kresleného obsahu (mm) a plochou papiera,
// ktorú ten obsah zaberá (mm) — nikdy pevne zadanú konštantu.

/** Vypočíta orientačnú tlačovú mierku „≈1:N" z reálneho rozmeru kresleného obsahu
 *  (mm) a plochy papiera dostupnej preň (mm, po odčítaní okrajov/pečiatky). Limitujúci
 *  rozmer (ten, ktorý by pretiekol viac) určuje výsledný pomer. Vráti „—" pri
 *  neplatných/nezmyselných vstupoch — NIKDY nevráti natvrdo predpokladanú hodnotu. */
export function vypocitajMierku(
	mmSirka: number,
	mmVyska: number,
	paperMmSirka: number,
	paperMmVyska: number
): string {
	if (!(mmSirka > 0) || !(mmVyska > 0) || !(paperMmSirka > 0) || !(paperMmVyska > 0)) return '—';
	const pomer = Math.max(mmSirka / paperMmSirka, mmVyska / paperMmVyska);
	if (!Number.isFinite(pomer) || pomer <= 0) return '—';
	// zaokrúhlené na celé číslo — pečiatka ukazuje "≈1:23", nie falošnú presnosť na desatiny
	const n = Math.max(1, Math.round(pomer));
	return `≈1:${n}`;
}
