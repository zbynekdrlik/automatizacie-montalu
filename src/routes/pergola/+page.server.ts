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
import { writeOdpis, isLive, applyEdits, type OdpisJob } from '$lib/server/money';
import { isB2B, type SessionUser } from '$lib/server/auth';
import { enrichPolozky, type CenyResult } from '$lib/server/ceny';

interface PergolaVstup {
	zak: string;
	op: string;
	zakaznik: string;
	cad: string;
	caka: boolean;
}

// #156 review nález: ostatné textové polia v detaile histórie sú bound-ované
// (poznamka 300, skloPresne 120, ral 40 v zaskleniach) — CAD paste bound nemal
// žiaden. Reálne zákazky majú pár desiatok riadkov (~1-2 KB); 20 000 znakov je
// 10x nadštandard, len proti patologicky veľkému vstupu do DB. Strihá sa LEN
// kópia v `detail` — `vstup.cad` použitý na prepočet ostáva nedotknutý.
const CAD_DETAIL_MAX = 20000;

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
		// voľba sa validuje proti PONÚKNUTÝM kombináciám — neplatná padá na minimal
		choices.set(i, parseChoice(value || undefined, c.minimal, c.options));
	});
	return { choices, raw };
}

// ručné úpravy množstiev z náhľadu (kľúč qty_<PRP>) — rovnaký tvar ako v bazéne
function editsFrom(form: FormData): Map<string, string> {
	const edits = new Map<string, string>();
	for (const [key, value] of form.entries()) {
		const m = key.match(/^qty_(.+)$/);
		if (m) edits.set(m[1], String(value));
	}
	return edits;
}

function view(vstup: PergolaVstup, form?: FormData) {
	const r = transform(vstup.cad);
	const error = validatePergola(vstup.zak, vstup.op, vstup.zakaznik, vstup.cad, r);
	if (error) return { error, r: null, view: null };
	const { choices, raw } = form
		? choicesFrom(form, r)
		: { choices: new Map<number, number[]>(), raw: new Map<number, string>() };
	const q = applyCombos(r, choices);
	const copyBack = buildCopyBack(vstup.cad, r, choices);
	const spocitane = CATALOG.map((c) => ({ kod: c.prp, nazov: c.name, qty: q[c.prp] || 0 }));
	// ručné úpravy sa aplikujú AŽ NA KONCI (po kombináciách) — do Money ide to,
	// čo užívateľ vidí v poliach; neplatná hodnota je CHYBA, nikdy tichá nula.
	// Pri chybe ostáva náhľad na spočítaných hodnotách, aby sa dala opraviť.
	const edits = form ? editsFrom(form) : new Map<string, string>();
	const { finalOut, zmenene, error: editError } = applyEdits(spocitane, edits);
	const polozky = editError ? spocitane : finalOut;
	const editVals = Object.fromEntries(edits);
	const longNotes = r.trace
		.filter((t) => t.notes.length)
		.map((t) => t.cad + ': ' + t.notes.join('; '));
	return {
		error: null,
		editError,
		r,
		view: {
			polozky,
			zmenene,
			editVals,
			nonzero: polozky.filter((o) => o.qty > 0),
			nulove: polozky.filter((o) => o.qty <= 0),
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

/**
 * Cenový zoznam materiálu (#232, display-only) — LEN pre interných. B2B nesmie
 * vidieť nákupnú cenu/maržu/sklad vôbec — obrana do hĺbky (tá istá hranica ako
 * zasklenia `cenyPre` / Money-write): pre b2b sa cena vôbec NEDOPOČÍTA, takže sa
 * nikdy nedostane do HTML odpovede. Ceníme presne zobrazené nenulové Money položky
 * (`v.nonzero` — PRP profily); Money odpis sa týmto NEMENÍ (goldeny byte-identické).
 */
function cenyPre(
	user: SessionUser | null,
	polozky: { kod: string; nazov: string; qty: number }[]
): CenyResult | undefined {
	if (isB2B(user)) return undefined;
	return enrichPolozky(polozky);
}

export const load: PageServerLoad = async () => {
	return { live: isLive() };
};

export const actions: Actions = {
	spocitat: async ({ request, locals }) => {
		const form = await request.formData();
		const vstup = parseVstup(form);
		const { error, view: v } = view(vstup, form);
		if (error) return { step: 'form' as const, error, vstup };
		// „Spočítať" beží z formulára, kde polia qty_ ešte nie sú — editError tu nevzniká
		return {
			step: 'nahlad' as const,
			vstup,
			v,
			ceny: v ? cenyPre(locals.user, v.nonzero) : undefined,
			error: null as string | null
		};
	},

	// „← Späť a upraviť zadanie": vráti formulár s PREDVYPLNENÝM vstupom vrátane CAD
	// nárezu (nekompútuje, len echo) — obyčajný <a href="/pergola"> by ho vynuloval.
	upravit: async ({ request }) => {
		const vstup = parseVstup(await request.formData());
		return { step: 'form' as const, vstup };
	},

	odoslat: async ({ request, locals }) => {
		const form = await request.formData();
		const vstup = parseVstup(form);
		const { error, editError, view: v } = view(vstup, form);
		if (error) return { step: 'form' as const, error, vstup };
		// cenový blok (#232) — LEN interní. Lazy (thunk): úspešné odoslanie končí v kroku
		// „hotovo" bez cenového bloku, tak ho nepočítame zbytočne — len keď sa vraciame
		// do „nahlad" s chybou. Zavolá sa nanajvýš raz (vetvy sú return).
		const cenyBlok = () => (v ? cenyPre(locals.user, v.nonzero) : undefined);
		// neplatná ručná úprava → späť do náhľadu s chybou, do Money sa nezapisuje
		if (editError) return { step: 'nahlad' as const, vstup, v, ceny: cenyBlok(), error: editError };

		// posledná poistka pred zápisom do Money — nikdy záporné/nekonečné metre
		if (v!.polozky.some((o) => o.qty < 0 || !Number.isFinite(o.qty)))
			return {
				step: 'nahlad' as const,
				vstup,
				v,
				ceny: cenyBlok(),
				error: 'Rozpis obsahuje neplatné množstvo — skontroluj vstup a voľby kombinácií.'
			};

		const job: OdpisJob = {
			modul: 'pergola',
			zak: vstup.zak,
			op: vstup.op,
			zakaznik: vstup.zakaznik,
			caka: vstup.caka,
			createdBy: locals.user?.username ?? '',
			cakaSubdir: 'Pergola',
			// popis 1:1 s n8n verziou: "OP Zákazník"
			popis: (vstup.op + ' ' + vstup.zakaznik).trim(),
			// Money rozpis: VŠETKÝCH 25 katalógových riadkov (aj nulové) — ako n8n
			polozky: v!.polozky,
			detail: {
				riadkov: v!.nonzero.length,
				tyce: v!.totalBars,
				kombinacie: v!.kombinacie.length,
				// #156 (krok 0 pre #155): surový vložený CAD text 1:1 (bound-ovaný proti
				// patologicky veľkému vstupu — viď CAD_DETAIL_MAX) + skutočne zvolené
				// kombinácie tyčí (nielen počet) — bez toho sa dá dohľadať len prepočet,
				// nie vstup, z ktorého vznikol
				cad: vstup.cad.slice(0, CAD_DETAIL_MAX),
				komboVolby: v!.kombinacie
			}
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
				ceny: cenyBlok(),
				error:
					'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.'
			};
		}
	}
};
