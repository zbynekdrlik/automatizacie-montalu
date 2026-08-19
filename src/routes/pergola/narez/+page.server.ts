// Pergola — REZERVAČNÝ ODPIS z rozmerov (#221, pôvodne „Materiál z rozmerov" #155).
// Od #221 táto route UŽ posiela do Money (rezervačný odpis pri zadaní objednávky) —
// cez EXISTUJÚCI potvrdzovací tok (nahlad → explicitné potvrdenie → zápis), bez +20 %.
// Vzorcový engine (`$lib/pergola-narez`) ostáva čistý, display-only; Money most žije v
// `$lib/server/pergola-rezervacia` (guard `tests/pergola-narez-money-safety.test.ts`
// drží čistotu enginu, route je z neho zámerne vyňatá).
//
// b2b: route je pod `/pergola` prefixom v `B2B_FORBIDDEN_PREFIXES` — pre b2b
// automaticky zablokovaná (interná, Money-priľahlá).
import type { Actions, PageServerLoad } from './$types';
import { parsePergolaNarezVstup } from '$lib/server/pergola-narez-vstup';
import {
	buildRezervaciaRozpis,
	rezervaciaJob,
	type RezervaciaIdent
} from '$lib/server/pergola-rezervacia';
import { writeOdpis, isLive } from '$lib/server/money';

/** ZAK/OP/zákazník z formulára — do dokladu, dedupu a názvu súboru. */
function parseIdent(form: FormData): RezervaciaIdent {
	return {
		zak: String(form.get('zak') ?? '').trim(),
		op: String(form.get('op') ?? '').trim(),
		zakaznik: String(form.get('zakaznik') ?? '').trim()
	};
}

export const load: PageServerLoad = async () => {
	// Dátum do rohovej pečiatky výkresu (#194) = SERVEROVÝ čas (rovnaká disciplína
	// ako /pergola/navrh #138). `live` = TEST vs LIVE Money režim (badge + poistka).
	return { datumIso: new Date().toISOString(), live: isLive() };
};

export const actions: Actions = {
	spocitat: async ({ request }) => {
		const { vstup, error } = parsePergolaNarezVstup(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		return { step: 'vysledok' as const, vstup, error: null as string | null };
	},

	// „← Späť a upraviť": echo vstupu späť do formulára (nekreslí), rovnaká pasca ako
	// v ostatných moduloch (obyčajný <a href> by ho vynuloval — nova-stranka §4)
	upravit: async ({ request }) => {
		const { vstup } = parsePergolaNarezVstup(await request.formData());
		return { step: 'form' as const, vstup };
	},

	// #221: z rozmerov → Money rozpis rezervácie (BEZ zápisu) → nahlad na potvrdenie.
	rezervovat: async ({ request }) => {
		const form = await request.formData();
		const { vstup, error } = parsePergolaNarezVstup(form);
		const ident = parseIdent(form);
		if (error) return { step: 'vysledok' as const, vstup, ident, rezError: error };
		const res = buildRezervaciaRozpis(vstup, ident);
		if (!res.rozpis) {
			console.warn('pergola rezervacia rozpis chyba:', {
				zak: ident.zak,
				op: ident.op,
				rezError: res.error
			});
			return { step: 'vysledok' as const, vstup, ident, rezError: res.error };
		}
		const rozpis = res.rozpis;
		console.info('pergola rezervacia rozpis:', {
			zak: ident.zak,
			op: ident.op,
			polozky: rozpis.pocetPolozok,
			vylucene: rozpis.vylucene.length
		});
		return { step: 'rez-nahlad' as const, vstup, ident, rozpis, rezError: null };
	},

	// #221: zápis rezervačného odpisu do Money (LEN po explicitnom potvrdení, ten istý
	// bezpečnostný model ako CAD odpis — nahlad, potom potvrdenie). Prepočíta ZNOVA zo
	// surového vstupu (nedôveruje klientovi), zdieľaný dedup s CAD odpisom.
	odoslat: async ({ request, locals }) => {
		const form = await request.formData();
		const { vstup, error } = parsePergolaNarezVstup(form);
		const ident = parseIdent(form);
		if (error) return { step: 'vysledok' as const, vstup, ident, rezError: error };
		const { rozpis, error: rezError } = buildRezervaciaRozpis(vstup, ident);
		if (rezError || !rozpis)
			return {
				step: 'vysledok' as const,
				vstup,
				ident,
				rezError: rezError ?? 'Rozpis rezervácie sa nepodarilo spočítať.'
			};

		const job = rezervaciaJob(vstup, ident, rozpis, locals.user?.username ?? '');
		console.info('pergola rezervacia odoslat:', {
			zak: ident.zak,
			op: ident.op,
			live: isLive(),
			riadkov: rozpis.pocetPolozok
		});
		try {
			const outcome = await writeOdpis(job);
			if (outcome.status === 'duplicate') {
				return {
					step: 'rez-nahlad' as const,
					vstup,
					ident,
					rozpis,
					rezError: `Zákazka ${ident.zak} (OP ${ident.op}) už bola odoslaná (rezervácia alebo odpis) ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv uvoľni záznam v histórii odpisov.`
				};
			}
			console.info('pergola rezervacia zapisana:', {
				zak: ident.zak,
				filename: outcome.filename,
				live: outcome.live
			});
			return { step: 'rez-hotovo' as const, vstup, ident, rozpis, outcome, rezError: null };
		} catch (e) {
			console.error('pergola rezervacia writeOdpis zlyhal:', e);
			return {
				step: 'rez-nahlad' as const,
				vstup,
				ident,
				rozpis,
				rezError:
					'Zápis rezervácie zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.'
			};
		}
	}
};
