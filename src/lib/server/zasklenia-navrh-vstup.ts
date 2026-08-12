// Zasklenia — návrhový výkres (#162): parsovanie a serverová validácia
// formulárového vstupu. Rovnaká disciplína ako `pergola-navrh-vstup.ts` — žije
// v $lib/server, aby sa dalo priamo unit-testovať bez SvelteKit routovania.
// Číselné rozsahy stráži `chybaZaskleniaNavrhVstupu` v `$lib/zasklenia-navrh.ts`
// — tento modul len parsuje + dopĺňa `n` (počet krídel) zo `styly` (ZNOVUPOUŽITÉ
// z `listSysStyly()`, nikdy neprepočítané tu).
import {
	chybaZaskleniaNavrhVstupu,
	VYKRES_REZIM_DEFAULT,
	type ZaskleniaNavrhVstup
} from '$lib/zasklenia-navrh';
import { KLIN_MAX_KS, KLIN_MAX_ROZMER, KLIN_MIN_ROZMER, type Klin } from '$lib/klin';
import { KOLAJNICA_MAX, KOLAJNICA_MIN, type KolajnicaRucne } from '$lib/kolajnica';
import type { VykresRezim } from '$lib/vykres/ral';

export interface SysStylRow {
	sysStyl: string;
	system: string;
	styl: string;
	N: number;
}

function num(form: FormData, k: string): number {
	const x = parseFloat(String(form.get(k) ?? '').replace(',', '.'));
	return Number.isFinite(x) ? x : 0;
}

function numOrUndefined(form: FormData, k: string, min: number, max: number): number | undefined {
	const raw = String(form.get(k) ?? '').trim();
	if (!raw) return undefined;
	const x = parseFloat(raw.replace(',', '.'));
	if (!Number.isFinite(x) || x < min || x > max) return undefined;
	return x;
}

const text = (form: FormData, k: string, max: number) =>
	String(form.get(k) ?? '')
		.trim()
		.slice(0, max);

function parseKlin(form: FormData): Klin | null {
	if (String(form.get('klinZapnuty') ?? '') !== '1') return null;
	const dlzka = num(form, 'klinDlzka');
	const sirka = num(form, 'klinSirka');
	const v1 = num(form, 'klinV1');
	const v2 = num(form, 'klinV2');
	const ks = Math.round(num(form, 'klinKs')) || 1;
	if (dlzka <= 0 && sirka <= 0) return null;
	return {
		dlzka: Math.min(Math.max(dlzka, KLIN_MIN_ROZMER), KLIN_MAX_ROZMER),
		sirka: Math.min(Math.max(sirka, KLIN_MIN_ROZMER), KLIN_MAX_ROZMER),
		v1: Math.min(Math.max(v1, 0), KLIN_MAX_ROZMER),
		v2: Math.min(Math.max(v2, 0), KLIN_MAX_ROZMER),
		ks: Math.min(Math.max(ks, 1), KLIN_MAX_KS)
	};
}

function parseKolajnica(form: FormData): KolajnicaRucne | null {
	const horna = numOrUndefined(form, 'kolajnicaHorna', KOLAJNICA_MIN, KOLAJNICA_MAX);
	const spodna = numOrUndefined(form, 'kolajnicaSpodna', KOLAJNICA_MIN, KOLAJNICA_MAX);
	if (horna === undefined && spodna === undefined) return null;
	return { horna, spodna };
}

function rezimVykresu(form: FormData): VykresRezim {
	return text(form, 'rezimVykresu', 20) === 'farebny' ? 'farebny' : VYKRES_REZIM_DEFAULT;
}

export function parseZaskleniaNavrhVstup(
	form: FormData,
	styly: SysStylRow[]
): { vstup: ZaskleniaNavrhVstup; error: string | null } {
	const system = text(form, 'system', 40);
	const styl = text(form, 'styl', 40);
	const sysStyl = `${system}|${styl}`;
	const najdene = styly.find((x) => x.sysStyl === sysStyl);

	const vstup: ZaskleniaNavrhVstup = {
		system,
		styl,
		sysStyl,
		// n = 0 pri neplatnej kombinácii systém+štýl -> chybaZaskleniaNavrhVstupu
		// ho odmietne (N_MIN=1), nikdy tichý fallback na hocijaké číslo
		n: najdene?.N ?? 0,
		s: num(form, 's'),
		v: num(form, 'v'),
		otvaranie: text(form, 'otvaranie', 20),
		klin: parseKlin(form),
		kolajnica: parseKolajnica(form),
		nazov: text(form, 'nazov', 80),
		ral: text(form, 'ral', 40),
		ralKod: text(form, 'ralKod', 10),
		rezimVykresu: rezimVykresu(form)
	};

	if (!najdene) return { vstup, error: 'Vyber platnú kombináciu systém + štýl.' };
	const error = chybaZaskleniaNavrhVstupu(vstup);
	return { vstup, error };
}
