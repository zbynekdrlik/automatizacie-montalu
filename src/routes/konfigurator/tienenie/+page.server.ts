// Verejný zákaznícky konfigurátor tienenia — markízy a screenové rolety (#389, etapa 6 jednotného
// rámu #384) — VEREJNÁ route (bez auth; `/konfigurator` prefix je v PUBLIC_PATHS → `/konfigurator/
// tienenie` prechádza cez `startsWith`). Display-only, BEZ CIEN (honest-null — tienenie nemá overený
// cenový zdroj, viď design komentár #389), BEZ Money kódov. `load` posiela klientovi LEN client-safe
// katalóg z `konfigurator-tienenie` (modely/ovládanie/rozmedzia) + RAL farby — žiadny Money kód,
// žiadna cena. `actions.dopyt` = verejný kontaktný formulár → PDF špecifikácia (BEZ ceny, honest-null
// gate v pipeline) + Odoo lead, produkt SERVER-AUTORITATÍVNY (`'tienenie'`, klient ho nefalšuje).
// Money-neutrálne (guard: tests/konfigurator-money-safety.test.ts + tests/dopyt-money-safety.test.ts).
import type { Actions, PageServerLoad } from './$types';
import {
	TIENENIE_MODELY,
	TIENENIE_OVLADANIE,
	TIENENIE_RANGES,
	TIENENIE_MODEL_DEFAULT,
	TIENENIE_OVLADANIE_DEFAULT
} from '$lib/konfigurator-tienenie';
import { RAL_PALETA } from '$lib/vykres/ral';
// #277: zdieľaná verejná dopyt akcia (kontaktný formulár → PDF ponuka + Odoo lead). Táto route ju
// iba naimportuje a namountuje s produktom `'tienenie'` (server-autoritatívny). Money-NEUTRÁLNA.
import { dopytAction } from '$lib/server/dopyt-action';

// GET (SSR render) nie je rate-limitovaný — lacný statický katalóg + rozmedzia (rovnaká politika
// ako ostatné podstránky); drahý POST (dopyt) je throttlovaný vo `dopyt-action`.
export const load: PageServerLoad = async () => {
	return {
		modely: TIENENIE_MODELY,
		ovladanie: TIENENIE_OVLADANIE,
		// RAL farby (kód + názov, žiadny Money údaj) — rovnaký tvar ako ostatné podstránky.
		farby: RAL_PALETA.map((r) => ({ kod: r.kod, nazov: r.nazov })),
		rozmedzia: TIENENIE_RANGES,
		// východiskové voľby (aby SSR render aj klient vychádzali z rovnakého platného stavu)
		defaulty: {
			model: TIENENIE_MODEL_DEFAULT,
			ovladanie: TIENENIE_OVLADANIE_DEFAULT
		}
	};
};

export const actions = {
	// #277/#384: verejný dopyt — produkt je SERVER-AUTORITATÍVNY (`'tienenie'`), klient ho nevie
	// sfalšovať (žiadne dôveryhodné klientske pole). PDF titul + názov Odoo leadu sú tak produkt-aware
	// a cena je honest-null (tienenie nemá cenový zdroj — gate `maCenovyZdroj`).
	dopyt: (event) => dopytAction(event, 'tienenie')
} satisfies Actions;
