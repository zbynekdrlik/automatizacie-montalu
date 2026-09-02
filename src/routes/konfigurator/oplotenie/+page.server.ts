// Verejný zákaznícky konfigurátor hliníkového oplotenia a brán (#388, etapa 5 jednotného rámu #384) —
// VEREJNÁ route (bez auth; `/konfigurator` prefix je v PUBLIC_PATHS → `/konfigurator/oplotenie`
// prechádza cez `startsWith`). Display-only, BEZ CIEN (honest-null — oplotenie nemá overený cenový
// zdroj, viď design komentár #388), BEZ Money kódov. `load` posiela klientovi LEN client-safe katalóg
// z `konfigurator-oplotenie` (typy/modely/rozmedzia) + RAL farby — žiadny Money kód, žiadna cena.
// `actions.dopyt` = verejný kontaktný formulár → PDF špecifikácia (BEZ ceny, honest-null gate v
// pipeline) + Odoo lead, produkt SERVER-AUTORITATÍVNY (`'oplotenie'`, klient ho nefalšuje).
// Money-neutrálne (guard: tests/konfigurator-money-safety.test.ts + tests/dopyt-money-safety.test.ts).
import type { Actions, PageServerLoad } from './$types';
import {
	OPLOTENIE_TYPY,
	OPLOTENIE_MODELY,
	OPLOTENIE_RANGES,
	OPLOTENIE_TYP_DEFAULT,
	OPLOTENIE_MODEL_DEFAULT
} from '$lib/konfigurator-oplotenie';
import { RAL_PALETA } from '$lib/vykres/ral';
// #277: zdieľaná verejná dopyt akcia (kontaktný formulár → PDF ponuka + Odoo lead). Táto route ju
// iba naimportuje a namountuje s produktom `'oplotenie'` (server-autoritatívny). Money-NEUTRÁLNA.
import { dopytAction } from '$lib/server/dopyt-action';

// GET (SSR render) nie je rate-limitovaný — lacný statický katalóg + rozmedzia (rovnaká politika
// ako pergolová/bazénová podstránka); drahý POST (dopyt) je throttlovaný vo `dopyt-action`.
export const load: PageServerLoad = async () => {
	return {
		typy: OPLOTENIE_TYPY,
		modely: OPLOTENIE_MODELY,
		// RAL farby (kód + názov, žiadny Money údaj) — rovnaký tvar ako bazénová podstránka.
		farby: RAL_PALETA.map((r) => ({ kod: r.kod, nazov: r.nazov })),
		rozmedzia: OPLOTENIE_RANGES,
		// východiskové voľby (aby SSR render aj klient vychádzali z rovnakého platného stavu)
		defaulty: {
			typ: OPLOTENIE_TYP_DEFAULT,
			model: OPLOTENIE_MODEL_DEFAULT
		}
	};
};

export const actions = {
	// #277/#384: verejný dopyt — produkt je SERVER-AUTORITATÍVNY (`'oplotenie'`), klient ho nevie
	// sfalšovať (žiadne dôveryhodné klientske pole). PDF titul + názov Odoo leadu sú tak
	// produkt-aware a cena je honest-null (oplotenie nemá cenový zdroj — gate `maCenovyZdroj`).
	dopyt: (event) => dopytAction(event, 'oplotenie')
} satisfies Actions;
