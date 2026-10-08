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
import { clipMaterialRows } from '$lib/server/clip-narez';
// #606: pílový plán s kg/m z Odoo (odpad v kg) — LEN zobrazenie, b2b bez kg (zdieľané so zasklenia)
import { kgNarezPre } from '$lib/server/narez-kg';
import type { SessionUser } from '$lib/server/auth';
import { parseClipVstup, parseClipMultiVstup } from '$lib/server/vstup';
import type { ClipMultiVstup } from '$lib/server/vstup';
import {
	nacitajPonukuClip,
	parseClipVstupSOdoo,
	parseClipMultiVstupSOdoo,
	sklaClip
} from '$lib/server/clip-sklo';
import { pridajSklaHromadneIdempotentne, upozornenieCudzie } from '$lib/server/objednavka-skla';
import { priradOdooTypy } from '$lib/server/odoo-glass-types';
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
				ral: k.ral,
				// #593: zvolený Odoo typ skla výplne — kľúče LEN keď sú (detail bez Odoo nezmenený)
				...(k.skloOdoo ? { skloOdoo: k.skloOdoo } : {}),
				...(k.skloOdooNazov ? { skloOdooNazov: k.skloOdooNazov } : {})
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

/** Náhľadový payload kroku „kontrola" — zdieľaný `spocitat` a `pridatSkla` (#593). */
async function stavKontrola(vstup: ClipVstup, user: SessionUser | null) {
	const vypocet = computeClip(vstup);
	// #554 pílový plán (display-only) — RozpisRezov na tyče; #606 kg/m z Odoo súbežne so skladom
	const [narez, skladVarovania] = await Promise.all([
		kgNarezPre(user, clipMaterialRows([vypocet])),
		// #448/#451 predodpisové skladové varovanie + odobrať (clip je b2b-forbidden → bez gate)
		skladoveVarovania(vypocet.polozky.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.qty })))
	]);
	return {
		step: 'kontrola' as const,
		vstup,
		vypocet,
		narez,
		skladVarovania,
		snapshotDatum: getSnapshotMeta().generatedAt,
		error: null as string | null
	};
}

/** Náhľadový payload kroku „kontrolaMulti" — zdieľaný `spocitatMulti` a `pridatSklaMulti` (#593). */
async function stavKontrolaMulti(vstup: ClipMultiVstup, user: SessionUser | null) {
	const multi = computeClipMulti(vstup.kusy);
	const job = jobForMulti(vstup, multi.polozky, '');
	// #554 spoločný pílový plán (display-only); #606 kg/m z Odoo súbežne so skladom
	const [narez, skladVarovania] = await Promise.all([
		kgNarezPre(user, clipMaterialRows(multi.kusy)),
		skladoveVarovania(multi.polozky.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.qty })))
	]);
	return {
		step: 'kontrolaMulti' as const,
		multiVstup: vstup,
		multi,
		narez,
		skladVarovania,
		snapshotDatum: getSnapshotMeta().generatedAt,
		planHash: contentHash(vstup.zak, job.polozky),
		error: null as string | null
	};
}

/** Chyba prvého neplatného zábradlia multi vstupu (alebo null). */
function chybaMulti(vstup: ClipMultiVstup): string | null {
	for (let i = 0; i < vstup.kusy.length; i++) {
		const cErr = chybaClipVstupu(vstup.kusy[i]!);
		if (cErr) return `Zasklenie ${i + 1}: ${cErr}`;
	}
	return null;
}

/**
 * #593 (Odoo úloha 1216): vlož sklá výplní do objednávky skla (modul `clip`) — idempotentne
 * (opakované „Pridať sklá" neduplikuje), s upozornením na riadky iného používateľa (#571).
 * Vracia payload banneru `sklaPridane`. Money-NEUTRÁLNE (objednávka u dodávateľa skla).
 */
async function pridajSklaClip(
	kusy: readonly ClipVstup[],
	hlava: { zak: string; op: string },
	username: string
) {
	const polozky = sklaClip(kusy, { zak: hlava.zak, op: hlava.op, createdBy: username });
	// #556: lokálny názov šablóny → jednoznačný Odoo typ; zvolený Odoo typ sa NEpreklápa
	const pridane = pridajSklaHromadneIdempotentne(await priradOdooTypy(polozky));
	logger('clip').info('skla pridane do objednavky', {
		zak: hlava.zak,
		zabradli: kusy.length,
		pridane
	});
	return { pridane, zak: hlava.zak, upozornenieCudzie: upozornenieCudzie(hlava.zak, username) };
}

export const load: PageServerLoad = async () => {
	// #593: ponuka výplne (Odoo sklá 6/16 mm, záloha izo/klasika) — 3 s timeout + cache (#551)
	return { live: isLive(), ponukaSkiel: await nacitajPonukuClip() };
};

