// Verejný zákaznícky konfigurátor bazénových zastrešení (#385, etapa 2 jednotného rámu #384) —
// VEREJNÁ route (bez auth; `/konfigurator` prefix je v PUBLIC_PATHS → `/konfigurator/bazen`
// prechádza cez `startsWith`). Display-only, BEZ CIEN (honest-null — bazén nemá overený cenový
// zdroj, viď design komentár #385), BEZ Money kódov. `load` posiela klientovi LEN client-safe
// katalóg z `konfigurator-bazen` (modely/koľaj/výplne/rozmedzia) + RAL farby — žiadny Money kód,
// žiadna cena. `actions.dopyt` = verejný kontaktný formulár → PDF špecifikácia (BEZ ceny, honest-
// null gate v pipeline) + Odoo lead, produkt SERVER-AUTORITATÍVNY (`'bazen'`, klient ho nefalšuje).
// Money-neutrálne (guard: tests/konfigurator-money-safety.test.ts + tests/dopyt-money-safety.test.ts).
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
// #277: zdieľaná verejná dopyt akcia (kontaktný formulár → PDF ponuka + Odoo lead). Táto route ju
// iba naimportuje a namountuje s produktom `'bazen'` (server-autoritatívny). Money-NEUTRÁLNA.
import { dopytAction } from '$lib/server/dopyt-action';

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
	// produkt-aware a cena je honest-null (bazén nemá cenový zdroj — gate `maCenovyZdroj`).
	dopyt: (event) => dopytAction(event, 'bazen')
} satisfies Actions;
