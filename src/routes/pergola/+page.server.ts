// Pergola: (1) „spocitat" prepočíta CAD nárez (bez zápisu), (2) náhľad
// s Money rozpisom + počtami tyčí + výberom kombinácií pri rezoch > 7500,
// (3) „odoslat" prepočíta ZNOVA zo surového vstupu + volieb a zapíše odpis.
import type { Actions, PageServerLoad } from './$types';
import {
	transform,
	applyCombos,
	buildCopyBack,
	parseChoice,
	comboOptionLabel,
	validatePergola,
	CATALOG
} from '$lib/server/pergola';
import { writeOdpis, isLive, safe, type OdpisJob } from '$lib/server/money';

interface PergolaVstup {
	zak: string;
	op: string;
	zakaznik: string;
	cad: string;
	caka: boolean;
}

function parseVstup(form: FormData): PergolaVstup {
	return {
		zak: String(form.get('zak') ?? '').trim(),
		op: String(form.get('op') ?? '').trim(),
		zakaznik: String(form.get('zakaznik') ?? '').trim(),
		cad: String(form.get('cad') ?? ''),
		caka: form.get('caka') === '1'
	};
}

// voľby kombinácií kľúčované INDEXOM (dva kusy s rovnakým rezom majú rovnaký
// label — index je jednoznačný); surové hodnoty sa vracajú na re-render, aby
// zvolené rádiá nikdy „neodskočili" od zobrazeného rozpisu
function choicesFrom(form: FormData, r: ReturnType<typeof transform>) {
	const choices = new Map<number, number[]>();
	const raw = new Map<number, string>();
	r.comboCases.forEach((c, i) => {
		const value = String(form.get(`combo_${i}`) ?? '');
		if (value) raw.set(i, value);
		choices.set(i, parseChoice(value || undefined, c.minimal));
	});
	return { choices, raw };
}

function view(vstup: PergolaVstup, form?: FormData) {
	const r = transform(vstup.cad);
	const error = validatePergola(vstup.zak, vstup.op, vstup.zakaznik, vstup.cad, r);
	if (error) return { error, r: null, view: null };
	const { choices, raw } = form ? choicesFrom(form, r) : { choices: new Map<number, number[]>(), raw: new Map<number, string>() };
	const q = applyCombos(r, choices);
	const copyBack = buildCopyBack(vstup.cad, r, choices);
	const polozky = CATALOG.map((c) => ({ kod: c.prp, nazov: c.name, qty: q[c.prp] || 0 }));
	const longNotes = r.trace.filter((t) => t.notes.length).map((t) => t.cad + ': ' + t.notes.join('; '));
	return {
		error: null,
		r,
		view: {
			polozky,
			nonzero: polozky.filter((o) => o.qty > 0),
			copyLines: copyBack.lines,
			totalBars: copyBack.totalBars,
			cadLastCol: copyBack.lines.map((l) => l.barsStr).join('\n'),
			longNotes,
			kombinacie: r.comboCases.map((c, i) => {
				const options = c.options.map((o, oi) => comboOptionLabel(o, oi === 0));
				return {
					idx: i,
					fieldLabel: c.fieldLabel,
					options,
					selected: raw.get(i) ?? options[0]
				};
			})
		}
	};
}

export const load: PageServerLoad = async () => {
	return { live: isLive() };
};

export const actions: Actions = {
	spocitat: async ({ request }) => {
		const form = await request.formData();
		const vstup = parseVstup(form);
		const { error, view: v } = view(vstup, form);
		if (error) return { step: 'form' as const, error, vstup };
		return { step: 'nahlad' as const, vstup, v, error: null as string | null };
	},

	odoslat: async ({ request, locals }) => {
		const form = await request.formData();
		const vstup = parseVstup(form);
		const { error, view: v } = view(vstup, form);
		if (error) return { step: 'form' as const, error, vstup };

		const job: OdpisJob = {
			modul: 'pergola',
			zak: vstup.zak,
			op: vstup.op,
			zakaznik: vstup.zakaznik,
			caka: vstup.caka,
			createdBy: locals.user?.username ?? '',
			cakaSubdir: 'Pergola',
			filenameBase: `${safe(vstup.zak)} - OP${safe(vstup.op)} - ${safe(vstup.zakaznik)} PERGOLA`,
			// popis 1:1 s n8n verziou: "OP Zákazník"
			popis: (vstup.op + ' ' + vstup.zakaznik).trim(),
			// Money rozpis: VŠETKÝCH 25 katalógových riadkov (aj nulové) — ako n8n
			polozky: v!.polozky,
			detail: { riadkov: v!.nonzero.length, tyce: v!.totalBars, kombinacie: v!.kombinacie.length }
		};

		try {
			const outcome = await writeOdpis(job);
			if (outcome.status === 'duplicate') {
				return {
					step: 'duplikat' as const,
					error: `Zákazka ${vstup.zak} (OP ${vstup.op}) už bola odoslaná ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv zmaž starý import v Money a uvoľni záznam v histórii odpisov.`,
					vstup
				};
			}
			return { step: 'hotovo' as const, vstup, v, outcome };
		} catch (e) {
			console.error('pergola writeOdpis zlyhal:', e);
			return {
				step: 'nahlad' as const,
				vstup,
				v,
				error: 'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.'
			};
		}
	}
};
