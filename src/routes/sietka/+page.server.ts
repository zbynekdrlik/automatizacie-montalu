// Dodatočná sieťka BEZ posuvu (#89 — „90 % prípadov"). Rovnaký princíp ako /fix pre
// KRESBU/tlač, ale od korekcie 2026-08-02 appka pre INTERNÝCH používateľov aj ODOŠLE
// odpis (rám + nos, pri 2K aj 3K koľajnicu) cez ten istý `writeOdpis`/MONEY_LIVE
// mechanizmus ako Zasklenia — nová cesta sa nezavádza. B2B (Patrik: „hlavne pre
// externých") vidí len výpočet/tabuľku, žiadne tlačidlo Odoslať — nová cesta nie je
// v `B2B_FORBIDDEN_PREFIXES`, takže denylist ju necháva prejsť, ale Money-zápis je
// zamknutý v akcii samotnej (rovnaká vrstva ako `/zasklenia` `odoslat`).
import type { Actions, PageServerLoad } from './$types';
import { logger } from '$lib/server/log';
import { loadCfg, listSysStyly } from '$lib/server/db';
import { parseSietkaSamostatnaVstup } from '$lib/server/sietka-samostatna';
import { SIETKA_SAMOSTATNA_SYSTEMY, potrebuje3KKolajnicu } from '$lib/sietka';
import { sietkaSamostatnaVypocet } from '$lib/server/compute';
import { isB2B } from '$lib/server/auth';
import {
	writeOdpis,
	isLive,
	targetDirFor,
	filenameFor,
	contentHash,
	blokHlaska,
	type OdpisJob
} from '$lib/server/money';

export const load: PageServerLoad = async () => {
	// opona (2x*) nie je podporovaná (rovnaký gate ako sietkaSamostatnaVypocet) —
	// nenúkaj ju vôbec v selecte, nech sa scriptovaný POST nemusí odmietať v akcii
	const styly = listSysStyly().filter(
		(s) => SIETKA_SAMOSTATNA_SYSTEMY.includes(s.system) && !s.styl.startsWith('2x')
	);
	return { styly, live: isLive() };
};

export const actions = {
	vypocitat: async ({ request }) => {
		const { vstup, error } = parseSietkaSamostatnaVstup(await request.formData());
		if (error) return { step: 'form' as const, error, vstup };
		const { r, err } = sietkaSamostatnaVypocet(
			loadCfg(),
			vstup.system,
			vstup.styl,
			vstup.otvorS,
			vstup.otvorV
		);
		if (err || !r) return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', vstup };
		const job = jobFor(vstup, r, '');
		return {
			step: 'vysledok' as const,
			vstup,
			r,
			potrebuje3K: potrebuje3KKolajnicu(vstup.styl),
			planHash: contentHash(vstup.zak, job.polozky),
			cielInfo: {
				live: isLive(),
				filename: filenameFor(job),
				dir: targetDirFor(r.system, false)
			}
		};
	},

	// „← Späť a upraviť": echo vstupu späť do formulára (nekreslí), rovnaká pasca
	// ako v ostatných moduloch — inak by sa zadanie vynulovalo
	upravit: async ({ request }) => {
		const { vstup } = parseSietkaSamostatnaVstup(await request.formData());
		return { step: 'form' as const, vstup };
	},

	// Odoslať odpis do Money — LEN interní (b2b nemá tlačidlo v UI a je aj tu
	// odmietnutý ako prvý krok, rovnaká obrana do hĺbky ako /zasklenia `odoslat`).
	odoslat: async ({ request, locals }) => {
		if (isB2B(locals.user)) {
			return { step: 'form' as const, error: 'Veľkoobchodný účet nemôže odpisovať do Money.' };
		}
		const formData = await request.formData();
		const { vstup, error } = parseSietkaSamostatnaVstup(formData);
		if (error) return { step: 'form' as const, error, vstup };
		const { r, err } = sietkaSamostatnaVypocet(
			loadCfg(),
			vstup.system,
			vstup.styl,
			vstup.otvorS,
			vstup.otvorV
		);
		if (err || !r) return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', vstup };
		const job = jobFor(vstup, r, locals.user?.username ?? '');
		// ak sa medzi náhľadom a potvrdením zmenili vzorce (Nastavenia), prepočet už
		// nesedí s tým, čo užívateľ videl → nezapisuj, ukáž nový výsledok (rovnaký
		// vzor ako /zasklenia `odoslat`)
		const potvrdene = String(formData.get('planHash') ?? '');
		const aktualny = contentHash(vstup.zak, job.polozky);
		if (potvrdene && potvrdene !== aktualny) {
			return {
				step: 'vysledok' as const,
				vstup,
				r,
				potrebuje3K: potrebuje3KKolajnicu(vstup.styl),
				planHash: aktualny,
				warn: 'Vzorce sa medzitým zmenili — toto je NOVÝ prepočet. Skontroluj čísla a potvrď znova.',
				cielInfo: {
					live: isLive(),
					filename: filenameFor(job),
					dir: targetDirFor(r.system, false)
				}
			};
		}
		try {
			const outcome = await writeOdpis(job);
			if (outcome.status === 'duplicate') {
				return {
					step: 'duplikat' as const,
					error: `Zákazka ${vstup.zak} (OP ${vstup.op}) už bola odoslaná ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv zmaž starý import v Money a záznam v histórii odpisov.`,
					vstup,
					// `+page.svelte` renderuje `vysledok`/`duplikat` v JEDNOM zdieľanom bloku
					// gejtovanom na `r` — bez neho by duplikát zobrazil PRÁZDNU stránku
					r,
					potrebuje3K: potrebuje3KKolajnicu(vstup.styl)
				};
			}
			if (outcome.status === 'blocked') {
				return {
					step: 'duplikat' as const,
					error: blokHlaska(outcome, vstup.zak, vstup.op),
					vstup,
					r,
					potrebuje3K: potrebuje3KKolajnicu(vstup.styl)
				};
			}
			return { step: 'hotovo' as const, vstup, r, outcome };
		} catch (e) {
			logger('sietka').error('writeOdpis (samostatná sieťka) zlyhal', {
				zak: vstup.zak,
				op: vstup.op,
				error: e
			});
			return {
				step: 'form' as const,
				error:
					'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.',
				vstup
			};
		}
	}
} satisfies Actions;

function jobFor(
	vstup: Awaited<ReturnType<typeof parseSietkaSamostatnaVstup>>['vstup'],
	r: NonNullable<ReturnType<typeof sietkaSamostatnaVypocet>['r']>,
	createdBy: string
): OdpisJob {
	return {
		modul: 'zasklenia',
		zak: vstup.zak,
		op: vstup.op,
		zakaznik: vstup.zakaznik,
		caka: false,
		createdBy,
		cakaSubdir: r.system,
		popis: (vstup.op + ' : ' + vstup.zakaznik + ' (sieťka)').trim(),
		polozky: r.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, qty: o.metre })),
		detail: {
			sietkaSamostatna: true,
			system: r.system,
			styl: r.styl,
			otvorS: vstup.otvorS,
			otvorV: vstup.otvorV,
			sklo: r.sklo,
			rozmerSietoviny: r.rozmerSietoviny,
			uchyt: vstup.sietka.uchyt,
			potrebuje3K: r.potrebuje3K,
			poznamka: vstup.poznamka
		}
	};
}
