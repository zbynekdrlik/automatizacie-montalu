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
import {
	parseSietkaSamostatnaVstup,
	parseSietkaMultiVstup,
	type SietkaMultiVstup
} from '$lib/server/sietka-samostatna';
import { SIETKA_SAMOSTATNA_SYSTEMY, potrebuje3KKolajnicu } from '$lib/sietka';
import {
	sietkaSamostatnaVypocet,
	sietkaSamostatnaMultiVypocet,
	type SietkaSamostatnaMultiOdpis
} from '$lib/server/compute';
import { isB2B } from '$lib/server/auth';
import {
	writeOdpis,
	isLive,
	targetDirFor,
	filenameFor,
	contentHash,
	blokHlaska,
	overrideOpts,
	rawFormEntries,
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

export const load: PageServerLoad = async () => {
	// opona (2x*) nie je podporovaná (rovnaký gate ako sietkaSamostatnaVypocet) —
	// nenúkaj ju vôbec v selecte, nech sa scriptovaný POST nemusí odmietať v akcii
	const styly = listSysStyly().filter(
		(s) => SIETKA_SAMOSTATNA_SYSTEMY.includes(s.system) && !s.styl.startsWith('2x')
	);
	return { styly, live: isLive() };
};

export const actions = {
	vypocitat: async ({ request, locals }) => {
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
			// #448/#451 predodpisové skladové varovanie + odobrať — LEN interní (b2b vidí tabuľku,
			// ale nie sklad ani tlačidlo Odoslať); sklad je interná dáta (rovnaká hranica ako inde)
			skladVarovania: isB2B(locals.user)
				? []
				: skladoveVarovania(
						r.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.metre }))
					),
			snapshotDatum: getSnapshotMeta().generatedAt,
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
				// #448/#451 predodpisové skladové varovanie + odobrať — interní (b2b odmietnutý vyššie)
				skladVarovania: skladoveVarovania(
					r.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.metre }))
				),
				snapshotDatum: getSnapshotMeta().generatedAt,
				planHash: aktualny,
				warn: 'Vzorce sa medzitým zmenili — toto je NOVÝ prepočet. Skontroluj čísla a potvrď znova.',
				cielInfo: {
					live: isLive(),
					filename: filenameFor(job),
					dir: targetDirFor(r.system, false)
				}
			};
		}
		// #461: vylúč položky, ktoré užívateľ odobral cez SkladVarovania
		const vylucene = parseVyluceneKody(formData);
		const finalJob = vylucPolozky(job, vylucene);
		try {
			const outcome = await writeOdpis(finalJob, overrideOpts(formData));
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
					step: 'blocked' as const,
					blokReason: outcome.reason!,
					blokAction: '?/odoslat',
					rawEntries: rawFormEntries(formData),
					error: blokHlaska(outcome, vstup.zak, vstup.op),
					vstup
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
	},

	// ---- Multi (#473): viac dodatočných sieťok naraz v jednom odpise ----

	upravitMulti: async ({ request }) => {
		const { vstup } = parseSietkaMultiVstup(await request.formData());
		return { step: 'form' as const, multiVstup: vstup };
	},

	vypocitatMulti: async ({ request, locals }) => {
		const { vstup, error } = parseSietkaMultiVstup(await request.formData());
		if (error) return { step: 'form' as const, error, multiVstup: vstup };
		const { r, err } = sietkaSamostatnaMultiVypocet(loadCfg(), vstup.kusy);
		if (err || !r)
			return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', multiVstup: vstup };
		const job = jobForMulti(vstup, r, '');
		return {
			step: 'vysledokMulti' as const,
			multiVstup: vstup,
			multi: r,
			// #448/#451 predodpisové skladové varovanie + odobrať — LEN interní (rovnaký vzor ako single)
			skladVarovania: isB2B(locals.user)
				? []
				: skladoveVarovania(
						r.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.metre }))
					),
			snapshotDatum: getSnapshotMeta().generatedAt,
			planHash: contentHash(vstup.zak, job.polozky),
			cielInfo: {
				live: isLive(),
				filename: filenameFor(job),
				dir: targetDirFor('Sietka', false)
			}
		};
	},

	// Odoslať odpis do Money — LEN interní (rovnaká obrana do hĺbky ako single `odoslat`).
	odoslatMulti: async ({ request, locals }) => {
		if (isB2B(locals.user)) {
			return { step: 'form' as const, error: 'Veľkoobchodný účet nemôže odpisovať do Money.' };
		}
		const formData = await request.formData();
		const { vstup, error } = parseSietkaMultiVstup(formData);
		if (error) return { step: 'form' as const, error, multiVstup: vstup };
		const { r, err } = sietkaSamostatnaMultiVypocet(loadCfg(), vstup.kusy);
		if (err || !r)
			return { step: 'form' as const, error: err ?? 'Výpočet zlyhal.', multiVstup: vstup };
		const job = jobForMulti(vstup, r, locals.user?.username ?? '');
		// rovnaký "medzitým sa zmenili vzorce" guard ako single `odoslat`
		const potvrdene = String(formData.get('planHash') ?? '');
		const aktualny = contentHash(vstup.zak, job.polozky);
		if (potvrdene && potvrdene !== aktualny) {
			return {
				step: 'vysledokMulti' as const,
				multiVstup: vstup,
				multi: r,
				skladVarovania: skladoveVarovania(
					r.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, mnozstvo: o.metre }))
				),
				snapshotDatum: getSnapshotMeta().generatedAt,
				planHash: aktualny,
				warn: 'Vzorce sa medzitým zmenili — toto je NOVÝ prepočet. Skontroluj čísla a potvrď znova.',
				cielInfo: {
					live: isLive(),
					filename: filenameFor(job),
					dir: targetDirFor('Sietka', false)
				}
			};
		}
		// #461: vylúč položky, ktoré užívateľ odobral cez SkladVarovania
		const vylucene = parseVyluceneKody(formData);
		const finalJob = vylucPolozky(job, vylucene);
		try {
			const outcome = await writeOdpis(finalJob, overrideOpts(formData));
			if (outcome.status === 'duplicate') {
				return {
					step: 'duplikatMulti' as const,
					error: `Zákazka ${vstup.zak} (OP ${vstup.op}) už bola odoslaná ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv zmaž starý import v Money a záznam v histórii odpisov.`,
					multiVstup: vstup,
					// duplikátna vetva zdieľa render blok s vysledokMulti (gejtovaný na `multi`) —
					// bez neho by duplikát zobrazil prázdnu stránku (rovnaká pasca ako PR #108)
					multi: r
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
			return { step: 'hotovoMulti' as const, multiVstup: vstup, multi: r, outcome };
		} catch (e) {
			logger('sietka').error('writeOdpis (multi sieťka) zlyhal', {
				zak: vstup.zak,
				op: vstup.op,
				error: e
			});
			return {
				step: 'form' as const,
				error:
					'Zápis odpisu zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.',
				multiVstup: vstup
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

/** #473 — jeden odpis pre VIAC sieťok naraz: `caka` ostáva `false` (rovnako ako
 *  jednokusová /sietka nemá „čaká na materiál" voľbu), `cakaSubdir` je preto len
 *  informačný (nikdy sa nepoužije, keďže caka=false → `targetDirFor` ho ignoruje). */
function jobForMulti(
	vstup: SietkaMultiVstup,
	r: SietkaSamostatnaMultiOdpis,
	createdBy: string
): OdpisJob {
	return {
		modul: 'zasklenia',
		zak: vstup.zak,
		op: vstup.op,
		zakaznik: vstup.zakaznik,
		caka: false,
		createdBy,
		cakaSubdir: 'Sietka',
		popis: (vstup.op + ' : ' + vstup.zakaznik + ' (sieťka multi)').trim(),
		polozky: r.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, qty: o.metre })),
		detail: {
			sietkaSamostatnaMulti: true,
			kusy: vstup.kusy.map((k) => ({
				system: k.system,
				styl: k.styl,
				otvorS: k.otvorS,
				otvorV: k.otvorV,
				uchyt: k.sietka.uchyt
			})),
			poznamka: vstup.poznamka
		}
	};
}
