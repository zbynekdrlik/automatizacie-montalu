// Parsovanie a serverová validácia vstupu zasklenia formulára — jediný
// serverový strážca rozsahov (HTML5 min/max vie skriptovaný POST obísť).
export const OTVARANIA = ['P - L', 'L - P', 'Opona'];

export interface Vstup {
	zak: string;
	op: string;
	zakaznik: string;
	system: string;
	styl: string;
	s: number;
	v: number;
	sklo: string;
	otvaranie: string;
	caka: boolean;
}

export function parseVstup(form: FormData): { vstup: Vstup; error: string | null } {
	const num = (k: string) => {
		const x = parseFloat(String(form.get(k) ?? '').replace(',', '.'));
		return Number.isFinite(x) ? x : 0;
	};
	const vstup: Vstup = {
		zak: String(form.get('zak') ?? '').trim(),
		op: String(form.get('op') ?? '').trim(),
		zakaznik: String(form.get('zakaznik') ?? '').trim(),
		system: String(form.get('system') ?? '').trim(),
		styl: String(form.get('styl') ?? '').trim(),
		s: num('s'),
		v: num('v'),
		sklo: String(form.get('sklo') ?? '').trim(),
		otvaranie: String(form.get('otvaranie') ?? '').trim(),
		caka: form.get('caka') === '1'
	};
	let error: string | null = null;
	if (!vstup.zak) error = 'Chýba číslo objednávky (ZAK).';
	else if (!vstup.op) error = 'Chýba OP/OPDL číslo.';
	else if (!vstup.zakaznik) error = 'Chýba zákazník.';
	else if (!(vstup.s >= 300 && vstup.s <= 20000)) error = 'Šírka musí byť 300–20000 mm.';
	else if (!(vstup.v >= 300 && vstup.v <= 20000)) error = 'Výška musí byť 300–20000 mm.';
	else if (!OTVARANIA.includes(vstup.otvaranie)) error = 'Vyber otváranie.';
	return { vstup, error };
}

// ---- Bazén ----

import type { BazenVstup } from './bazen';

export function parseBazenVstup(form: FormData): { vstup: BazenVstup; error: string | null } {
	const num = (k: string, max = 1000) => {
		const x = parseFloat(String(form.get(k) ?? '').replace(',', '.'));
		if (!Number.isFinite(x)) return 0;
		return Math.min(Math.max(x, 0), max);
	};
	// počty sú CELÉ čísla — zlomok sekcie (0.5) by v BOM vzorcoch vyrobil
	// záporné množstvá, ktoré by prešli do Money (nález review)
	const cnt = (k: string, max = 100) => Math.round(num(k, max));
	const vstup: BazenVstup = {
		zak: String(form.get('zak') ?? '').trim(),
		op: String(form.get('op') ?? '').trim(),
		zakaznik: String(form.get('zakaznik') ?? '').trim(),
		model: String(form.get('model') ?? 'Premier / Exclusive').trim(),
		kolaj: String(form.get('kolaj') ?? 'Jednokolaj').trim(),
		pocetSekcii: cnt('pocetSekcii'),
		pocetPriecok: cnt('pocetPriecok'),
		dvere: form.get('dvere') === '1',
		vs4500: cnt('vs4500'),
		vs6000: cnt('vs6000'),
		ss4500: cnt('ss4500'),
		ss6000: cnt('ss6000'),
		ms4500: cnt('ms4500'),
		ms6000: cnt('ms6000'),
		dlzkaKolajnic: num('dlzkaKolajnic', 200000),
		prieckovy4300: cnt('prieckovy4300'),
		prieckovy6000: cnt('prieckovy6000'),
		vyklopneCelo: cnt('vyklopneCelo'),
		caka: form.get('caka') === '1'
	};
	let error: string | null = null;
	if (!vstup.zak) error = 'Chýba číslo objednávky (ZAK).';
	else if (!vstup.op) error = 'Chýba OP/OPDL číslo.';
	else if (!vstup.zakaznik) error = 'Chýba zákazník.';
	else if (!(vstup.pocetSekcii > 0)) error = 'Zadaj počet sekcií (väčší ako 0).';
	return { vstup, error };
}
