// Zasklenia: dvojkrokový tok — (1) „nahlad" spočíta plán BEZ zápisu,
// (2) „odoslat" prepočíta ZNOVA zo surových vstupov (nikdy never klientom
// poslaným číslam) a zapíše odpis s dedup ochranou.

import type { Actions, PageServerLoad } from './$types';
import { loadCfg, listSysStyly, listGlassTypes } from '$lib/server/db';
import { safeCompute } from '$lib/server/compute';
import { writeOdpis, isLive, targetDirFor, filenameFor, contentHash } from '$lib/server/money';
import { parseVstup, OTVARANIA, type Vstup } from '$lib/server/vstup';

function compute(vstup: Vstup) {
	const glass = listGlassTypes();
	const g = glass.find((x) => x.nazov === vstup.sklo);
	if (!g) return { r: null, err: 'Vyber typ skla.' };
	const cfg = loadCfg();
	return safeCompute(cfg, vstup.system + '|' + vstup.styl, vstup.s, vstup.v, g.redukciaZero);
}

export const load: PageServerLoad = async () => {
	const styly = listSysStyly();
	const systemy = [...new Set(styly.map((s) => s.system))];
	return {
		systemy,
		styly, // len existujúce kombinácie — neplatná voľba sa nedá odoslať
		skla: listGlassTypes().map((g) => g.nazov),
		otvarania: OTVARANIA,
		live: isLive()
	};
};

export const actions: Actions = {
	nahlad: async ({ request }) => {
		const { vstup, error } = parseVstup(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		const { r, err } = compute(vstup);
		if (err || !r) return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', vstup };
		return {
			step: 'nahlad' as const,
			vstup,
			plan: r,
			// hash plánu — potvrdenie zapíše len PRESNE to, čo užívateľ videl
			planHash: contentHash(vstup.zak, r),
			warn: null as string | null,
			cielInfo: {
				live: isLive(),
				filename: filenameFor({ ...vstup, createdBy: '', result: r }),
				dir: targetDirFor(r.system, vstup.caka)
			}
		};
	},

	odoslat: async ({ request, locals }) => {
		const formData = await request.formData();
		const { vstup, error } = parseVstup(formData);
		if (error) return { step: 'form' as const, error, vstup };
		const { r, err } = compute(vstup);
		if (err || !r) return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', vstup };

		// ak niekto medzi náhľadom a potvrdením zmenil vzorce (Nastavenia),
		// prepočet už nesedí s tým, čo užívateľ videl → nezapisuj, ukáž nový náhľad
		const potvrdene = String(formData.get('planHash') ?? '');
		const aktualny = contentHash(vstup.zak, r);
		if (potvrdene && potvrdene !== aktualny) {
			return {
				step: 'nahlad' as const,
				vstup,
				plan: r,
				planHash: aktualny,
				warn: 'Vzorce sa medzitým zmenili — toto je NOVÝ prepočet. Skontroluj čísla a potvrď znova.',
				cielInfo: {
					live: isLive(),
					filename: filenameFor({ ...vstup, createdBy: '', result: r }),
					dir: targetDirFor(r.system, vstup.caka)
				}
			};
		}
		try {
			const outcome = await writeOdpis({
				zak: vstup.zak,
				op: vstup.op,
				zakaznik: vstup.zakaznik,
				sklo: vstup.sklo,
				otvaranie: vstup.otvaranie,
				caka: vstup.caka,
				createdBy: locals.user?.username ?? '',
				result: r
			});
			if (outcome.status === 'duplicate') {
				// 200 render (nie fail(409)) — non-2xx na form POST loguje v prehliadači
				// console error a porušuje zero-console-errors; blokovanie drží DB constraint
				return {
					step: 'duplikat' as const,
					error: `Zákazka ${vstup.zak} (OP ${vstup.op}) už bola odoslaná ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv zmaž starý import v Money a záznam v histórii odpisov.`,
					vstup
				};
			}
			return { step: 'hotovo', vstup, plan: r, outcome };
		} catch (e) {
			console.error('writeOdpis zlyhal:', e);
			return {
				step: 'form' as const,
				error:
					'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.',
				vstup
			};
		}
	}
};
