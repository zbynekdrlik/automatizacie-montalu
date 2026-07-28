// Ručne zadaná dĺžka koľajnice (Patrik 2026-07-28).
//
// Normálne sa horná aj spodná koľajnica režú na ŠÍRKU otvoru (`S`). Pri štandardoch
// (a občas pri Deluxe) dielňa potrebuje INÚ dĺžku, a hornú vs spodnú rôznu — Patrikov
// prípad: horná 2690 mm, spodná 2695 mm. Robust a Slide to mať nemôžu: majú jednu
// obvodovú koľajnicu (rezanú aj na šírku aj na výšku), nie hornú + spodnú.
//
// MONEY-KRITICKÉ: zmenená dĺžka rezu mení balenie na tyče → mení metre v odpise.
// To je presne to, čo Patrik chce (odpíše sa to, čo sa naozaj poreže). Prázdne pole
// = pôvodný výpočet zo šírky, takže bez zadania sa nič nemení.

/** Kým sa dá koľajnica zadať ručne — dolná hranica proti preklepu (26 mm namiesto 2690). */
export const KOLAJNICA_MIN = 300;
/** Horná hranica = dĺžka tyče. Dlhší kus sa z tyče nedá vyrobiť (rieši aj `oversizeCut`). */
export const KOLAJNICA_MAX = 7500;

export type RolaKolajnice = 'horna' | 'spodna';

/** Ručné dĺžky koľajníc jedného posuvu. Chýbajúca hodnota = počítaj zo šírky. */
export interface KolajnicaRucne {
	horna?: number;
	spodna?: number;
}

/**
 * Rola profilu podľa jeho názvu v konfigurácii — `Koľajnica horná 4K Surový 7500 mm`
 * → `horna`. Systémy s jednou obvodovou koľajnicou (`Koľajnica 2K Surový …` u Robust /
 * Slide) vracajú `null`, takže ručné zadanie sa ich nikdy nedotkne.
 */
export function rolaKolajnice(nazov: string): RolaKolajnice | null {
	const n = String(nazov ?? '');
	// pozor: `\b` po „horná" NEFUNGUJE — `á` nie je ASCII slovný znak, takže hranica
	// slova sa za ním nevytvorí a regex by nikdy nesedel (zachytené testom)
	if (/^Koľajnica\s+horná(\s|$)/i.test(n)) return 'horna';
	if (/^Koľajnica\s+spodná(\s|$)/i.test(n)) return 'spodna';
	return null;
}

/** Je zadaná aspoň jedna ručná dĺžka? (prázdny objekt = pôvodný výpočet) */
export function maRucnuKolajnicu(k: KolajnicaRucne | null | undefined): boolean {
	return !!k && ((k.horna ?? 0) > 0 || (k.spodna ?? 0) > 0);
}

/** Popis pre plán / tlač — čo dielňa reže ručne. Prázdny reťazec = nič ručné. */
export function popisRucnejKolajnice(k: KolajnicaRucne | null | undefined): string {
	if (!maRucnuKolajnicu(k)) return '';
	const casti: string[] = [];
	if ((k?.horna ?? 0) > 0) casti.push(`horná ${k?.horna} mm`);
	if ((k?.spodna ?? 0) > 0) casti.push(`spodná ${k?.spodna} mm`);
	return `koľajnica ručne: ${casti.join(' · ')}`;
}
