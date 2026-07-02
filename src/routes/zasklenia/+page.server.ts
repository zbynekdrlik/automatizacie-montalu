// Zasklenia: dvojkrokový tok — (1) „nahlad" spočíta plán BEZ zápisu,
// (2) „odoslat" prepočíta ZNOVA zo surových vstupov (nikdy never klientom
// poslaným číslam) a zapíše odpis s dedup ochranou.

import type { Actions, PageServerLoad } from './$types';
import { loadCfg, listSysStyly, listGlassTypes } from '$lib/server/db';
import { safeCompute } from '$lib/server/compute';
import { writeOdpis, isLive, targetDirFor, filenameFor } from '$lib/server/money';

const OTVARANIA = ['P - L', 'L - P', 'Opona'];

interface Vstup {
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

function parseVstup(form: FormData): { vstup: Vstup; error: string | null } {
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

function compute(vstup: Vstup) {
	const glass = listGlassTypes();
	const g = glass.find((x) => x.nazov === vstup.sklo);
	if (!g) return { r: null, err: 'Vyber typ skla.' };
	const cfg = loadCfg();
	return safeCompute(cfg, vstup.system + '|' + vstup.styl, vstup.s, vstup.v, g.redukciaZero);
}

export const load: PageServerLoad = async () => {
	const styly = listSysStyly();
	const systemy = [...new Set(styly.map((s) => s.system))];
	return {
		systemy,
		styly, // len existujúce kombinácie — neplatná voľba sa nedá odoslať
		skla: listGlassTypes().map((g) => g.nazov),
		otvarania: OTVARANIA,
		live: isLive()
	};
};

export const actions: Actions = {
	nahlad: async ({ request }) => {
		const { vstup, error } = parseVstup(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		const { r, err } = compute(vstup);
		if (err || !r) return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', vstup };
		return {
			step: 'nahlad',
			vstup,
			plan: r,
			cielInfo: {
				live: isLive(),
				filename: filenameFor({ ...vstup, createdBy: '', result: r }),
				dir: targetDirFor(r.system, vstup.caka)
			}
		};
	},

	odoslat: async ({ request, locals }) => {
		const { vstup, error } = parseVstup(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		const { r, err } = compute(vstup);
		if (err || !r) return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', vstup };
		try {
			const outcome = await writeOdpis({
				zak: vstup.zak,
				op: vstup.op,
				zakaznik: vstup.zakaznik,
				sklo: vstup.sklo,
				otvaranie: vstup.otvaranie,
				caka: vstup.caka,
				createdBy: locals.user?.username ?? '',
				result: r
			});
			if (outcome.status === 'duplicate') {
				// 200 render (nie fail(409)) — non-2xx na form POST loguje v prehliadači
				// console error a porušuje zero-console-errors; blokovanie drží DB constraint
				return {
					step: 'duplikat' as const,
					error: `Zákazka ${vstup.zak} (OP ${vstup.op}) už bola odoslaná ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv zmaž starý import v Money a záznam v histórii odpisov.`,
					vstup
				};
			}
			return { step: 'hotovo', vstup, plan: r, outcome };
		} catch (e) {
			console.error('writeOdpis zlyhal:', e);
			return {
				step: 'form' as const,
				error:
					'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.',
				vstup
			};
		}
	}
};
