// Pergola — návrhový výkres (#138): parsovanie a serverová validácia formulárového
// vstupu. Rovnaká disciplína ako `fix-vstup.ts` — žije v $lib/server, aby sa dalo
// priamo unit-testovať bez SvelteKit routovania. Číselné rozsahy stráži
// `chybaPergolaNavrhVstupu` v `$lib/pergola-navrh.ts` — tento modul len parsuje.
import {
	chybaPergolaNavrhVstupu,
	PERGOLA_MAX_POLI,
	type PergolaNavrhVstup,
	type ZvodPozicia,
	type ZvodStrana
} from '$lib/pergola-navrh';

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

function parsePolia(form: FormData): number[] {
	try {
		const raw: unknown = JSON.parse(String(form.get('polia') ?? '[]'));
		if (!Array.isArray(raw)) return [];
		return raw.slice(0, PERGOLA_MAX_POLI).map((x) => {
			const n = parseFloat(String(x).replace(',', '.'));
			return Number.isFinite(n) ? n : 0;
		});
	} catch {
		return [];
	}
}

function jeZvodStrana(x: unknown): x is ZvodStrana {
	return x === 'predna' || x === 'zadna';
}

function parseZvody(form: FormData): ZvodPozicia[] {
	try {
		const raw: unknown = JSON.parse(String(form.get('zvody') ?? '[]'));
		if (!Array.isArray(raw)) return [];
		const out: ZvodPozicia[] = [];
		for (const item of raw) {
			if (
				item &&
				typeof item === 'object' &&
				'postIndex' in item &&
				'strana' in item &&
				Number.isFinite(Number((item as { postIndex: unknown }).postIndex)) &&
				jeZvodStrana((item as { strana: unknown }).strana)
			) {
				out.push({
					postIndex: Math.round(Number((item as { postIndex: unknown }).postIndex)),
					strana: (item as { strana: ZvodStrana }).strana
				});
			}
		}
		return out;
	} catch {
		return [];
	}
}

const text = (form: FormData, k: string, max: number) =>
	String(form.get(k) ?? '')
		.trim()
		.slice(0, max);

export function parsePergolaNavrhVstup(form: FormData): {
	vstup: PergolaNavrhVstup;
	error: string | null;
} {
	const hlbka = num(form, 'hlbka');
	let polia = parsePolia(form);
	// jedno pole = predvolený stav formulára (ako pri FIX-e)
	if (!polia.length) {
		const s = num(form, 's');
		if (s > 0) polia = [s];
	}

	const vstup: PergolaNavrhVstup = {
		polia,
		hlbka,
		vyskaVpredu: num(form, 'vyskaVpredu'),
		vyskaPriStene: num(form, 'vyskaPriStene'),
		panelPocet: Math.round(num(form, 'panelPocet')) || 0,
		panelSirkaOverride: numOrUndefined(form, 'panelSirkaOverride'),
		panelDlzkaOverride: numOrUndefined(form, 'panelDlzkaOverride'),
		zvody: parseZvody(form),
		ral: text(form, 'ral', 40),
		textVyplne: text(form, 'textVyplne', 120),
		poznamkaIzometria: text(form, 'poznamkaIzometria', 60),
		op: text(form, 'op', 40),
		nazov: text(form, 'nazov', 80),
		revizia: text(form, 'revizia', 20),
		varianta: text(form, 'varianta', 20) || 'NAVRH',
		vypracoval: text(form, 'vypracoval', 60)
	};

	const error = chybaPergolaNavrhVstupu(vstup);
	return { vstup, error };
}
