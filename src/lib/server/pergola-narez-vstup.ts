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
	type HornyProfil,
	type VystuhaProfil
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

/** #206 (e) — voľný textový údaj zákazky (sklá): orezaný + capnutý na 200 znakov (informatívny
 *  údaj na výkrese, žiadny Money výpočet — cap len obranný proti nezmyselne dlhému vstupu). */
function str(form: FormData, k: string): string {
	return String(form.get(k) ?? '')
		.trim()
		.slice(0, 200);
}

/** #206 (c) — profil výstuhy: prázdne → null (systémový štandard), inak známa hodnota. */
function vystuhaProfil(form: FormData): VystuhaProfil | null {
	const raw = String(form.get('vystuhaProfil') ?? '').trim();
	return raw === '140x140' || raw === '200x140' || raw === '110x110' || raw === '110x250'
		? raw
		: null;
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
		sklonStrechy: numOrNull(form, 'sklonStrechy'),
		// #161 — voliteľný MANUÁLNY počet krovov (Dominik 21.8.); prázdne → null = auto fallback
		pocetKrovov: numOrNull(form, 'pocetKrovov'),
		// #206 (a) — jednoduchá pergola bez zasklenia (vypína bočné 110×43)
		jednoduchaBezZasklenia: bool(form, 'jednoduchaBezZasklenia'),
		// #206 (c) — profil výstuhy (200×140 → svetlosť −60)
		vystuhaProfil: vystuhaProfil(form),
		// #206 (d) — ZVOD frézovanie: toggle + výška SH (evidencia/výkres)
		zvodFrezovat: bool(form, 'zvodFrezovat'),
		zvodFrezovanieSHmm: numOrNull(form, 'zvodFrezovanieSHmm'),
		// #206 (e) — sklá zákazky (informatívne, žiadny Money výpočet)
		strechaSklo: str(form, 'strechaSklo'),
		obvodoveZasklenie: str(form, 'obvodoveZasklenie')
	};

	const error = chybaPergolaNarezVstupu(vstup);
	return { vstup, error };
}
