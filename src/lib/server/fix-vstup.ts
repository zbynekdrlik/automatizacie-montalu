// Parsovanie a serverová validácia vstupu FIXu (pevného zasklenia). Žije v $lib/server
// (nie v +page.server.ts) — SvelteKit povoľuje z page-server súboru exportovať len
// load/actions/…, a takto sa dá vstup priamo unit-testovať.
import {
	chybaFixVstupu,
	jeFixTvar,
	jeFixDelenie,
	jeFixSystem,
	FIX_MAX_POLI,
	type FixTvar,
	type FixDelenie,
	type FixSystem
} from '$lib/fix';

export interface FixVstup {
	zak: string;
	op: string;
	zakaznik: string;
	/** názov kusu na výkrese */
	nazov: string;
	/** tvar konštrukcie — šikmá horná hrana vs pravouhlý obdĺžnik */
	tvar: FixTvar;
	s: number;
	v1: number;
	v2: number;
	polia: number[];
	/** delenie polí — rovnomerne (default), alebo zarovnané na posuv nad fixom (#85) */
	delenie: FixDelenie;
	/** systém posuvu pre delenie `posuv` — uložený aj keď je delenie `rovnomerne`,
	 *  nech je čo predvyplniť, ak operátor prepne späť */
	system: FixSystem;
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
	const tvarRaw = String(form.get('tvar') ?? 'sikmy');
	// neznámy tvar = šikmý (pôvodné správanie) — starý bookmark/POST bez poľa `tvar`
	// tak ostáva platný a nič sa mu nezmení
	const tvar: FixTvar = jeFixTvar(tvarRaw) ? tvarRaw : 'sikmy';
	// rovný fix má JEDNU výšku; formulár posiela `v1`, druhá je jej kópia
	const v1 = num(form, 'v1');
	const v2 = tvar === 'rovny' ? v1 : num(form, 'v2');
	let polia: number[] = [];
	try {
		const raw: unknown = JSON.parse(String(form.get('polia') ?? '[]'));
		if (Array.isArray(raw))
			polia = raw.slice(0, FIX_MAX_POLI + 1).map((x) => {
				const n = parseFloat(String(x).replace(',', '.'));
				return Number.isFinite(n) ? n : 0;
			});
	} catch {
		polia = [];
	}
	// prázdne pole šírok = jedno pole cez celú šírku (najčastejší prípad)
	if (!polia.length && s > 0) polia = [s];

	// neznáme delenie/systém = rovnomerne/Štandard (starý bookmark/POST bez týchto
	// polí ostáva platný, presne ako pri `tvar` vyššie)
	const delenieRaw = String(form.get('delenie') ?? 'rovnomerne');
	const delenie: FixDelenie = jeFixDelenie(delenieRaw) ? delenieRaw : 'rovnomerne';
	const systemRaw = String(form.get('system') ?? 'Štandard');
	const system: FixSystem = jeFixSystem(systemRaw) ? systemRaw : 'Štandard';

	const vstup: FixVstup = {
		zak: String(form.get('zak') ?? '').trim(),
		op: String(form.get('op') ?? '').trim(),
		zakaznik: String(form.get('zakaznik') ?? '').trim(),
		nazov: String(form.get('nazov') ?? '')
			.trim()
			.slice(0, 60),
		tvar,
		s,
		v1,
		v2,
		polia,
		delenie,
		system,
		zrkadlo: form.get('zrkadlo') === '1',
		ral: String(form.get('ral') ?? '')
			.trim()
			.slice(0, 40),
		sklo: String(form.get('sklo') ?? '')
			.trim()
			.slice(0, 120),
		poznamka: String(form.get('poznamka') ?? '')
			.replace(/\r\n/g, '\n')
			.trim()
			.slice(0, 300)
	};

	let error: string | null;
	if (!vstup.zak) error = 'Chýba číslo objednávky (ZAK).';
	else if (!vstup.op) error = 'Chýba OP/OPDL číslo.';
	else if (!vstup.zakaznik) error = 'Chýba zákazník.';
	else error = chybaFixVstupu(vstup.s, vstup.v1, vstup.v2, vstup.polia, vstup.tvar);
	return { vstup, error };
}
