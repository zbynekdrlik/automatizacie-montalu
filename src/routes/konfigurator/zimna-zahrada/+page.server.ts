// Verejný zákaznícky konfigurátor zimných záhrad (#386, etapa 3 jednotného rámu #384; #408 orientačná
// cena) — VEREJNÁ route (bez auth; `/konfigurator` prefix je v PUBLIC_PATHS → `/konfigurator/zimna-zahrada`
// prechádza cez `startsWith`). BEZ Money kódov, BEZ VEĽKOOBCHODNEJ (VO) ceny. `load` posiela klientovi
// LEN client-safe katalóg z `konfigurator-zimna-zahrada` (modely/zasklenia/rozmedzia) + RAL farby —
// žiadny Money kód, žiadna cena (cena je až v akcii `vypocet`). `actions`: `vypocet` = orientačná MO
// cena (#408, server-počítaná maticou montalu.sk); `dopyt` = verejný kontaktný formulár → PDF
// špecifikácia s orientačnou cenou + Odoo lead, produkt SERVER-AUTORITATÍVNY (`'zimna-zahrada'`, klient
// ho nefalšuje). Money-neutrálne (guard: tests/konfigurator-money-safety.test.ts + tests/dopyt-money-safety.test.ts).
import { fail } from '@sveltejs/kit';
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
// #408: orientačná PREDAJNÁ cena — server-only cenový modul (seed sa do klientskeho bundle nikdy
// nedostane, guard konfigurator-money-safety). Hladina (MO/VO) rozhoduje SERVER, nikdy klient.
import { cenaPreZz } from '$lib/server/konfigurator-zimna-zahrada-cena';
import { cenovaHladina } from '$lib/server/konfigurator-hladina';
import { parseZzCenaVstup } from '$lib/server/konfigurator-zimna-zahrada-vstup';
// #428: zdieľaná throttle predohra cenových `vypocet` akcií (rule-of-four) — nahrádza inline per-IP
// rate-limit (public-throttle + client-ip); tie modul `konfigurator-cena-akcia` importuje sám.
import { cenaThrottle } from '$lib/server/konfigurator-cena-akcia';

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
	// a cena sa opečiatkuje maticou zimnej záhrady (#408, gate `maCenovyZdroj('zimna-zahrada')`).
	dopyt: (event) => dopytAction(event, 'zimna-zahrada'),
	// #408: orientačná cena zvoleného configu. SvelteKit ZAKAZUJE miešať `default` s pomenovanými
	// akciami, preto je aj `dopyt` pomenovaná (sveltekit-actions.md). Vzor pergolovej/bazénovej
	// `vypocet` — per-IP throttle → parse → cena v hladine odvodenej SERVER-SIDE z používateľa.
	vypocet: async (event) => {
		// #428: zdieľaná throttle predohra; `prazdno` = prázdne dátové pole návratu zimnej záhrady.
		const throttled = cenaThrottle(event, { cena: null });
		if (throttled) return throttled;
		const { request, locals } = event;

		const parsed = parseZzCenaVstup(await request.formData());
		if ('error' in parsed) return fail(400, { cena: null, error: parsed.error });
		const { vstup } = parsed;
		// #318: hladina SERVER-SIDE z `locals.user` (prihlásený b2b → VO, inak MO). VO sa do MO/verejnej
		// odpovede NIKDY nedostane. `locals` je pri reálnom requeste vždy prítomné (`?.` obranné).
		const hladina = cenovaHladina(locals?.user ?? null);
		const cena = cenaPreZz(
			{
				hlbkaMm: vstup.hlbkaMm,
				sirkaMm: vstup.sirkaMm,
				zasklenie: vstup.zasklenie,
				model: vstup.model
			},
			hladina
		);
		return { cena, error: null };
	}
} satisfies Actions;
