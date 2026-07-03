// Bazén: trojkrokový tok — (1) „spocitat" postaví rozpis (bez zápisu),
// (2) kontrolná stránka s editovateľnými množstvami, (3) „odoslat" prepočíta
// ZNOVA zo surových vstupov + validovaných úprav a zapíše odpis s dedup ochranou.
import type { Actions, PageServerLoad } from './$types';
import { computeBazen, applyEdits } from '$lib/server/bazen';
import type { BazenVstup, BazenPolozka } from '$lib/server/bazen';
import { parseBazenVstup } from '$lib/server/vstup';
import { writeOdpis, isLive, safe, type OdpisJob } from '$lib/server/money';

function jobFor(
	vstup: BazenVstup,
	finalOut: BazenPolozka[],
	createdBy: string
): OdpisJob {
	return {
		modul: 'bazen',
		zak: vstup.zak,
		op: vstup.op,
		zakaznik: vstup.zakaznik,
		caka: vstup.caka,
		createdBy,
		cakaSubdir: 'Bazen',
		filenameBase: `${safe(vstup.zak)} - OP${safe(vstup.op)} - ${safe(vstup.zakaznik)} BAZEN`,
		// popis 1:1 s n8n verziou: "OP Zákazník" (bez dvojbodky)
		popis: (vstup.op + ' ' + vstup.zakaznik).trim(),
		// Money rozpis: VŠETKY riadky (aj nulové), poradie ako Excel
		polozky: finalOut,
		detail: {
			model: vstup.model,
			kolaj: vstup.kolaj,
			pocetSekcii: vstup.pocetSekcii,
			dvere: vstup.dvere ? 1 : 0
		}
	};
}

function editsFrom(form: FormData): Map<string, string> {
	const edits = new Map<string, string>();
	for (const [key, value] of form.entries()) {
		const m = key.match(/^qty_(.+)$/);
		if (m) edits.set(m[1], String(value));
	}
	return edits;
}

export const load: PageServerLoad = async () => {
	return { live: isLive() };
};

export const actions: Actions = {
	spocitat: async ({ request }) => {
		const { vstup, error } = parseBazenVstup(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		const { out, error: cErr } = computeBazen(vstup);
		if (cErr) return { step: 'form' as const, error: cErr, vstup };
		return { step: 'kontrola' as const, vstup, out, error: null as string | null };
	},

	// „← Späť a upraviť zadanie": vráti formulár s PREDVYPLNENÝMI hodnotami (nekompútuje,
	// len echo vstupu) — obyčajný <a href="/bazen"> by formulár vynuloval (trieda bugu Dominik).
	upravit: async ({ request }) => {
		const { vstup } = parseBazenVstup(await request.formData());
		return { step: 'form' as const, vstup };
	},

	odoslat: async ({ request, locals }) => {
		const form = await request.formData();
		const { vstup, error } = parseBazenVstup(form);
		if (error) return { step: 'form' as const, error, vstup };
		const { out, error: cErr } = computeBazen(vstup);
		if (cErr) return { step: 'form' as const, error: cErr, vstup };

		// pri každom re-renderi kontroly sa vracajú ODOSLANÉ hodnoty — užívateľove
		// úpravy sa nesmú ticho stratiť a nahradiť auto-výpočtom (nález review)
		const edits = editsFrom(form);
		const editVals = Object.fromEntries(edits);
		const kontrola = (err: string) =>
			({ step: 'kontrola' as const, vstup, out, editVals, error: err });

		const { finalOut, zmenene, error: eErr } = applyEdits(out, edits);
		if (eErr) return kontrola(eErr);
		if (finalOut.some((o) => o.qty < 0))
			return kontrola('Rozpis obsahuje záporné množstvo — skontroluj zadanie (počty sekcií).');
		if (finalOut.every((o) => o.qty <= 0))
			return kontrola('Po úpravách neostala žiadna položka — skontroluj množstvá.');

		try {
			const outcome = await writeOdpis(jobFor(vstup, finalOut, locals.user?.username ?? ''));
			if (outcome.status === 'duplicate') {
				return {
					step: 'duplikat' as const,
					error: `Zákazka ${vstup.zak} (OP ${vstup.op}) už bola odoslaná ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv zmaž starý import v Money a uvoľni záznam v histórii odpisov.`,
					vstup
				};
			}
			return { step: 'hotovo' as const, vstup, finalOut, zmenene, outcome };
		} catch (e) {
			console.error('bazen writeOdpis zlyhal:', e);
			return kontrola(
				'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.'
			);
		}
	}
};
