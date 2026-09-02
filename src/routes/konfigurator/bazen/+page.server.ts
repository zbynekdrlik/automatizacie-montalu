// Verejný zákaznícky konfigurátor bazénových zastrešení (#385, etapa 2 jednotného rámu #384;
// #404 orientačná cena; #422 záväzná objednávka) — VEREJNÁ route (bez auth; `/konfigurator` prefix
// je v PUBLIC_PATHS → `/konfigurator/bazen` prechádza cez `startsWith`). BEZ Money kódov, BEZ
// VEĽKOOBCHODNEJ (VO) ceny.
// `load` posiela klientovi LEN client-safe katalóg z `konfigurator-bazen` (modely/koľaj/výplne/
// rozmedzia) + RAL farby — žiadny Money kód, žiadna cena (cena je až v akcii `vypocet`). `actions`:
// `vypocet` = orientačná MO cena (#404, server-počítaná bazénovou maticou); `dopyt` = verejný
// kontaktný formulár → PDF špecifikácia s orientačnou cenou + Odoo lead; `objednavka` (#422, vzor
// pergolovej #319) = záväzná objednávka → uloženie (`je_objednavka=1`) + PDF + Odoo lead ako
// OPPORTUNITY, zapečatí objednanú cenu vrátane MO/VO hladiny. Oba `dopyt`/`objednavka` majú produkt
// SERVER-AUTORITATÍVNY (`'bazen'`, klient ho nefalšuje). Money-neutrálne (žiadny odpis/`/data`
// zápis, ŽIADNA platobná brána; guard: tests/konfigurator-money-safety.test.ts +
// tests/dopyt-money-safety.test.ts).
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	BAZEN_MODELY,
	BAZEN_KOLAJ,
	BAZEN_VYPLNE,
	BAZEN_RANGES,
	BAZEN_MODEL_DEFAULT,
	BAZEN_KOLAJ_DEFAULT,
	BAZEN_VYPLN_DEFAULT
} from '$lib/konfigurator-bazen';
import { RAL_PALETA } from '$lib/vykres/ral';
// #277/#422: zdieľané verejné akcie (kontaktný formulár → PDF ponuka + Odoo lead; #319 záväzná
// objednávka = escalácia dopytu). Táto route ich iba naimportuje a namountuje s produktom `'bazen'`
// (server-autoritatívny). Money-NEUTRÁLNE (žiadny odpis, žiadna platobná brána).
import { dopytAction, objednavkaAction } from '$lib/server/dopyt-action';
// #404: orientačná PREDAJNÁ cena — server-only bazénový cenový modul (seed sa do klientskeho bundle
// nikdy nedostane, guard konfigurator-money-safety). Hladina (MO/VO) rozhoduje SERVER, nikdy klient.
import { cenaPreModelBazen, cenyModelovBazen } from '$lib/server/konfigurator-bazen-cena';
import { cenovaHladina } from '$lib/server/konfigurator-hladina';
// #427: per-model cenníkové rozmerové obálky (LEN rozmery, žiadna cena) — vystavené klientovi cez
// `load`, aby zákazník videl PLATNÝ katalógový rozsah zvoleného modelu namiesto „nemej steny".
import { BAZEN_OBALKY } from '$lib/server/konfigurator-obalky';
import { parseBazenCenaVstup } from '$lib/server/konfigurator-bazen-vstup';
// #428: zdieľaná throttle predohra cenových `vypocet` akcií (rule-of-four) — nahrádza inline per-IP
// rate-limit (public-throttle + client-ip); tie modul `konfigurator-cena-akcia` importuje sám.
import { cenaThrottle } from '$lib/server/konfigurator-cena-akcia';

// GET (SSR render) nie je rate-limitovaný — lacný statický katalóg + rozmedzia (rovnaká politika
// ako pergolová podstránka); drahý POST (dopyt) je throttlovaný vo `dopyt-action`.
export const load: PageServerLoad = async () => {
	return {
		modely: BAZEN_MODELY,
		kolaje: BAZEN_KOLAJ,
		vyplne: BAZEN_VYPLNE,
		// RAL farby (kód + názov, žiadny Money údaj) — rovnaký tvar ako pergolová podstránka.
		farby: RAL_PALETA.map((r) => ({ kod: r.kod, nazov: r.nazov })),
		rozmedzia: BAZEN_RANGES,
		// #427: per-model cenníkové obálky (rozmery s katalógovou cenou) — klient z nich zobrazí
		// „cenníkový rozsah" a čestnú „mimo rozsah = na vyžiadanie" hlášku. LEN rozmery, žiadna cena.
		obalky: BAZEN_OBALKY,
		// východiskové voľby (aby SSR render aj klient vychádzali z rovnakého platného stavu)
		defaulty: {
			model: BAZEN_MODEL_DEFAULT,
			kolaj: BAZEN_KOLAJ_DEFAULT,
			vypln: BAZEN_VYPLN_DEFAULT
		}
	};
};

export const actions = {
	// #277/#384: verejný dopyt — produkt je SERVER-AUTORITATÍVNY (`'bazen'`), klient ho nevie
	// sfalšovať (žiadne dôveryhodné klientske pole). PDF titul + názov Odoo leadu sú tak
	// produkt-aware a cena sa opečiatkuje bazénovou maticou (#404, gate `maCenovyZdroj('bazen')`).
	dopyt: (event) => dopytAction(event, 'bazen'),
	// #422 (vzor pergolovej #319): záväzná objednávka — kontakt + fakturačné údaje + súhlas →
	// uloženie (`je_objednavka=1`) + PDF špecifikácia + Odoo lead ako OPPORTUNITY. Money-neutrálne
	// (ŽIADNA platobná brána, žiadny odpis); zapečatí objednanú cenu vrátane MO/VO hladiny (#404
	// bazénová matica cez `cenaZCfgProdukt`).
	objednavka: (event) => objednavkaAction(event, 'bazen'),
	// #404: orientačná cena zvoleného modelu + „ceny modelov vedľa seba". SvelteKit ZAKAZUJE miešať
	// `default` s pomenovanými akciami, preto je aj `dopyt` pomenovaná (sveltekit-actions.md). Vzor
	// pergolovej `vypocet` — per-IP throttle → parse → cena v hladine odvodenej SERVER-SIDE z používateľa.
	vypocet: async (event) => {
		// #428: zdieľaná throttle predohra; `prazdno` = prázdne dátové polia bazénového návratu.
		const throttled = cenaThrottle(event, { cena: null, cenyModely: null });
		if (throttled) return throttled;
		const { request, locals } = event;

		const parsed = parseBazenCenaVstup(await request.formData());
		if ('error' in parsed) return fail(400, { cena: null, cenyModely: null, error: parsed.error });
		const { vstup } = parsed;
		// #318: hladina SERVER-SIDE z `locals.user` (prihlásený b2b → VO, inak MO). VO sa do MO/verejnej
		// odpovede NIKDY nedostane. `locals` je pri reálnom requeste vždy prítomné (`?.` obranné).
		const hladina = cenovaHladina(locals?.user ?? null);
		const cena = cenaPreModelBazen(
			{ dlzkaMm: vstup.dlzkaMm, sirkaMm: vstup.sirkaMm, model: vstup.model },
			hladina
		);
		const cenyModely = cenyModelovBazen(vstup.dlzkaMm, vstup.sirkaMm, hladina);
		return { cena, cenyModely, error: null };
	}
} satisfies Actions;
