// Verejný zákaznícky konfigurátor prístreškov a altánkov (#390, etapa 7/7 jednotného rámu #384) —
// VEREJNÁ route (bez auth; `/konfigurator` prefix je v PUBLIC_PATHS → `/konfigurator/pristresok`
// prechádza cez `startsWith`). Display-only, BEZ CIEN (honest-null — prístrešky nemajú overený
// cenový zdroj, viď design komentár #390), BEZ Money kódov. `load` posiela klientovi LEN client-safe
// katalóg z `konfigurator-pristresok` (typy/krytiny/rozmedzia) + RAL farby — žiadny Money kód, žiadna
// cena. `actions.dopyt` = verejný kontaktný formulár → PDF špecifikácia (BEZ ceny, honest-null gate
// v pipeline) + Odoo lead, produkt SERVER-AUTORITATÍVNY (`'pristresok'`, klient ho nefalšuje).
// Money-neutrálne (guard: tests/konfigurator-money-safety.test.ts + tests/dopyt-money-safety.test.ts).
import type { Actions, PageServerLoad } from './$types';
import {
	PRISTRESOK_TYPY,
	PRISTRESOK_KRYTINY,
	PRISTRESOK_RANGES,
	PRISTRESOK_TYP_DEFAULT,
	PRISTRESOK_KRYTINA_DEFAULT
} from '$lib/konfigurator-pristresok';
import { RAL_PALETA } from '$lib/vykres/ral';
// #277: zdieľaná verejná dopyt akcia (kontaktný formulár → PDF ponuka + Odoo lead). Táto route ju
// iba naimportuje a namountuje s produktom `'pristresok'` (server-autoritatívny). Money-NEUTRÁLNA.
import { dopytAction } from '$lib/server/dopyt-action';

// GET (SSR render) nie je rate-limitovaný — lacný statický katalóg + rozmedzia (rovnaká politika
// ako ostatné podstránky); drahý POST (dopyt) je throttlovaný vo `dopyt-action`.
export const load: PageServerLoad = async () => {
	return {
		typy: PRISTRESOK_TYPY,
		krytiny: PRISTRESOK_KRYTINY,
		// RAL farby (kód + názov, žiadny Money údaj) — rovnaký tvar ako ostatné podstránky.
		farby: RAL_PALETA.map((r) => ({ kod: r.kod, nazov: r.nazov })),
		rozmedzia: PRISTRESOK_RANGES,
		// východiskové voľby (aby SSR render aj klient vychádzali z rovnakého platného stavu)
		defaulty: {
			typ: PRISTRESOK_TYP_DEFAULT,
			krytina: PRISTRESOK_KRYTINA_DEFAULT
		}
	};
};

export const actions = {
	// #277/#384: verejný dopyt — produkt je SERVER-AUTORITATÍVNY (`'pristresok'`), klient ho nevie
	// sfalšovať (žiadne dôveryhodné klientske pole). PDF titul + názov Odoo leadu sú tak
	// produkt-aware a cena je honest-null (prístrešky nemajú cenový zdroj — gate `maCenovyZdroj`).
	dopyt: (event) => dopytAction(event, 'pristresok')
} satisfies Actions;
