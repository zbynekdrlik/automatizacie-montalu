// Zasklenia: dvojkrokový tok — (1) „nahlad" spočíta plán BEZ zápisu,
// (2) „odoslat" prepočíta ZNOVA zo surových vstupov (nikdy never klientom
// poslaným číslam) a zapíše odpis s dedup ochranou.

import type { Actions, PageServerLoad } from './$types';
import { loadCfg, listSysStyly, listGlassTypes, glassTypesForSystem } from '$lib/server/db';
import { safeCompute } from '$lib/server/compute';
import {
	writeOdpis,
	isLive,
	targetDirFor,
	filenameFor,
	contentHash,
	safe,
	type OdpisJob
} from '$lib/server/money';
import type { ComputeResult } from '$lib/server/compute';
import { parseVstup, OTVARANIA, type Vstup } from '$lib/server/vstup';

function jobFor(vstup: Vstup, r: ComputeResult, createdBy: string): OdpisJob {
	return {
		modul: 'zasklenia',
		zak: vstup.zak,
		op: vstup.op,
		zakaznik: vstup.zakaznik,
		caka: vstup.caka,
		createdBy,
		cakaSubdir: r.system === 'Slide' ? 'Slide' : 'Robust',
		filenameBase: `${safe(vstup.zak)} - OP${safe(vstup.op)} - ${safe(vstup.zakaznik)} ZASKLENIA ${safe(r.system)} ${safe(r.styl)}`,
		popis: (vstup.op + ' : ' + vstup.zakaznik).trim(),
		polozky: r.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, qty: o.metre })),
		detail: { system: r.system, styl: r.styl, s: r.S, v: r.V, sklo: vstup.sklo, otvaranie: vstup.otvaranie }
	};
}

function compute(vstup: Vstup) {
	// sklo musí patriť k zvolenému systému (Robust = 4/16/4, Slide = 4/8/4) —
	// nedá sa cez skriptovaný POST poslať cudzie sklo
	const g = glassTypesForSystem(vstup.system).find((x) => x.nazov === vstup.sklo);
	if (!g) return { r: null, err: 'Vyber typ skla platný pre zvolený systém.' };
	const cfg = loadCfg();
	return safeCompute(cfg, vstup.system + '|' + vstup.styl, vstup.s, vstup.v, g.redukciaZero);
}

export const load: PageServerLoad = async () => {
	const styly = listSysStyly();
	const systemy = [...new Set(styly.map((s) => s.system))];
	return {
		systemy,
		styly, // len existujúce kombinácie — neplatná voľba sa nedá odoslať
		// sklá s príslušnosťou k systému — klient ponúkne len platné pre zvolený
		// systém (Robust = 4/16/4, Slide = 4/8/4)
		skla: listGlassTypes().map((g) => ({ nazov: g.nazov, system: g.system })),
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
			planHash: contentHash(vstup.zak, jobFor(vstup, r, '').polozky),
			warn: null as string | null,
			cielInfo: {
				live: isLive(),
				filename: filenameFor(jobFor(vstup, r, '')),
				dir: targetDirFor(r.system === 'Slide' ? 'Slide' : 'Robust', vstup.caka)
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
		const job = jobFor(vstup, r, locals.user?.username ?? '');
		const aktualny = contentHash(vstup.zak, job.polozky);
		if (potvrdene && potvrdene !== aktualny) {
			return {
				step: 'nahlad' as const,
				vstup,
				plan: r,
				planHash: aktualny,
				warn: 'Vzorce sa medzitým zmenili — toto je NOVÝ prepočet. Skontroluj čísla a potvrď znova.',
				cielInfo: {
					live: isLive(),
					filename: filenameFor(job),
					dir: targetDirFor(r.system === 'Slide' ? 'Slide' : 'Robust', vstup.caka)
				}
			};
		}
		try {
			const outcome = await writeOdpis(job);
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
