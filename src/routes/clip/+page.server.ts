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
import { computeClip, computeClipMulti, chybaClipVstupu, type ClipPolozka } from '$lib/clip';
import type { ClipVstup } from '$lib/clip';
import { parseClipVstup, parseClipMultiVstup } from '$lib/server/vstup';
import type { ClipMultiVstup } from '$lib/server/vstup';
import {
	writeOdpis,
	isLive,
	contentHash,
	blokHlaska,
	overrideOpts,
	rawFormEntries,
	applyEdits,
	type OdpisJob
} from '$lib/server/money';
import { skladoveVarovania, getSnapshotMeta } from '$lib/server/ceny';

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

function jobForMulti(vstup: ClipMultiVstup, finalOut: ClipPolozka[], createdBy: string): OdpisJob {
	return {
		modul: 'clip',
		zak: vstup.zak,
		op: vstup.op,
		zakaznik: vstup.zakaznik,
		caka: vstup.caka,
		createdBy,
		cakaSubdir: 'Clip',
		popis: (vstup.op + ' ' + vstup.zakaznik).trim(),
		polozky: finalOut,
		detail: {
			multiClip: true,
			kusy: vstup.kusy.map((k) => ({
				typ: k.typ,
				variant: k.variant,
				sirka: k.sirka,
				vyska: k.vyska,
				ral: k.ral
			}))
		}
	};
}

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
			// #448/#451 predodpisové skladové varovanie + odobrať (clip je b2b-forbidden → bez gate)
			skladVarovania: skladoveVarovania(
				vypocet.polozky.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.qty }))
			),
			snapshotDatum: getSnapshotMeta().generatedAt,
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
			// #448/#451 predodpisové skladové varovanie + odobrať (clip je b2b-forbidden → bez gate)
			skladVarovania: skladoveVarovania(
				vypocet.polozky.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.qty }))
			),
			snapshotDatum: getSnapshotMeta().generatedAt,
			error: err
		});

		const { finalOut, zmenene, error: eErr } = applyEdits(vypocet.polozky, edits);
		if (eErr) return kontrola(eErr);
		if (finalOut.some((o) => o.qty < 0))
			return kontrola('Rozpis obsahuje záporné množstvo — skontroluj zadanie.');
		if (finalOut.every((o) => o.qty <= 0))
			return kontrola('Po úpravách neostala žiadna položka — skontroluj množstvá.');

		const job = jobFor(vstup, finalOut, locals.user?.username ?? '');
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
			return { step: 'hotovo' as const, vstup, finalOut, zmenene, outcome };
		} catch (e) {
			logger('clip').error('writeOdpis zlyhal', { zak: vstup.zak, op: vstup.op, error: e });
			return kontrola(
				'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.'
			);
		}
	},

	// ---- Multi CLIP (#468 fáza 2): viac kusov v jednom odpise ----

	upravitMulti: async ({ request }) => {
		const { vstup } = parseClipMultiVstup(await request.formData());
		return { step: 'form' as const, multiVstup: vstup };
	},

	spocitatMulti: async ({ request }) => {
		const { vstup, error } = parseClipMultiVstup(await request.formData());
		if (error) return { step: 'form' as const, error, multiVstup: vstup };
		// validuj každý kus
		for (let i = 0; i < vstup.kusy.length; i++) {
			const kus = vstup.kusy[i]!;
			const cErr = chybaClipVstupu(kus);
			if (cErr)
				return { step: 'form' as const, error: `Zasklenie ${i + 1}: ${cErr}`, multiVstup: vstup };
		}
		const multi = computeClipMulti(vstup.kusy);
		const job = jobForMulti(vstup, multi.polozky, '');
		return {
			step: 'kontrolaMulti' as const,
			multiVstup: vstup,
			multi,
			skladVarovania: skladoveVarovania(
				multi.polozky.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.qty }))
			),
			snapshotDatum: getSnapshotMeta().generatedAt,
			planHash: contentHash(vstup.zak, job.polozky),
			error: null as string | null
		};
	},

	odoslatMulti: async ({ request, locals }) => {
		const formData = await request.formData();
		const { vstup, error } = parseClipMultiVstup(formData);
		if (error) return { step: 'form' as const, error, multiVstup: vstup };
		for (let i = 0; i < vstup.kusy.length; i++) {
			const kus = vstup.kusy[i]!;
			const cErr = chybaClipVstupu(kus);
			if (cErr)
				return { step: 'form' as const, error: `Zasklenie ${i + 1}: ${cErr}`, multiVstup: vstup };
		}
		const multi = computeClipMulti(vstup.kusy);
		const job = jobForMulti(vstup, multi.polozky, locals.user?.username ?? '');
		const potvrdene = String(formData.get('planHash') ?? '');
		const aktualny = contentHash(vstup.zak, job.polozky);
		if (potvrdene && potvrdene !== aktualny) {
			return {
				step: 'kontrolaMulti' as const,
				multiVstup: vstup,
				multi,
				skladVarovania: skladoveVarovania(
					multi.polozky.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.qty }))
				),
				snapshotDatum: getSnapshotMeta().generatedAt,
				planHash: aktualny,
				warn: 'Vzorce sa medzitým zmenili — toto je NOVÝ prepočet. Skontroluj čísla a potvrď znova.',
				error: null as string | null
			};
		}
		const vylucene = parseVyluceneKody(formData);
		const edits = editsFrom(formData);
		const { finalOut, zmenene, error: eErr } = applyEdits(multi.polozky, edits);
		if (eErr) {
			return {
				step: 'kontrolaMulti' as const,
				multiVstup: vstup,
				multi,
				editVals: Object.fromEntries(edits),
				skladVarovania: skladoveVarovania(
					multi.polozky.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.qty }))
				),
				snapshotDatum: getSnapshotMeta().generatedAt,
				planHash: aktualny,
				error: eErr
			};
		}
		if (finalOut.some((o) => o.qty < 0)) {
			return {
				step: 'kontrolaMulti' as const,
				multiVstup: vstup,
				multi,
				editVals: Object.fromEntries(edits),
				skladVarovania: skladoveVarovania(
					multi.polozky.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.qty }))
				),
				snapshotDatum: getSnapshotMeta().generatedAt,
				planHash: aktualny,
				error: 'Rozpis obsahuje záporné množstvo — skontroluj zadanie.'
			};
		}
		if (finalOut.every((o) => o.qty <= 0)) {
			return {
				step: 'kontrolaMulti' as const,
				multiVstup: vstup,
				multi,
				editVals: Object.fromEntries(edits),
				skladVarovania: skladoveVarovania(
					multi.polozky.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.qty }))
				),
				snapshotDatum: getSnapshotMeta().generatedAt,
				planHash: aktualny,
				error: 'Po úpravách neostala žiadna položka — skontroluj množstvá.'
			};
		}
		const finalJob = vylucPolozky({ ...job, polozky: finalOut }, vylucene);
		try {
			const outcome = await writeOdpis(finalJob, overrideOpts(formData));
			if (outcome.status === 'duplicate') {
				return {
					step: 'duplikat' as const,
					error: `Zákazka ${vstup.zak} (OP ${vstup.op}) už bola odoslaná ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv zmaž starý import v Money a uvoľni záznam v histórii odpisov.`,
					multiVstup: vstup
				};
			}
			if (outcome.status === 'blocked') {
				return {
					step: 'blocked' as const,
					blokReason: outcome.reason!,
					blokAction: '?/odoslatMulti',
					rawEntries: rawFormEntries(formData),
					error: blokHlaska(outcome, vstup.zak, vstup.op),
					multiVstup: vstup
				};
			}
			return {
				step: 'hotovoMulti' as const,
				multiVstup: vstup,
				multi,
				finalOut,
				outcome,
				zmenene
			};
		} catch (e) {
			logger('clip').error('writeOdpis (multi) zlyhal', {
				zak: vstup.zak,
				op: vstup.op,
				error: e
			});
			return {
				step: 'kontrolaMulti' as const,
				multiVstup: vstup,
				multi,
				skladVarovania: skladoveVarovania(
					multi.polozky.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.qty }))
				),
				snapshotDatum: getSnapshotMeta().generatedAt,
				planHash: aktualny,
				error:
					'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.'
			};
		}
	}
} satisfies Actions;
