// Bazén: trojkrokový tok — (1) „spocitat" postaví rozpis (bez zápisu),
// (2) kontrolná stránka s editovateľnými množstvami, (3) „odoslat" prepočíta
// ZNOVA zo surových vstupov + validovaných úprav a zapíše odpis s dedup ochranou.
import type { Actions, PageServerLoad } from './$types';
import { logger } from '$lib/server/log';
import { computeBazenAll, applyEdits } from '$lib/server/bazen';
import type { BazenVstup, BazenPolozka } from '$lib/server/bazen';
import { parseBazenVstup } from '$lib/server/vstup';
import {
	writeOdpis,
	isLive,
	blokHlaska,
	overrideOpts,
	rawFormEntries,
	type OdpisJob
} from '$lib/server/money';
import { skladoveVarovania, enrichPolozky, getSnapshotMeta } from '$lib/server/ceny';

/**
 * Predodpisový náhľad (#454 ceny materiálu + #448 sklad) — čisto ČÍTANIE denného
 * Money snapshotu: `enrichPolozky`/`skladoveVarovania` volajú idempotentný lazy
 * `maybeImportSnapshot` (žiadny zápis, žiadny riadok v `odpis_log`, žiadny súbor).
 * Ceníme LEN nenulové položky (vzor pergola `nonzero` v narez/+page.server.ts).
 * b2b sa na túto route nedostane (hook denylist redirect PRED akciou) — preto bez
 * `cenyPre`-štýl gate, presne ako existujúce `skladoveVarovania` na tejto route.
 * BPK* kusové komponenty majú v snapshote nákupnú cenu VŠETKY null → súčet je
 * honest-neúplný (Money nemá nákupnú cenu bazénových komponentov, follow-up #364);
 * `CenyTabulka` to priznáva (`CenySucet.kompletne=false`).
 */
function nahladCien(out: BazenPolozka[]) {
	return {
		skladVarovania: skladoveVarovania(
			out.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.qty }))
		),
		snapshotDatum: getSnapshotMeta().generatedAt,
		ceny: enrichPolozky(out.filter((o) => o.qty > 0))
	};
}

function jobFor(vstup: BazenVstup, finalOut: BazenPolozka[], createdBy: string): OdpisJob {
	return {
		modul: 'bazen',
		zak: vstup.zak,
		op: vstup.op,
		zakaznik: vstup.zakaznik,
		caka: vstup.caka,
		createdBy,
		cakaSubdir: 'Bazen',
		// popis 1:1 s n8n verziou: "OP Zákazník" (bez dvojbodky)
		popis: (vstup.op + ' ' + vstup.zakaznik).trim(),
		// Money rozpis: VŠETKY riadky (aj nulové), poradie ako Excel
		polozky: finalOut,
		detail: {
			model: vstup.model,
			kolaj: vstup.kolaj,
			pocetSekcii: vstup.pocetSekcii,
			dvere: vstup.dvere ? 1 : 0,
			// #156 (krok 0 pre #155): celý naparsovaný vstup 1:1, VEDĽA polí vyššie —
			// doterajší detail nenesie pocetPriecok/vs*/ss*/ms*/dlzkaKolajnic/
			// prieckovy*/vyklopneCelo vôbec, tie sa doteraz strácali úplne
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
		const { vstup, error } = parseBazenVstup(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		const { out, error: cErr } = computeBazenAll(vstup);
		if (cErr) return { step: 'form' as const, error: cErr, vstup };
		return {
			step: 'kontrola' as const,
			vstup,
			out,
			// #448 sklad + #454 ceny materiálu — predodpisový náhľad, len čítanie snapshotu
			...nahladCien(out),
			error: null as string | null
		};
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
		const { out, error: cErr } = computeBazenAll(vstup);
		if (cErr) return { step: 'form' as const, error: cErr, vstup };

		// pri každom re-renderi kontroly sa vracajú ODOSLANÉ hodnoty — užívateľove
		// úpravy sa nesmú ticho stratiť a nahradiť auto-výpočtom (nález review)
		const edits = editsFrom(form);
		const editVals = Object.fromEntries(edits);
		const kontrola = (err: string) => ({
			step: 'kontrola' as const,
			vstup,
			out,
			editVals,
			// #448 sklad + #454 ceny materiálu — predodpisový náhľad, len čítanie snapshotu
			...nahladCien(out),
			error: err
		});

		const { finalOut, zmenene, error: eErr } = applyEdits(out, edits);
		if (eErr) return kontrola(eErr);
		if (finalOut.some((o) => o.qty < 0))
			return kontrola('Rozpis obsahuje záporné množstvo — skontroluj zadanie (počty sekcií).');
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
			logger('bazen').error('writeOdpis zlyhal', { zak: vstup.zak, op: vstup.op, error: e });
			return kontrola(
				'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.'
			);
		}
	}
} satisfies Actions;
