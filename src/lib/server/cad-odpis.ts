// Zdieľaný CAD→Money odpis tok (#393) — jediný, module-agnostic engine pre pergola CAD
// (`/pergola`) aj FIX z cadu (`/fix/cad`). REUSUJE na 20/20 reálnych pároch overený pergola
// CAD2DLV engine ($lib/server/pergola) a generickú Money vrstvu ($lib/server/money);
// modulovo-špecifické (modul, cakaSubdir, popis-prefix, logger meno) sa vstrekuje cez `opts`.
// Pergola route + FIX adaptér (`fix-cad.ts`) volajú tento tok — žiadna kópia route glue
// (predtým žila dvakrát: pergola route inline + fix-cad.ts, #380 review 🟡 nález).
import { logger } from '$lib/server/log';
import {
	transform,
	applyCombos,
	buildCopyBack,
	parseChoice,
	comboOptionLabel,
	validatePergola,
	CATALOG
} from '$lib/server/pergola';
import {
	writeOdpis,
	applyEdits,
	blokHlaska,
	overrideOpts,
	rawFormEntries,
	type OdpisJob,
	type Modul
} from '$lib/server/money';
import { isB2B, type SessionUser } from '$lib/server/auth';
import {
	enrichPolozky,
	skladoveVarovania,
	getSnapshotMeta,
	type CenyResult
} from '$lib/server/ceny';
import type { SkladVarovanie } from '$lib/server/ceny';

/** #461: parsuj vylúčené kódy z FormData — komponent SkladVarovania ich posiela
 *  ako comma-separated string v hidden inpute `vylucene_kody`. */
function parseVyluceneKody(form: FormData): Set<string> {
	const raw = String(form.get('vylucene_kody') ?? '');
	if (!raw) return new Set();
	return new Set(raw.split(',').filter(Boolean));
}

/** #461: vyfiltruj vylúčené položky z odpisu — volaj pred writeOdpis. */
function vylucPolozky(job: OdpisJob, vylucene: Set<string>): OdpisJob {
	if (vylucene.size === 0) return job;
	return { ...job, polozky: job.polozky.filter((p) => !vylucene.has(p.kod)) };
}

export interface CadVstup {
	zak: string;
	op: string;
	zakaznik: string;
	cad: string;
	caka: boolean;
}

// modulovo-špecifická identita odpisu — jediné, čím sa pergola a FIX tok reálne líšia
export interface CadJobOpts {
	modul: Modul;
	cakaSubdir: string;
	popisPrefix: string;
}
// akčné telá navyše potrebujú meno loggera (catch pri zlyhaní zápisu)
export interface CadActionOpts extends CadJobOpts {
	logName: string;
}

// #156 review nález: surový vložený CAD text v `detail` histórie je bound-ovaný proti
// patologicky veľkému vstupu; `vstup.cad` použitý na prepočet ostáva celý. Predtým žil
// DVAKRÁT (pergola route + fix-cad.ts) — teraz RAZ tu (#393).
const CAD_DETAIL_MAX = 20000;

function parseCadVstup(form: FormData): CadVstup {
	return {
		zak: String(form.get('zak') ?? '').trim(),
		op: String(form.get('op') ?? '').trim(),
		zakaznik: String(form.get('zakaznik') ?? '').trim(),
		cad: String(form.get('cad') ?? ''),
		caka: form.get('caka') === '1'
	};
}

// voľby kombinácií kľúčované INDEXOM (dva kusy s rovnakým rezom majú rovnaký label —
// index je jednoznačný); surové hodnoty sa vracajú na re-render, aby zvolené rádiá
// nikdy „neodskočili" od zobrazeného rozpisu
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

// ručné úpravy množstiev z náhľadu (kľúč qty_<PRP>) — rovnaký tvar ako v pergole/bazéne
function editsFrom(form: FormData): Map<string, string> {
	const edits = new Map<string, string>();
	for (const [key, value] of form.entries()) {
		const m = key.match(/^qty_(.+)$/);
		if (m) edits.set(m[1]!, String(value)); // regex má 1 povinnú capture skupinu
	}
	return edits;
}

/**
 * Náhľad Money rozpisu z CAD nárezu — reuse pergola enginu (`transform`/`validatePergola`/
 * `applyCombos`/`buildCopyBack`). `validatePergola` je generická (žiadny „pergola" v
 * user-facing hláškach) a surfacuje nerozpoznané riadky / nenamapované CAD kódy ako TVRDÚ
 * chybu → do Money sa nikdy nedostane tichý výpadok materiálu.
 */
