// Verejný zákaznícky konfigurátor zimných záhrad (#386, etapa 3 jednotného rámu #384) —
// VEREJNÁ route (bez auth; `/konfigurator` prefix je v PUBLIC_PATHS → `/konfigurator/zimna-zahrada`
// prechádza cez `startsWith`). Display-only, BEZ CIEN (honest-null — zimná záhrada nemá overený
// cenový zdroj, viď design komentár #386), BEZ Money kódov. `load` posiela klientovi LEN client-safe
// katalóg z `konfigurator-zimna-zahrada` (modely/zasklenia/rozmedzia) + RAL farby — žiadny Money kód,
// žiadna cena. `actions.dopyt` = verejný kontaktný formulár → PDF špecifikácia (BEZ ceny, honest-null
// gate v pipeline) + Odoo lead, produkt SERVER-AUTORITATÍVNY (`'zimna-zahrada'`, klient ho nefalšuje).
// Money-neutrálne (guard: tests/konfigurator-money-safety.test.ts + tests/dopyt-money-safety.test.ts).
import type { Actions, PageServerLoad } from './$types';
import {
	ZZ_MODELY,
	ZZ_ZASKLENIA,
	ZZ_RANGES,
	ZZ_MODEL_DEFAULT,
	ZZ_ZASKLENIE_DEFAULT
} from '$lib/konfigurator-zimna-zahrada';
import { RAL_PALETA } from '$lib/vykres/ral';
// #277: zdieľaná verejná dopyt akcia (kontaktný formulár → PDF ponuka + Odoo lead). Táto route ju
// iba naimportuje a namountuje s produktom `'zimna-zahrada'` (server-autoritatívny). Money-NEUTRÁLNA.
import { dopytAction } from '$lib/server/dopyt-action';

// GET (SSR render) nie je rate-limitovaný — lacný statický katalóg + rozmedzia (rovnaká politika
// ako pergolová/bazénová podstránka); drahý POST (dopyt) je throttlovaný vo `dopyt-action`.
export const load: PageServerLoad = async () => {
	return {
		modely: ZZ_MODELY,
		zasklenia: ZZ_ZASKLENIA,
		// RAL farby (kód + názov, žiadny Money údaj) — rovnaký tvar ako pergolová/bazénová podstránka.
		farby: RAL_PALETA.map((r) => ({ kod: r.kod, nazov: r.nazov })),
		rozmedzia: ZZ_RANGES,
		// východiskové voľby (aby SSR render aj klient vychádzali z rovnakého platného stavu)
		defaulty: {
			model: ZZ_MODEL_DEFAULT,
			zasklenie: ZZ_ZASKLENIE_DEFAULT
		}
	};
};

export const actions = {
	// #277/#384: verejný dopyt — produkt je SERVER-AUTORITATÍVNY (`'zimna-zahrada'`), klient ho nevie
	// sfalšovať (žiadne dôveryhodné klientske pole). PDF titul + názov Odoo leadu sú tak produkt-aware
	// a cena je honest-null (zimná záhrada nemá cenový zdroj — gate `maCenovyZdroj`).
	dopyt: (event) => dopytAction(event, 'zimna-zahrada')
} satisfies Actions;
