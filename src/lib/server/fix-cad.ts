// FIX z CADu (#380) — CAD nárez → Money odpis (modul='fix'). FIX-owned tok, ktorý
// REUSUJE na 20/20 reálnych pároch overený pergola CAD2DLV engine ($lib/server/pergola)
// a generickú Money vrstvu ($lib/server/money). Vzor = `pergola-rezervacia.ts`: engine je
// Money-čistý, napojenie na Money žije oddelene v tomto moste (ten Money importovať SMIE).
//
// Owner (1.9.2026): FIX má dostať druhý režim analogicky k pergole — vložiť CAD nárez
// (rovnaký textový formát ako pergola CAD režim) a vygenerovať z neho FIX odpis do Money.
// Dedup kľúč je UNIQUE(modul,zak,op,live) → modul='fix' odpisuje SAMOSTATNE od pergoly
// (tá istá ZAK+OP môže mať pergola AJ fix odpis, nekolidujú). Nenamapovaný CAD kód dá
// TVRDÚ chybu (validatePergola) — nikdy tichý výpadok materiálu, nikdy zlý odpis.
import {
	transform,
	applyCombos,
	buildCopyBack,
	parseChoice,
	comboOptionLabel,
	validatePergola,
	CATALOG
} from '$lib/server/pergola';
import { applyEdits, type OdpisJob } from '$lib/server/money';
import { isB2B, type SessionUser } from '$lib/server/auth';
import { enrichPolozky, type CenyResult } from '$lib/server/ceny';

// rovnaký cap ako pergola (#156 review): surový vložený CAD text v `detail` histórie je
// bound-ovaný proti patologicky veľkému vstupu; `vstup.cad` použitý na prepočet ostáva celý.
const CAD_DETAIL_MAX = 20000;

export interface FixCadVstup {
	zak: string;
	op: string;
	zakaznik: string;
	cad: string;
	caka: boolean;
}

export function parseFixCadVstup(form: FormData): FixCadVstup {
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
// nikdy „neodskočili" od zobrazeného rozpisu (vzor pergola).
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
export function fixCadView(vstup: FixCadVstup, form?: FormData) {
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
	// vidí v poliach; neplatná hodnota je CHYBA, nikdy tichá nula (rovnako ako pergola).
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

/**
 * Cenový zoznam materiálu (display-only) — LEN pre interných. B2B nesmie vidieť nákupnú
 * cenu/maržu/sklad vôbec (tá istá hranica ako pergola `cenyPre`): pre b2b sa cena vôbec
 * NEDOPOČÍTA, takže sa nikdy nedostane do HTML odpovede. Money odpis sa tým NEMENÍ.
 */
export function fixCadCeny(
	user: SessionUser | null,
	polozky: { kod: string; nazov: string; qty: number }[]
): CenyResult | undefined {
	if (isB2B(user)) return undefined;
	return enrichPolozky(polozky);
}

type FixCadViewOk = NonNullable<ReturnType<typeof fixCadView>['view']>;

/**
 * Postaví `OdpisJob` s modul='fix'. `polozky` = VŠETKÝCH 25 katalógových riadkov (aj
 * nulové) — 1:1 ako pergola/n8n. `cakaSubdir='Fix'` (parkovací podpriečinok NA ODPIS/Fix),
 * popis „OP Zákazník". `createdBy` sa preberá z prihláseného používateľa (route).
 */
export function buildFixCadJob(vstup: FixCadVstup, v: FixCadViewOk, createdBy: string): OdpisJob {
	return {
		modul: 'fix',
		zak: vstup.zak,
		op: vstup.op,
		zakaznik: vstup.zakaznik,
		caka: vstup.caka,
		createdBy,
		cakaSubdir: 'Fix',
		// popis „FIX OP Zákazník" — marker „FIX" odlíši FIX doklad od pergola dokladu v Money
		// (pergola má „OP Zákazník"); operátor v Money importe hneď vidí, že ide o FIX odpis.
		popis: ('FIX ' + vstup.op + ' ' + vstup.zakaznik).trim(),
		// Money rozpis: VŠETKÝCH 25 katalógových riadkov (aj nulové) — ako pergola
		polozky: v.polozky,
		detail: {
			riadkov: v.nonzero.length,
			tyce: v.totalBars,
			kombinacie: v.kombinacie.length,
			// surový vložený CAD text 1:1 (bound-ovaný — viď CAD_DETAIL_MAX) + skutočne
			// zvolené kombinácie tyčí, aby sa dal dohľadať vstup, z ktorého odpis vznikol
			cad: vstup.cad.slice(0, CAD_DETAIL_MAX),
			komboVolby: v.kombinacie
		}
	};
}
