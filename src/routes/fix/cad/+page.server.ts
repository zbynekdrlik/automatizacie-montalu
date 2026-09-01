// FIX z CADu (#380): (1) „spocitat" prepočíta CAD nárez (bez zápisu), (2) náhľad s Money
// rozpisom + počtami tyčí + výberom kombinácií pri rezoch > 7500, (3) „odoslat" prepočíta
// ZNOVA zo surového vstupu + volieb a zapíše odpis (modul='fix'). Tenká route — celý tok
// žije vo `$lib/server/fix-cad` (reuse pergola enginu, vzor `/pergola/+page.server.ts`).
import type { Actions, PageServerLoad } from './$types';
import { logger } from '$lib/server/log';
import { parseFixCadVstup, fixCadView, fixCadCeny, buildFixCadJob } from '$lib/server/fix-cad';
import {
	writeOdpis,
	isLive,
	blokHlaska,
	overrideOpts,
	rawFormEntries,
	type OdpisJob
} from '$lib/server/money';

export const load: PageServerLoad = async () => {
	return { live: isLive() };
};

export const actions = {
	spocitat: async ({ request, locals }) => {
		const form = await request.formData();
		const vstup = parseFixCadVstup(form);
		const { error, view: v } = fixCadView(vstup, form);
		if (error) return { step: 'form' as const, error, vstup };
		// „Spočítať" beží z formulára, kde polia qty_ ešte nie sú — editError tu nevzniká
		return {
			step: 'nahlad' as const,
			vstup,
			v,
			ceny: v ? fixCadCeny(locals.user, v.nonzero) : undefined,
			error: null as string | null
		};
	},

	// „← Späť a upraviť zadanie": vráti formulár s PREDVYPLNENÝM vstupom vrátane CAD nárezu
	// (nekompútuje, len echo) — obyčajný <a href="/fix/cad"> by ho vynuloval.
	upravit: async ({ request }) => {
		const vstup = parseFixCadVstup(await request.formData());
		return { step: 'form' as const, vstup };
	},

	odoslat: async ({ request, locals }) => {
		const form = await request.formData();
		const vstup = parseFixCadVstup(form);
		const { error, editError, view: v } = fixCadView(vstup, form);
		if (error) return { step: 'form' as const, error, vstup };
		// cenový blok (interní) — lazy (thunk): úspešné odoslanie končí v „hotovo" bez
		// cenového bloku, tak ho nepočítame zbytočne — len keď sa vraciame do „nahlad" s chybou.
		const cenyBlok = () => (v ? fixCadCeny(locals.user, v.nonzero) : undefined);
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

		const job: OdpisJob = buildFixCadJob(vstup, v!, locals.user?.username ?? '');

		try {
			const outcome = await writeOdpis(job, overrideOpts(form));
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
			logger('fix-cad').error('writeOdpis zlyhal', { zak: vstup.zak, op: vstup.op, error: e });
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
} satisfies Actions;
