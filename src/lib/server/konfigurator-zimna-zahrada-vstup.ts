// Parser + validácia vstupu pre `vypocet` akciu zimnej záhrady (#408) — hĺbka + šírka + zasklenie +
// model na výpočet orientačnej ceny. Žije mimo +page.server.ts (SvelteKit dovolí exportovať len
// load/actions/…), takže sa dá priamo unit-testovať (nova-stranka pasca #1). Server-only ($lib/server/):
// importuje LEN client-safe `konfigurator-zimna-zahrada` (rozmedzia + whitelist, žiadny Money kód,
// žiadna cena).
import {
	ZZ_SIRKA_MIN,
	ZZ_SIRKA_MAX,
	ZZ_HLBKA_MIN,
	ZZ_HLBKA_MAX,
	zzModel,
	zzZasklenie,
	type ZzModel
} from '$lib/konfigurator-zimna-zahrada';

/** Číslo zo vstupu: akceptuje desatinnú čiarku aj medzery (napr. „4 000", „4,5"). */
function cislo(v: FormDataEntryValue | null | undefined): number {
	return Number(
		String(v ?? '')
			.replace(',', '.')
			.replace(/\s/g, '')
	);
}

export interface ZzCenaVstup {
	/** hĺbka (vysunutie od steny) [mm] → montalu `length` */
	hlbkaMm: number;
	/** šírka (pozdĺž steny) [mm] → montalu `width` */
	sirkaMm: number;
	/** kategória strešného zasklenia (whitelist nazov) */
	zasklenie: string;
	/** model konštrukcie (whitelist) — display label */
	model: ZzModel;
}

/** Sparsuje FormData na typovaný cenový vstup zimnej záhrady, alebo vráti { error } (slovenčina).
 *  Rozmery mimo rozmedzia → odmietnuté; zasklenie/model cez whitelist (neznámy → default). */
export function parseZzCenaVstup(fd: FormData): { vstup: ZzCenaVstup } | { error: string } {
	const hlbkaMm = cislo(fd.get('hlbka'));
	if (!Number.isFinite(hlbkaMm) || hlbkaMm < ZZ_HLBKA_MIN || hlbkaMm > ZZ_HLBKA_MAX)
		return { error: `Hĺbka musí byť ${ZZ_HLBKA_MIN}–${ZZ_HLBKA_MAX} mm.` };

	const sirkaMm = cislo(fd.get('sirka'));
	if (!Number.isFinite(sirkaMm) || sirkaMm < ZZ_SIRKA_MIN || sirkaMm > ZZ_SIRKA_MAX)
		return { error: `Šírka musí byť ${ZZ_SIRKA_MIN}–${ZZ_SIRKA_MAX} mm.` };

	const zasklenie = zzZasklenie(fd.get('zasklenie') ? String(fd.get('zasklenie')) : '');
	const model = zzModel(fd.get('model') ? String(fd.get('model')) : '');

	return { vstup: { hlbkaMm, sirkaMm, zasklenie, model } };
}
