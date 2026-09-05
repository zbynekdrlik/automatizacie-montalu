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
import { catalogForClient } from '$lib/server/pergola';
import { parseRucnePolozky, type RucnaPolozka } from '$lib/pergola-rucne';
// #378 — FIX (bočné pevné zasklenie): parse + odvodenie z pergoly (round-trip echo).
// DISPLAY-ONLY + Money-neutrálne — FIX NEVSTUPUJE do buildRezervaciaRozpis.
import { parseFixZPergoly, efektivnyFix, type FixZPergola } from '$lib/pergola-fix';
import { spocitajFixZPergoly } from '$lib/pergola-fix';
import type { PergolaNarezVstup } from '$lib/pergola-narez';
import { spocitajNarez, komponentyPergoly } from '$lib/pergola-narez';
import { spocitajStrechaSklo } from '$lib/pergola-sklo';
// #419 extended scope — expedičný zoznam + Odoo push
import { pushExpediciaToOdoo } from '$lib/server/expedicia-odoo';
import { spocitajTesnenia } from '$lib/pergola-tesnenia';
import { expedicnyZoznam } from '$lib/pergola-expedicia';
import { writeOdpis, isLive, blokHlaska, overrideOpts, rawFormEntries } from '$lib/server/money';
import { isB2B, type SessionUser } from '$lib/server/auth';
import { enrichPolozky, type CenyResult } from '$lib/server/ceny';
import { strechaSkloCenaPre, type StrechaSkloCena } from '$lib/server/sklo-strecha-cena';
import { logger } from '$lib/server/log';

const log = logger('pergola:narez');

/** ZAK/OP/zákazník z formulára — do dokladu, dedupu a názvu súboru. */
function parseIdent(form: FormData): RezervaciaIdent {
	return {
		zak: String(form.get('zak') ?? '').trim(),
		op: String(form.get('op') ?? '').trim(),
		zakaznik: String(form.get('zakaznik') ?? '').trim()
	};
}

/** #234 — ručné („pometrané") riadky z hidden JSON inputu (round-trip vzor PR #81).
 *  Prepočet na SERVERI (nedôveruje klientovi). Vráti riadky + prípadnú chybu formátu. */
function parseRucne(form: FormData): { rucne: RucnaPolozka[]; error: string | null } {
	const { rows, error } = parseRucnePolozky(form.get('rucnePolozky') as string | null);
	return { rucne: rows, error };
}

/** #378 — FIX z formulára + odvodenie z pergoly (server je autorita: pri `auto`
 *  prepočíta rozmery z rozmerov pergoly, nedôveruje klientovi). Echuje sa v každej
 *  akcii (round-trip). FIX je DISPLAY-ONLY — do Money odpisu NEIDE. */
function parseFix(form: FormData, vstup: PergolaNarezVstup): FixZPergola {
	return efektivnyFix(parseFixZPergoly(form), {
		hlbka: vstup.hlbka,
		prednaSvetlost: vstup.prednaSvetlost,
		vyskaZadna: vstup.vyskaZadna
	});
}

/**
 * Cenový zoznam materiálu (#232, display-only) — LEN pre interných. /pergola* je pre
 * b2b aj tak zablokovaná na úrovni hooku; toto je druhá vrstva (obrana do hĺbky ako
 * zasklenia `cenyPre` / Money-write hranica): pre b2b sa cena VÔBEC nedopočíta, takže
 * sa nikdy nedostane do HTML odpovede. Ceníme zobrazené nenulové položky — spočítané
 * PRP profily + ručné riadky #234 (nesú vlastnú MJ m/ks). Money odpis sa NEMENÍ.
 */
function cenyPre(
	user: SessionUser | null,
	nonzero: { kod: string; nazov: string; qty: number; mj?: string }[]
): CenyResult | undefined {
	if (isB2B(user)) return undefined;
	return enrichPolozky(nonzero);
}

/**
 * #223 — cena strešného skla (display-only, LEN pre interných): €/m² zo snapshotu + celková cena
 * skiel (celková plocha × €/m²). Rovnaká obrana do hĺbky ako `cenyPre`: pre b2b sa cena VÔBEC
 * nedopočíta (nedostane sa do HTML). Celková plocha sa berie z `spocitajStrechaSklo(vstup)` (tá istá
 * čistá geometria, akú klient renderuje) — honest-null keď dĺžka/počet/kód/cena chýba. Money odpis
 * skla sa NEROBÍ.
 */
function strechaCenaPre(
	user: SessionUser | null,
	vstup: PergolaNarezVstup
): StrechaSkloCena | null {
	if (isB2B(user)) return null;
	const geo = spocitajStrechaSklo(vstup);
	return strechaSkloCenaPre(vstup.strechaSkloTyp ?? null, geo.plochaCelkomM2);
}