export function cadOdpisView(vstup: CadVstup, form?: FormData) {
	const r = transform(vstup.cad);
	const error = validatePergola(vstup.zak, vstup.op, vstup.zakaznik, vstup.cad, r);
	if (error) return { error, editError: null as string | null, r: null, view: null };
	const { choices, raw } = form
		? choicesFrom(form, r)
		: { choices: new Map<number, number[]>(), raw: new Map<number, string>() };
	const q = applyCombos(r, choices);
	const copyBack = buildCopyBack(vstup.cad, r, choices);
	const spocitane = CATALOG.map((c) => ({ kod: c.prp, nazov: c.name, qty: q[c.prp] || 0 }));
	// ručné úpravy sa aplikujú AŽ NA KONCI (po kombináciách) — do Money ide to, čo užívateľ
	// vidí v poliach; neplatná hodnota je CHYBA, nikdy tichá nula. Pri chybe ostáva náhľad
	// na spočítaných hodnotách, aby sa dala opraviť.
	const edits = form ? editsFrom(form) : new Map<string, string>();
	const { finalOut, zmenene, error: editError } = applyEdits(spocitane, edits);
	const polozky = editError ? spocitane : finalOut;
	const editVals = Object.fromEntries(edits);
	const longNotes = r.trace
		.filter((t) => t.notes.length)
		.map((t) => t.cad + ': ' + t.notes.join('; '));
	return {
		error: null as string | null,
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

export type CadView = NonNullable<ReturnType<typeof cadOdpisView>['view']>;

/**
 * Cenový zoznam materiálu (display-only) — LEN pre interných. B2B nesmie vidieť nákupnú
 * cenu/maržu/sklad vôbec (tá istá hranica ako Money-write): pre b2b sa cena vôbec NEDOPOČÍTA,
 * takže sa nikdy nedostane do HTML odpovede. Ceníme presne zobrazené nenulové Money položky
 * (`v.nonzero` — PRP profily); Money odpis sa tým NEMENÍ (goldeny byte-identické).
 */
function cadCeny(
	user: SessionUser | null,
	polozky: { kod: string; nazov: string; qty: number }[]
): CenyResult | undefined {
	if (isB2B(user)) return undefined;
	return enrichPolozky(polozky);
}

/**
 * Predodpisové skladové varovanie (#448) — LEN pre interných (sklad je interná dáta, tá istá
 * access-control hranica ako `cadCeny`). Pre b2b `[]`. Vstup = zobrazené nenulové Money položky
 * (`v.nonzero`); honest signál, nie blok.
 */
function cadSklad(
	user: SessionUser | null,
	polozky: { kod: string; nazov: string; qty: number }[]
): SkladVarovanie[] {
	if (isB2B(user)) return [];
	return skladoveVarovania(polozky.map((p) => ({ kod: p.kod, nazov: p.nazov, mnozstvo: p.qty })));
}

/**
 * Postaví `OdpisJob` s modulovo-špecifickou identitou (`opts`). `polozky` = VŠETKÝCH 25
 * katalógových riadkov (aj nulové) — 1:1 ako pergola/n8n. `createdBy` z prihláseného
 * používateľa (route).
 */
export function buildCadJob(
	vstup: CadVstup,
	v: CadView,
	createdBy: string,
	opts: CadJobOpts
): OdpisJob {
	return {
		modul: opts.modul,
		zak: vstup.zak,
		op: vstup.op,
		zakaznik: vstup.zakaznik,
		caka: vstup.caka,
		createdBy,
		cakaSubdir: opts.cakaSubdir,
		// popis „<prefix>OP Zákazník" — prefix „FIX " odlíši FIX doklad od pergola dokladu
		// v Money; pergola má prázdny prefix → „OP Zákazník" (1:1 s n8n verziou)
		popis: (opts.popisPrefix + vstup.op + ' ' + vstup.zakaznik).trim(),
		// Money rozpis: VŠETKÝCH 25 katalógových riadkov (aj nulové) — ako n8n
		polozky: v.polozky,
		detail: {
			riadkov: v.nonzero.length,
			tyce: v.totalBars,
			kombinacie: v.kombinacie.length,
			// surový vložený CAD text 1:1 (bound-ovaný proti patologicky veľkému vstupu —
			// viď CAD_DETAIL_MAX) + skutočne zvolené kombinácie tyčí, aby sa dal dohľadať
			// vstup, z ktorého odpis vznikol
			cad: vstup.cad.slice(0, CAD_DETAIL_MAX),
			komboVolby: v.kombinacie
		}
	};
}

// --- zdieľané akčné telá (spocitat / upravit / odoslat) — route glue žije RAZ (#393) ---

export function cadSpocitat(form: FormData, user: SessionUser | null) {
	const vstup = parseCadVstup(form);
	const { error, view: v } = cadOdpisView(vstup, form);
	if (error) return { step: 'form' as const, error, vstup };
	// „Spočítať" beží z formulára, kde polia qty_ ešte nie sú — editError tu nevzniká
	return {
		step: 'nahlad' as const,
		vstup,
		v,
		ceny: v ? cadCeny(user, v.nonzero) : undefined,
		// #448/#451 predodpisové skladové varovanie + odobrať (LEN interní; b2b → [])
		skladVarovania: v ? cadSklad(user, v.nonzero) : [],
		snapshotDatum: getSnapshotMeta().generatedAt,
		error: null as string | null
	};
}

// „← Späť a upraviť zadanie": vráti formulár s PREDVYPLNENÝM vstupom vrátane CAD nárezu
// (nekompútuje, len echo) — obyčajný <a href> by ho vynuloval.
export function cadUpravit(form: FormData) {
	return { step: 'form' as const, vstup: parseCadVstup(form) };
}

export async function cadOdoslat(form: FormData, user: SessionUser | null, opts: CadActionOpts) {
	const vstup = parseCadVstup(form);
	const { error, editError, view: v } = cadOdpisView(vstup, form);
	if (error) return { step: 'form' as const, error, vstup };
	// cenový blok (interní) — lazy (thunk): úspešné odoslanie končí v „hotovo" bez cenového
	// bloku, tak ho nepočítame zbytočne — len keď sa vraciame do „nahlad" s chybou. Zavolá sa
	// nanajvýš raz (vetvy sú return).
	const cenyBlok = () => (v ? cadCeny(user, v.nonzero) : undefined);
	const skladBlok = () => (v ? cadSklad(user, v.nonzero) : []);
	const snapDatum = () => getSnapshotMeta().generatedAt;
	// neplatná ručná úprava → späť do náhľadu s chybou, do Money sa nezapisuje
	if (editError)
		return {
			step: 'nahlad' as const,
			vstup,
			v,
			ceny: cenyBlok(),
			skladVarovania: skladBlok(),
			snapshotDatum: snapDatum(),
			error: editError
		};

	// posledná poistka pred zápisom do Money — nikdy záporné/nekonečné metre
	if (v!.polozky.some((o) => o.qty < 0 || !Number.isFinite(o.qty)))
		return {
			step: 'nahlad' as const,
			vstup,
			v,
			ceny: cenyBlok(),
			skladVarovania: skladBlok(),
			snapshotDatum: snapDatum(),
			error: 'Rozpis obsahuje neplatné množstvo — skontroluj vstup a voľby kombinácií.'
		};

	const job = buildCadJob(vstup, v!, user?.username ?? '', opts);
	// #461: vylúč položky, ktoré užívateľ odobral cez SkladVarovania
	const vylucene = parseVyluceneKody(form);
	const finalJob = vylucPolozky(job, vylucene);

	try {
		const outcome = await writeOdpis(finalJob, overrideOpts(form));
		if (outcome.status === 'duplicate') {
			return {
				step: 'duplikat' as const,
				error: `Zákazka ${vstup.zak} (OP ${vstup.op}) už bola odoslaná ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv zmaž starý import v Money a uvoľni záznam v histórii odpisov.`,
				vstup
			};
		}
		if (outcome.status === 'blocked') {
			return {
				step: 'blocked' as const,
				blokReason: outcome.reason!,
				blokAction: '?/odoslat',
				rawEntries: rawFormEntries(form),
				error: blokHlaska(outcome, vstup.zak, vstup.op),
				vstup
			};
		}
		return { step: 'hotovo' as const, vstup, v, outcome };
	} catch (e) {
		logger(opts.logName).error('writeOdpis zlyhal', { zak: vstup.zak, op: vstup.op, error: e });
		return {
			step: 'nahlad' as const,
			vstup,
			v,
			ceny: cenyBlok(),
			skladVarovania: skladBlok(),
			snapshotDatum: snapDatum(),
			error:
				'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.'
		};
	}
}
