// Parser + validácia vstupu nárezového optimalizátora (#212). Žije mimo
// +page.server.ts (SvelteKit dovolí exportovať z +page.server.ts len
// load/actions/…), takže sa dá priamo unit-testovať — viď nova-stranka pasca #1.
// Čistý, bez Money/DB zápisu (kalkulačka).

export interface KusVstup {
	/** dĺžka jedného kusa (mm) */
	dlzka: number;
	/** koľko kusov tejto dĺžky */
	pocet: number;
}

export interface OptimalizatorVstup {
	/** dĺžka jednej tyče (mm) */
	dlzkaTyce: number;
	/** počet dostupných tyčí */
	pocetTyci: number;
	/** rezná medzera / hrúbka rezu (mm) — Patrikov ručný trik ako pole (default 10) */
	reznaMedzera: number;
	kusy: KusVstup[];
}

/** Číslo zo vstupu: akceptuje desatinnú čiarku aj medzery (napr. „6 000", „2834,5"). */
function cislo(v: FormDataEntryValue | null): number {
	return Number(
		String(v ?? '')
			.replace(',', '.')
			.replace(/\s/g, '')
	);
}

/** Sparsuje FormData na typovaný vstup, alebo vráti { error } s hláškou v slovenčine. */
export function parseOptimalizatorVstup(
	fd: FormData
): { vstup: OptimalizatorVstup } | { error: string } {
	const dlzkaTyce = cislo(fd.get('dlzkaTyce'));
	if (!Number.isFinite(dlzkaTyce) || dlzkaTyce <= 0)
		return { error: 'Zadaj platnú dĺžku tyče (mm).' };

	const pocetTyci = cislo(fd.get('pocetTyci'));
	if (!Number.isInteger(pocetTyci) || pocetTyci < 1)
		return { error: 'Zadaj platný počet tyčí (celé číslo ≥ 1).' };

	const rmRaw = fd.get('reznaMedzera');
	const reznaMedzera = rmRaw === null || String(rmRaw).trim() === '' ? 10 : cislo(rmRaw);
	if (!Number.isFinite(reznaMedzera) || reznaMedzera < 0)
		return { error: 'Rezná medzera musí byť číslo ≥ 0 (mm).' };

	const dlzky = fd.getAll('dlzka');
	const pocty = fd.getAll('pocet');
	const kusy: KusVstup[] = [];
	for (let i = 0; i < dlzky.length; i++) {
		const dRaw = dlzky[i];
		const pRaw = pocty[i];
		// úplne prázdny riadok (bez dĺžky aj bez počtu) sa preskočí
		if (String(dRaw ?? '').trim() === '' && String(pRaw ?? '').trim() === '') continue;
		const dlzka = cislo(dRaw);
		if (!Number.isFinite(dlzka) || dlzka <= 0)
			return { error: `Kus #${kusy.length + 1}: zadaj platnú dĺžku (mm).` };
		const pocet = cislo(pRaw);
		if (!Number.isInteger(pocet) || pocet < 1)
			return { error: `Kus #${kusy.length + 1}: zadaj platný počet (celé číslo ≥ 1).` };
		kusy.push({ dlzka, pocet });
	}
	if (kusy.length === 0) return { error: 'Zadaj aspoň jeden kus (dĺžka + počet).' };

	return { vstup: { dlzkaTyce, pocetTyci, reznaMedzera, kusy } };
}
