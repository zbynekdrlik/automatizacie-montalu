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
