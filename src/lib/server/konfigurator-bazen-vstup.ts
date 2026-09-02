// Parser + validácia vstupu pre bazénovú `vypocet` akciu (#404) — model + dĺžka + šírka na výpočet
// orientačnej ceny. Žije mimo +page.server.ts (SvelteKit dovolí exportovať len load/actions/…), takže
// sa dá priamo unit-testovať (nova-stranka pasca #1). Server-only ($lib/server/): importuje LEN
// client-safe `konfigurator-bazen` (rozmedzia + whitelist modelu, žiadny Money kód, žiadna cena).
import {
	BAZEN_DLZKA_MIN,
	BAZEN_DLZKA_MAX,
	BAZEN_SIRKA_MIN,
	BAZEN_SIRKA_MAX,
	bazenModel,
	type BazenModel
} from '$lib/konfigurator-bazen';

/** Číslo zo vstupu: akceptuje desatinnú čiarku aj medzery (napr. „6 000", „4,5"). */
function cislo(v: FormDataEntryValue | null | undefined): number {
	return Number(
		String(v ?? '')
			.replace(',', '.')
			.replace(/\s/g, '')
	);
}

export interface BazenCenaVstup {
	/** dĺžka zastrešenia [mm] → montalu `length` */
	dlzkaMm: number;
	/** šírka zastrešenia [mm] → montalu `width` */
	sirkaMm: number;
	/** model bazénového zastrešenia (whitelist) */
	model: BazenModel;
}

/** Sparsuje FormData na typovaný bazénový cenový vstup, alebo vráti { error } (slovenčina).
 *  Rozmery mimo rozmedzia → odmietnuté; model cez whitelist (`bazenModel`, neznámy → default Premier). */
export function parseBazenCenaVstup(fd: FormData): { vstup: BazenCenaVstup } | { error: string } {
	const dlzkaMm = cislo(fd.get('dlzka'));
	if (!Number.isFinite(dlzkaMm) || dlzkaMm < BAZEN_DLZKA_MIN || dlzkaMm > BAZEN_DLZKA_MAX)
		return { error: `Dĺžka musí byť ${BAZEN_DLZKA_MIN}–${BAZEN_DLZKA_MAX} mm.` };

	const sirkaMm = cislo(fd.get('sirka'));
	if (!Number.isFinite(sirkaMm) || sirkaMm < BAZEN_SIRKA_MIN || sirkaMm > BAZEN_SIRKA_MAX)
		return { error: `Šírka musí byť ${BAZEN_SIRKA_MIN}–${BAZEN_SIRKA_MAX} mm.` };

	const model = bazenModel(String(fd.get('model') ?? ''));

	return { vstup: { dlzkaMm, sirkaMm, model } };
}
