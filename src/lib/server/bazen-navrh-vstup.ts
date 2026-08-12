// Bazén — návrhový výkres (#139): parsovanie a serverová validácia formulárového
// vstupu. Rovnaká disciplína ako `pergola-navrh-vstup.ts`/`zasklenia-navrh-vstup.ts`
// — žije v $lib/server, aby sa dalo priamo unit-testovať bez SvelteKit routovania
// (nova-stranka §1: `+page.server.ts` smie exportovať LEN load/actions/…). Číselné
// rozsahy stráži `chybaBazenNavrhVstupu` v `$lib/bazen-navrh.ts` — tento modul len
// parsuje.
import {
	chybaBazenNavrhVstupu,
	BAZEN_NAVRH_REZIM_DEFAULT,
	type BazenNavrhVstup,
	type BazenNavrhVykresRezim,
	type Kolaj,
	type Smer,
	type DvereSmer
} from '$lib/bazen-navrh';

function num(form: FormData, k: string): number {
	const x = parseFloat(String(form.get(k) ?? '').replace(',', '.'));
	return Number.isFinite(x) ? x : 0;
}

function numOrUndefined(form: FormData, k: string): number | undefined {
	const raw = String(form.get(k) ?? '').trim();
	if (!raw) return undefined;
	const x = parseFloat(raw.replace(',', '.'));
	return Number.isFinite(x) ? x : undefined;
}

const text = (form: FormData, k: string, max: number) =>
	String(form.get(k) ?? '')
		.trim()
		.slice(0, max);

function kolaj(form: FormData): Kolaj {
	return text(form, 'kolaj', 20) === 'dvojkolaj' ? 'dvojkolaj' : 'jednokolaj';
}

function smer(form: FormData): Smer {
	return text(form, 'smer', 20) === 'vlavo' ? 'vlavo' : 'vpravo';
}

function dvereSmer(form: FormData): DvereSmer {
	return text(form, 'dvereSmer', 20) === 'vlavo' ? 'vlavo' : 'vpravo';
}

/** neplatná/chýbajúca hodnota tichým fallbackom na technický (default) —
 *  rovnaká disciplína ako `rezimVykresu` v pergola-navrh-vstup.ts */
function rezimVykresu(form: FormData): BazenNavrhVykresRezim {
	return text(form, 'rezimVykresu', 20) === 'farebny' ? 'farebny' : BAZEN_NAVRH_REZIM_DEFAULT;
}

export function parseBazenNavrhVstup(form: FormData): {
	vstup: BazenNavrhVstup;
	error: string | null;
} {
	const vstup: BazenNavrhVstup = {
		zatvorenaDlzka: num(form, 'zatvorenaDlzka'),
		hlbka: num(form, 'hlbka'),
		vyskaMax: num(form, 'vyskaMax'),
		vyskaMin: num(form, 'vyskaMin'),
		pocetSekcii: Math.round(num(form, 'pocetSekcii')) || 0,
		dlzkaKolajiska: num(form, 'dlzkaKolajiska'),
		sirkaSekcieOverride: numOrUndefined(form, 'sirkaSekcieOverride'),
		dverovaSekcia: Math.round(num(form, 'dverovaSekcia')) || 1,
		kolaj: kolaj(form),
		smer: smer(form),
		dvereSmer: dvereSmer(form),
		model: text(form, 'model', 60),
		vyplna: text(form, 'vyplna', 60),
		aretacia: text(form, 'aretacia', 60),
		vyskaCela: num(form, 'vyskaCela'),
		op: text(form, 'op', 40),
		nazov: text(form, 'nazov', 80),
		revizia: text(form, 'revizia', 20),
		vypracoval: text(form, 'vypracoval', 60),
		rezimVykresu: rezimVykresu(form),
		ral: text(form, 'ral', 40),
		ralKod: text(form, 'ralKod', 10)
	};

	const error = chybaBazenNavrhVstupu(vstup);
	return { vstup, error };
}