export const load: PageServerLoad = async () => {
	// Dátum do rohovej pečiatky výkresu (#194) = SERVEROVÝ čas (rovnaká disciplína
	// ako /pergola/navrh #138). `live` = TEST vs LIVE Money režim (badge + poistka).
	// #234 — katalóg pergoly na klienta: okamžité varovanie pri neznámom Money kóde
	// ručného riadku (server ostáva autorita, toto je len UX).
	return { datumIso: new Date().toISOString(), live: isLive(), catalog: catalogForClient() };
};

export const actions = {
	spocitat: async ({ request, locals }) => {
		const form = await request.formData();
		const { vstup, error } = parsePergolaNarezVstup(form);
		// #233 — ZAK/OP/zákazník zadané skôr v tom istom toku echujeme späť, nech sa v
		// odpisovom bloku predvyplnia a nezadávajú sa dvakrát.
		const ident = parseIdent(form);
		// #234 — ručné riadky echujeme cez celý tok (round-trip, prežijú „Späť a upraviť")
		const { rucne } = parseRucne(form);
		// #378 — FIX echujeme cez celý tok (round-trip); DISPLAY-ONLY, do Money NEIDE
		const fix = parseFix(form, vstup);
		if (error) return { step: 'form' as const, error, vstup, ident, rucne, fix };
		// #223 — cena strešného skla €/m² + celková cena (LEN interní; b2b nikdy nedostane cenu).
		// Geometria sa renderuje klientsky, ale server si celkovú plochu re-počíta pre cenu.
		const strechaSkloCena = strechaCenaPre(locals.user, vstup);
		return {
			step: 'vysledok' as const,
			vstup,
			ident,
			rucne,
			fix,
			strechaSkloCena,
			error: null as string | null
		};
	},

	// „← Späť a upraviť": echo vstupu späť do formulára (nekreslí), rovnaká pasca ako
	// v ostatných moduloch (obyčajný <a href> by ho vynuloval — nova-stranka §4).
	// #233 — echujeme aj ident, aby ZAK/OP/zákazník prežili round-trip (nezadávať dvakrát).
	// #234 — a ručné riadky (pometrané), aby sa pri úprave nestratili (PR #81 pasca).
	upravit: async ({ request }) => {
		const form = await request.formData();
		const { vstup } = parsePergolaNarezVstup(form);
		const ident = parseIdent(form);
		const { rucne } = parseRucne(form);
		const fix = parseFix(form, vstup);
		return { step: 'form' as const, vstup, ident, rucne, fix };
	},

	// #221: z rozmerov → Money rozpis rezervácie (BEZ zápisu) → nahlad na potvrdenie.
	rezervovat: async ({ request, locals }) => {
		const form = await request.formData();
		const { vstup, error } = parsePergolaNarezVstup(form);
		const ident = parseIdent(form);
		const { rucne, error: rucneError } = parseRucne(form);
		// #378 — FIX echo (round-trip); DISPLAY-ONLY, NEIDE do buildRezervaciaRozpis
		const fix = parseFix(form, vstup);
		if (error) return { step: 'vysledok' as const, vstup, ident, rucne, fix, rezError: error };
		if (rucneError)
			return { step: 'vysledok' as const, vstup, ident, rucne, fix, rezError: rucneError };
		const res = buildRezervaciaRozpis(vstup, ident, rucne);
		if (!res.rozpis) {
			log.warn('rezervácia rozpis chyba', {
				zak: ident.zak,
				op: ident.op,
				rezError: res.error
			});
			return { step: 'vysledok' as const, vstup, ident, rucne, fix, rezError: res.error };
		}
		const rozpis = res.rozpis;
		log.info('rezervácia rozpis', {
			zak: ident.zak,
			op: ident.op,
			polozky: rozpis.pocetPolozok,
			rucne: rucne.length,
			vylucene: rozpis.vylucene.length
		});
		// cenový blok (#232) — LEN interní; b2b nikdy nedostane `ceny`
		const ceny = cenyPre(locals.user, rozpis.nonzero);
		return { step: 'rez-nahlad' as const, vstup, ident, rucne, fix, rozpis, ceny, rezError: null };
	},

	// #221: zápis rezervačného odpisu do Money (LEN po explicitnom potvrdení, ten istý
	// bezpečnostný model ako CAD odpis — nahlad, potom potvrdenie). Prepočíta ZNOVA zo
	// surového vstupu (nedôveruje klientovi), zdieľaný dedup s CAD odpisom.
	odoslat: async ({ request, locals }) => {
		const form = await request.formData();
		const { vstup, error } = parsePergolaNarezVstup(form);
		const ident = parseIdent(form);
		const { rucne, error: rucneError } = parseRucne(form);
		// #378 — FIX echo (round-trip); DISPLAY-ONLY, NEIDE do buildRezervaciaRozpis
		const fix = parseFix(form, vstup);
		if (error) return { step: 'vysledok' as const, vstup, ident, rucne, fix, rezError: error };
		if (rucneError)
			return { step: 'vysledok' as const, vstup, ident, rucne, fix, rezError: rucneError };
		const { rozpis, error: rezError } = buildRezervaciaRozpis(vstup, ident, rucne);
		if (rezError || !rozpis)
			return {
				step: 'vysledok' as const,
				vstup,
				ident,
				rucne,
				fix,
				rezError: rezError ?? 'Rozpis rezervácie sa nepodarilo spočítať.'
			};

		const job = rezervaciaJob(vstup, ident, rozpis, locals.user?.username ?? '');
		log.info('rezervácia odoslať', {
			zak: ident.zak,
			op: ident.op,
			live: isLive(),
			riadkov: rozpis.pocetPolozok
		});
		// cenový blok (#232) — LEN interní. Lazy (thunk): úspešný zápis končí v „rez-hotovo"
		// bez cenového bloku, tak ho nepočítame zbytočne — len keď sa vraciame do
		// „rez-nahlad" (duplikát/chyba). Zavolá sa nanajvýš raz (vetvy sú return).
		const cenyBlok = () => cenyPre(locals.user, rozpis.nonzero);
		try {
			const outcome = await writeOdpis(job, overrideOpts(form));
			if (outcome.status === 'duplicate') {
				return {
					step: 'rez-nahlad' as const,
					vstup,
					ident,
					rucne,
					fix,
					rozpis,
					ceny: cenyBlok(),
					rezError: `Zákazka ${ident.zak} (OP ${ident.op}) už bola odoslaná (rezervácia alebo odpis) ${outcome.duplicateCreatedAt ?? ''} — znova ju neposielam. Ak ide o opravu, najprv uvoľni záznam v histórii odpisov.`
				};
			}
			if (outcome.status === 'blocked') {
				return {
					step: 'blocked' as const,
					blokReason: outcome.reason!,
					blokAction: '?/odoslat',
					rawEntries: rawFormEntries(form),
					// echo vstup/ident/rucne/fix (ako duplikát vetva) — inak reštart-`$effect` zmaže parent
					// `$state` pri blocked renderi (#300 review 🔵)
					vstup,
					ident,
					rucne,
					fix,
					rezError: blokHlaska(outcome, ident.zak, ident.op)
				};
			}
			log.info('rezervácia zapísaná', {
				zak: ident.zak,
				filename: outcome.filename,
				live: outcome.live
			});
			return {
				step: 'rez-hotovo' as const,
				vstup,
				ident,
				rucne,
				fix,
				rozpis,
				outcome,
				rezError: null
			};
		} catch (e) {
			log.error('rezervácia writeOdpis zlyhal', { zak: ident.zak, op: ident.op, error: e });
			return {
				step: 'rez-nahlad' as const,
				vstup,
				ident,
				rucne,
				fix,
				rozpis,
				ceny: cenyBlok(),
				rezError:
					'Zápis rezervácie zlyhal — súbor sa NEzapísal a odoslanie sa dá bezpečne zopakovať. Ak sa to opakuje, nahlás problém.'
			};
		}
	},

	// #419 extended scope: expedičný zoznam → Odoo sale.order log-note (one-shot).
	// Money-NEUTRÁLNE — neposiela do Money, len PDF prílohu na internú note.
	odoslatExpediciuDoOdoo: async ({ request, locals }) => {
		const form = await request.formData();
		const { vstup, error } = parsePergolaNarezVstup(form);
		const ident = parseIdent(form);
		const { rucne } = parseRucne(form);
		const fix = parseFix(form, vstup);
		if (error || !ident.zak || !ident.op || !ident.zakaznik) {
			return {
				step: 'vysledok' as const,
				vstup,
				ident,
				rucne,
				fix,
				strechaSkloCena: strechaCenaPre(locals.user, vstup),
				error: error ?? 'Vyplň ZAK, OP a zákazníka.',
				odooResult: null
			};
		}
		const vysledok = spocitajNarez(vstup);
		const komponenty = komponentyPergoly(vstup);
		const strechaSklo = spocitajStrechaSklo(vstup);
		const fixResult = spocitajFixZPergoly(fix);
		const tesnenia = spocitajTesnenia(vysledok);
		const zoznam = expedicnyZoznam(vysledok, komponenty, {
			strechaSklo,
			fix: fix.zapnuty
				? {
						zapnuty: fix.zapnuty,
						zrkadlo: fix.zrkadlo,
						vykres: fixResult.vykres
					}
				: null,
			tesnenia
		});
		const odooResult = await pushExpediciaToOdoo(zoznam, {
			zak: ident.zak,
			op: ident.op,
			zakaznik: ident.zakaznik
		});
		log.info('expedicia do Odoo', {
			zak: ident.zak,
			op: ident.op,
			result: odooResult.result,
			poloziek: zoznam.polozky.length
		});
		return {
			step: 'vysledok' as const,
			vstup,
			ident,
			rucne,
			fix,
			strechaSkloCena: strechaCenaPre(locals.user, vstup),
			error: null as string | null,
			odooResult
		};
	}
} satisfies Actions;