export const actions = {
	spocitat: async ({ request, locals }) => {
		const { vstup, error } = await parseClipVstupSOdoo(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		const cErr = chybaClipVstupu(vstup);
		if (cErr) return { step: 'form' as const, error: cErr, vstup };
		return await stavKontrola(vstup, locals.user);
	},

	// „← Späť a upraviť zadanie": vráti formulár s PREDVYPLNENÝMI hodnotami (nekompútuje,
	// len echo vstupu) — obyčajný <a href="/clip"> by formulár vynuloval (trieda bugu Dominik).
	upravit: async ({ request }) => {
		const { vstup } = parseClipVstup(await request.formData());
		return { step: 'form' as const, vstup };
	},

	odoslat: async ({ request, locals }) => {
		const form = await request.formData();
		const { vstup, error } = await parseClipVstupSOdoo(form);
		if (error) return { step: 'form' as const, error, vstup };
		const cErr = chybaClipVstupu(vstup);
		if (cErr) return { step: 'form' as const, error: cErr, vstup };
		const vypocet = computeClip(vstup);
		// #606: kg/m (len zobrazenie) súbežne s validáciou/zápisom — nikdy nehádže, nečaká sa až po odpise
		const narezKg = kgNarezPre(locals.user, clipMaterialRows([vypocet]));

		// pri každom re-renderi kontroly sa vracajú ODOSLANÉ hodnoty — užívateľove
		// úpravy sa nesmú ticho stratiť a nahradiť auto-výpočtom (bazén review vzor)
		const edits = editsFrom(form);
		const editVals = Object.fromEntries(edits);
		const kontrola = async (err: string) => ({
			step: 'kontrola' as const,
			vstup,
			vypocet,
			narez: await narezKg,
			editVals,
			// #448/#451 predodpisové skladové varovanie + odobrať (clip je b2b-forbidden → bez gate)
			skladVarovania: await skladoveVarovania(
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
			return {
				step: 'hotovo' as const,
				vstup,
				finalOut,
				zmenene,
				outcome,
				narez: await narezKg
			};
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

	spocitatMulti: async ({ request, locals }) => {
		const { vstup, error } = await parseClipMultiVstupSOdoo(await request.formData());
		if (error) return { step: 'form' as const, error, multiVstup: vstup };
		const cErr = chybaMulti(vstup);
		if (cErr) return { step: 'form' as const, error: cErr, multiVstup: vstup };
		return await stavKontrolaMulti(vstup, locals.user);
	},

	odoslatMulti: async ({ request, locals }) => {
		const formData = await request.formData();
		const { vstup, error } = await parseClipMultiVstupSOdoo(formData);
		if (error) return { step: 'form' as const, error, multiVstup: vstup };
		const cErr = chybaMulti(vstup);
		if (cErr) return { step: 'form' as const, error: cErr, multiVstup: vstup };
		const multi = computeClipMulti(vstup.kusy);
		// #554 spoločný pílový plán (display-only); #606 kg/m súbežne s validáciou/zápisom (nikdy nehádže)
		const narezKg = kgNarezPre(locals.user, clipMaterialRows(multi.kusy));
		const job = jobForMulti(vstup, multi.polozky, locals.user?.username ?? '');
		const potvrdene = String(formData.get('planHash') ?? '');
		const aktualny = contentHash(vstup.zak, job.polozky);
		if (potvrdene && potvrdene !== aktualny) {
			return {
				step: 'kontrolaMulti' as const,
				multiVstup: vstup,
				multi,
				narez: await narezKg,
				skladVarovania: await skladoveVarovania(
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
				narez: await narezKg,
				editVals: Object.fromEntries(edits),
				skladVarovania: await skladoveVarovania(
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
				narez: await narezKg,
				editVals: Object.fromEntries(edits),
				skladVarovania: await skladoveVarovania(
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
				narez: await narezKg,
				editVals: Object.fromEntries(edits),
				skladVarovania: await skladoveVarovania(
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
				narez: await narezKg,
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
				narez: await narezKg,
				skladVarovania: await skladoveVarovania(
					multi.polozky.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.qty }))
				),
				snapshotDatum: getSnapshotMeta().generatedAt,
				planHash: aktualny,
				error:
					'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.'
			};
		}
	},

	// ---- #593: Pridať sklá do objednávky skla (Odoo úloha 1216) ----
	// Validácia PRED vedľajším efektom; idempotentne; BEZ presmerovania — ostane na kontrole
	// (vzor zasklenia #514), aby odpis ostal dostupný. /clip je v B2B_FORBIDDEN_PREFIXES.
	pridatSkla: async ({ request, locals }) => {
		const { vstup, error } = await parseClipVstupSOdoo(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		const cErr = chybaClipVstupu(vstup);
		if (cErr) return { step: 'form' as const, error: cErr, vstup };
		const v = await stavKontrola(vstup, locals.user);
		const sklaPridane = await pridajSklaClip([vstup], vstup, locals.user?.username ?? '');
		return { ...v, sklaPridane };
	},

	pridatSklaMulti: async ({ request, locals }) => {
		const { vstup, error } = await parseClipMultiVstupSOdoo(await request.formData());
		if (error) return { step: 'form' as const, error, multiVstup: vstup };
		const cErr = chybaMulti(vstup);
		if (cErr) return { step: 'form' as const, error: cErr, multiVstup: vstup };
		const v = await stavKontrolaMulti(vstup, locals.user);
		const sklaPridane = await pridajSklaClip(vstup.kusy, vstup, locals.user?.username ?? '');
		return { ...v, sklaPridane };
	}
} satisfies Actions;
