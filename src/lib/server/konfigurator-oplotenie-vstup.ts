// Parser + validácia vstupu pre oplotenie `vypocet` akciu (#410) — typ + model + výška + šírka + počet
// na výpočet orientačnej ceny. Žije mimo +page.server.ts (SvelteKit dovolí exportovať len load/actions/…),
// takže sa dá priamo unit-testovať (nova-stranka pasca #1). Server-only ($lib/server/): importuje LEN
// client-safe `konfigurator-oplotenie` (rozmedzia + whitelist typu/modelu, žiadny Money kód, žiadna cena).
import {
	OPLOTENIE_VYSKA_MIN,
	OPLOTENIE_VYSKA_MAX,
	OPLOTENIE_SIRKA_MIN,
	OPLOTENIE_SIRKA_MAX,
	OPLOTENIE_POCET_MIN,
	OPLOTENIE_POCET_MAX,
	oplotenieTyp,
	oplotenieModel,
	type OplotenieTypKod,
	type OplotenieModel
} from '$lib/konfigurator-oplotenie';

/** Číslo zo vstupu: akceptuje desatinnú čiarku aj medzery (napr. „1 800", „1,8"). */
function cislo(v: FormDataEntryValue | null | undefined): number {
	return Number(
		String(v ?? '')
			.replace(',', '.')
			.replace(/\s/g, '')
	);
}

export interface OplotenieCenaVstup {
	/** typ prvku (whitelist) */
	typ: OplotenieTypKod;
	/** model výplne (whitelist) */
	model: OplotenieModel;
	/** výška prvku [mm] → montalu `height` */
	vyskaMm: number;
	/** šírka prvku [mm] → montalu `width` */
	sirkaMm: number;
	/** počet kusov (celé číslo v rozmedzí) */
	pocet: number;
}

/** Sparsuje FormData na typovaný oplotenie cenový vstup, alebo vráti { error } (slovenčina).
 *  Rozmery/počet mimo rozmedzia → odmietnuté; typ/model cez whitelist (neznámy → bezpečný default). */
export function parseOplotenieCenaVstup(
	fd: FormData
): { vstup: OplotenieCenaVstup } | { error: string } {
	const vyskaMm = cislo(fd.get('vyska'));
	if (!Number.isFinite(vyskaMm) || vyskaMm < OPLOTENIE_VYSKA_MIN || vyskaMm > OPLOTENIE_VYSKA_MAX)
		return { error: `Výška musí byť ${OPLOTENIE_VYSKA_MIN}–${OPLOTENIE_VYSKA_MAX} mm.` };

	const sirkaMm = cislo(fd.get('sirka'));
	if (!Number.isFinite(sirkaMm) || sirkaMm < OPLOTENIE_SIRKA_MIN || sirkaMm > OPLOTENIE_SIRKA_MAX)
		return { error: `Šírka musí byť ${OPLOTENIE_SIRKA_MIN}–${OPLOTENIE_SIRKA_MAX} mm.` };

	const pocet = cislo(fd.get('pocet'));
	if (!Number.isInteger(pocet) || pocet < OPLOTENIE_POCET_MIN || pocet > OPLOTENIE_POCET_MAX)
		return { error: `Počet kusov musí byť ${OPLOTENIE_POCET_MIN}–${OPLOTENIE_POCET_MAX}.` };

	const typ = oplotenieTyp(String(fd.get('typ') ?? ''));
	const model = oplotenieModel(String(fd.get('model') ?? ''));

	return { vstup: { typ, model, vyskaMm, sirkaMm, pocet } };
}
