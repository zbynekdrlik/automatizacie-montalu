// Parsovanie a serverová validácia vstupu šikmého FIXu. Žije v $lib/server (nie
// v +page.server.ts) — SvelteKit povoľuje z page-server súboru exportovať len
// load/actions/…, a takto sa dá vstup priamo unit-testovať.
import { chybaFixVstupu, FIX_MAX_POLI } from '$lib/fix';

export interface FixVstup {
	zak: string;
	op: string;
	zakaznik: string;
	/** názov kusu na výkrese (napr. „FIX KMS") */
	nazov: string;
	s: number;
	v1: number;
	v2: number;
	polia: number[];
	/** zrkadlový kus — tá istá konštrukcia otočená */
	zrkadlo: boolean;
	ral: string;
	sklo: string;
	poznamka: string;
}

function num(form: FormData, k: string): number {
	const x = parseFloat(String(form.get(k) ?? '').replace(',', '.'));
	return Number.isFinite(x) ? x : 0;
}

export function parseFixVstup(form: FormData): { vstup: FixVstup; error: string | null } {
	const s = num(form, 's');
	let polia: number[] = [];
	try {
		const raw: unknown = JSON.parse(String(form.get('polia') ?? '[]'));
		if (Array.isArray(raw))
			polia = raw
				.slice(0, FIX_MAX_POLI + 1)
				.map((x) => {
					const n = parseFloat(String(x).replace(',', '.'));
					return Number.isFinite(n) ? n : 0;
				});
	} catch {
		polia = [];
	}
	// prázdne pole šírok = jedno pole cez celú šírku (najčastejší prípad)
	if (!polia.length && s > 0) polia = [s];

	const vstup: FixVstup = {
		zak: String(form.get('zak') ?? '').trim(),
		op: String(form.get('op') ?? '').trim(),
		zakaznik: String(form.get('zakaznik') ?? '').trim(),
		nazov: String(form.get('nazov') ?? '').trim().slice(0, 60),
		s,
		v1: num(form, 'v1'),
		v2: num(form, 'v2'),
		polia,
		zrkadlo: form.get('zrkadlo') === '1',
		ral: String(form.get('ral') ?? '').trim().slice(0, 40),
		sklo: String(form.get('sklo') ?? '').trim().slice(0, 120),
		poznamka: String(form.get('poznamka') ?? '').replace(/\r\n/g, '\n').trim().slice(0, 300)
	};

	let error: string | null = null;
	if (!vstup.zak) error = 'Chýba číslo objednávky (ZAK).';
	else if (!vstup.op) error = 'Chýba OP/OPDL číslo.';
	else if (!vstup.zakaznik) error = 'Chýba zákazník.';
	else error = chybaFixVstupu(vstup.s, vstup.v1, vstup.v2, vstup.polia);
	return { vstup, error };
}

