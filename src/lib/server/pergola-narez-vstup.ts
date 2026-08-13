// Pergola — materiál/nárez z rozmerov (#155): parsovanie + serverová validácia
// formulárového vstupu. Žije v $lib/server (nie v +page.server.ts — nova-stranka §1:
// +page.server.ts smie exportovať len load/actions/…), aby sa dal priamo unit-testovať
// bez SvelteKit routovania. Rozsahy stráži `chybaPergolaNarezVstupu` v
// `$lib/pergola-narez.ts` — tento modul len parsuje.
//
// DISPLAY-ONLY: neimportuje nič z Money zápisovej cesty (statický guard v
// tests/pergola-narez-money-safety.test.ts).
import {
	chybaPergolaNarezVstupu,
	PREDNA_SVETLOST_STD,
	type PergolaNarezVstup,
	type PergolaSystem,
	type Uchytenie,
	type HornyProfil
} from '$lib/pergola-narez';

function num(form: FormData, k: string): number {
	const x = parseFloat(String(form.get(k) ?? '').replace(',', '.'));
	return Number.isFinite(x) ? x : 0;
}

function system(form: FormData): PergolaSystem {
	return String(form.get('system') ?? '') === 'Massive' ? 'Massive' : 'Robust';
}

function uchytenie(form: FormData): Uchytenie {
	return String(form.get('uchytenie') ?? '') === 'samostatne' ? 'samostatne' : 'stena';
}

function hornyProfil(form: FormData): HornyProfil {
	return String(form.get('hornyProfilZadnej') ?? '') === '140' ? 140 : 110;
}

const bool = (form: FormData, k: string) => form.get(k) === '1' || form.get(k) === 'on';

/** voliteľné číslo: prázdne pole → null (nezadané), inak parsované (čiarka → bodka). */
function numOrNull(form: FormData, k: string): number | null {
	const raw = String(form.get(k) ?? '').trim();
	if (raw === '') return null;
	const x = parseFloat(raw.replace(',', '.'));
	return Number.isFinite(x) ? x : null;
}

export function parsePergolaNarezVstup(form: FormData): {
	vstup: PergolaNarezVstup;
	error: string | null;
} {
	const rawSvetlost = num(form, 'prednaSvetlost');
	const vstup: PergolaNarezVstup = {
		system: system(form),
		sirka: num(form, 'sirka'),
		hlbka: num(form, 'hlbka'),
		// prázdna svetlosť → štandard 2200 (najčastejší prípad z callu)
		prednaSvetlost: rawSvetlost || PREDNA_SVETLOST_STD,
		vyskaZadna: num(form, 'vyskaZadna'),
		pocetPrednychNoh: Math.round(num(form, 'pocetPrednychNoh')) || 0,
		uchytenie: uchytenie(form),
		pocetZadnychNoh: Math.round(num(form, 'pocetZadnychNoh')) || 0,
		hornyProfilZadnej: hornyProfil(form),
		prieckaLight: bool(form, 'prieckaLight'),
		zosilnenyNosnik: bool(form, 'zosilnenyNosnik'),
		// #161 — voliteľný sklon strechy pre krov uloženie (prázdne → null = nezadané)
		sklonStrechy: numOrNull(form, 'sklonStrechy')
	};

	const error = chybaPergolaNarezVstupu(vstup);
	return { vstup, error };
}
