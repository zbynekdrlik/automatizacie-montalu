// CLIP zábradlie (#372): trojkrokový tok — (1) „spocitat" postaví rozpis (bez
// zápisu), (2) kontrolná stránka s editovateľnými množstvami (počet tyčí) +
// nárezová tabuľka, (3) „odoslat" prepočíta ZNOVA zo surových vstupov + validovaných
// úprav a zapíše odpis s dedup ochranou. Formulárová disciplína podľa FIX (echo
// `upravit`), odpisový tok podľa bazéna (writeOdpis, blokHlaska, overrideOpts).
// Money-bezpečnosť: dedup UNIQUE(zak,op,live) v money.ts NEDOTKNUTÝ; mimo MONEY_LIVE=1
// nič nejde do živého importu; ticket #372 ostáva OTVORENÝ (len 4 drobné položky —
// kódy čaká Dominik).
import type { Actions, PageServerLoad } from './$types';
import { logger } from '$lib/server/log';
import { computeClip, chybaClipVstupu, type ClipPolozka } from '$lib/clip';
import type { ClipVstup } from '$lib/clip';
import { parseClipVstup } from '$lib/server/vstup';
import {
	writeOdpis,
	isLive,
	blokHlaska,
	overrideOpts,
	rawFormEntries,
	applyEdits,
	type OdpisJob
} from '$lib/server/money';
import { skladoveVarovania } from '$lib/server/ceny';

function jobFor(vstup: ClipVstup, finalOut: ClipPolozka[], createdBy: string): OdpisJob {
	return {
		modul: 'clip',
		zak: vstup.zak,
		op: vstup.op,
		zakaznik: vstup.zakaznik,
		caka: vstup.caka,
		createdBy,
		cakaSubdir: 'Clip',
		// popis dokladu = "OP Zákazník" (rovnaký tvar ako bazén/pergola)
		popis: (vstup.op + ' ' + vstup.zakaznik).trim(),
		polozky: finalOut,
		detail: {
			typ: vstup.typ,
			variant: vstup.variant,
			sirka: vstup.sirka,
			vyska: vstup.vyska,
			ral: vstup.ral, // capnutý na 40 v parseClipVstup (odpis-detail.md)
			vstupRaw: vstup
		}
	};
}

function editsFrom(form: FormData): Map<string, string> {
	const edits = new Map<string, string>();
	for (const [key, value] of form.entries()) {
		const m = key.match(/^qty_(.+)$/);
		if (m) edits.set(m[1]!, String(value)); // regex má 1 povinnú capture skupinu
	}
	return edits;
}

export const load: PageServerLoad = async () => {
	return { live: isLive() };
};

export const actions = {
	spocitat: async ({ request }) => {
		const { vstup, error } = parseClipVstup(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		const cErr = chybaClipVstupu(vstup);
		if (cErr) return { step: 'form' as const, error: cErr, vstup };
		const vypocet = computeClip(vstup);
		return {
			step: 'kontrola' as const,
			vstup,
			vypocet,
			// #448 predodpisové skladové varovanie (clip je b2b-forbidden route → bez gate)
			skladVarovania: skladoveVarovania(
				vypocet.polozky.map((o) => ({ kod: o.kod, mnozstvo: o.qty }))
			),
			error: null as string | null
		};
	},

	// „← Späť a upraviť zadanie": vráti formulár s PREDVYPLNENÝMI hodnotami (nekompútuje,
	// len echo vstupu) — obyčajný <a href="/clip"> by formulár vynuloval (trieda bugu Dominik).
	upravit: async ({ request }) => {
		const { vstup } = parseClipVstup(await request.formData());
		return { step: 'form' as const, vstup };
	},

	odoslat: async ({ request, locals }) => {
		const form = await request.formData();
		const { vstup, error } = parseClipVstup(form);
		if (error) return { step: 'form' as const, error, vstup };
		const cErr = chybaClipVstupu(vstup);
		if (cErr) return { step: 'form' as const, error: cErr, vstup };
		const vypocet = computeClip(vstup);

		// pri každom re-renderi kontroly sa vracajú ODOSLANÉ hodnoty — užívateľove
		// úpravy sa nesmú ticho stratiť a nahradiť auto-výpočtom (bazén review vzor)
		const edits = editsFrom(form);
		const editVals = Object.fromEntries(edits);
		const kontrola = (err: string) => ({
			step: 'kontrola' as const,
			vstup,
			vypocet,
			editVals,
			// #448 predodpisové skladové varovanie (clip je b2b-forbidden route → bez gate)
			skladVarovania: skladoveVarovania(
				vypocet.polozky.map((o) => ({ kod: o.kod, mnozstvo: o.qty }))
			),
			error: err
		});

		const { finalOut, zmenene, error: eErr } = applyEdits(vypocet.polozky, edits);
		if (eErr) return kontrola(eErr);
		if (finalOut.some((o) => o.qty < 0))
			return kontrola('Rozpis obsahuje záporné množstvo — skontroluj zadanie.');
		if (finalOut.every((o) => o.qty <= 0))
			return kontrola('Po úpravách neostala žiadna položka — skontroluj množstvá.');

		try {
			const outcome = await writeOdpis(
				jobFor(vstup, finalOut, locals.user?.username ?? ''),
				overrideOpts(form)
			);
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
			return { step: 'hotovo' as const, vstup, finalOut, zmenene, outcome };
		} catch (e) {
			logger('clip').error('writeOdpis zlyhal', { zak: vstup.zak, op: vstup.op, error: e });
			return kontrola(
				'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.'
			);
		}
	}
} satisfies Actions;
