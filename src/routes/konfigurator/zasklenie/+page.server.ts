// Verejný zákaznícky konfigurátor zasklenia terás a balkónov (#387, etapa jednotného rámu #384) —
// VEREJNÁ route (bez auth; `/konfigurator` prefix je v PUBLIC_PATHS → `/konfigurator/zasklenie`
// prechádza cez `startsWith`). Display-only, BEZ CIEN (honest-null — zasklenie nemá overený cenový
// zdroj, viď design komentár #387), BEZ Money kódov. `load` posiela klientovi LEN client-safe
// katalóg z `konfigurator-zasklenie` (umiestnenia/modely/výplne/rozmedzia) + RAL farby — žiadny
// Money kód, žiadna cena. `actions.dopyt` = verejný kontaktný formulár → PDF špecifikácia (BEZ ceny,
// honest-null gate v pipeline) + Odoo lead, produkt SERVER-AUTORITATÍVNY (`'zasklenie'`, klient ho
// nefalšuje). Money-neutrálne (guard: tests/konfigurator-money-safety.test.ts).
import type { Actions, PageServerLoad } from './$types';
import {
	ZASKLENIE_MODELY,
	ZASKLENIE_UMIESTNENIA,
	ZASKLENIE_VYPLNE,
	ZASKLENIE_RANGES,
	ZASKLENIE_UMIESTNENIE_DEFAULT,
	ZASKLENIE_VYPLN_DEFAULT,
	zaskleniModelDefault
} from '$lib/konfigurator-zasklenie';
import { RAL_PALETA } from '$lib/vykres/ral';
// #277: zdieľaná verejná dopyt akcia (kontaktný formulár → PDF ponuka + Odoo lead). Táto route ju
// iba naimportuje a namountuje s produktom `'zasklenie'` (server-autoritatívny). Money-NEUTRÁLNA.
import { dopytAction } from '$lib/server/dopyt-action';

// GET (SSR render) nie je rate-limitovaný — lacný statický katalóg + rozmedzia (rovnaká politika
// ako pergolová/bazénová podstránka); drahý POST (dopyt) je throttlovaný vo `dopyt-action`.
export const load: PageServerLoad = async () => {
	return {
		umiestnenia: ZASKLENIE_UMIESTNENIA,
		// všetky modely (klient si per umiestnenie filtruje `$derived` — client-safe katalóg,
		// žiadny Money kód, nesie umiestnenie + system + popis)
		modely: ZASKLENIE_MODELY,
		vyplne: ZASKLENIE_VYPLNE,
		// RAL farby (kód + názov, žiadny Money údaj) — rovnaký tvar ako pergola/bazén podstránka.
		farby: RAL_PALETA.map((r) => ({ kod: r.kod, nazov: r.nazov })),
		rozmedzia: ZASKLENIE_RANGES,
		// východiskové voľby (aby SSR render aj klient vychádzali z rovnakého platného stavu)
		defaulty: {
			umiestnenie: ZASKLENIE_UMIESTNENIE_DEFAULT,
			model: zaskleniModelDefault(ZASKLENIE_UMIESTNENIE_DEFAULT),
			vypln: ZASKLENIE_VYPLN_DEFAULT
		}
	};
};

export const actions = {
	// #277/#384: verejný dopyt — produkt je SERVER-AUTORITATÍVNY (`'zasklenie'`), klient ho nevie
	// sfalšovať (žiadne dôveryhodné klientske pole). PDF titul + názov Odoo leadu sú tak
	// produkt-aware a cena je honest-null (zasklenie nemá cenový zdroj — gate `maCenovyZdroj`).
	dopyt: (event) => dopytAction(event, 'zasklenie')
} satisfies Actions;
