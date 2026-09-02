// Verejný zákaznícky konfigurátor hliníkového oplotenia a brán (#388, etapa 5 jednotného rámu #384;
// #410 orientačná cena) — VEREJNÁ route (bez auth; `/konfigurator` prefix je v PUBLIC_PATHS →
// `/konfigurator/oplotenie` prechádza cez `startsWith`). `load` posiela klientovi LEN client-safe
// katalóg z `konfigurator-oplotenie` (typy/modely/rozmedzia) + RAL farby — žiadny Money kód, žiadna
// cena (cena je až v akcii `vypocet`). `actions`: `vypocet` = orientačná MO cena (#410, server-počítaná
// oplotenie maticou); `dopyt` = verejný kontaktný formulár → PDF špecifikácia s orientačnou cenou +
// Odoo lead, produkt SERVER-AUTORITATÍVNY (`'oplotenie'`, klient ho nefalšuje). Money-neutrálne (žiadny
// odpis/`/data` zápis; guard: tests/konfigurator-money-safety.test.ts + tests/dopyt-money-safety.test.ts).
import { fail } from '@sveltejs/kit';
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
// #410: orientačná PREDAJNÁ cena — server-only oplotenie cenový modul (seed sa do klientskeho bundle
// nikdy nedostane, guard konfigurator-money-safety). Hladina (MO/VO) rozhoduje SERVER, nikdy klient.
import {
	cenaPreModelOplotenie,
	cenyModelovOplotenie
} from '$lib/server/konfigurator-oplotenie-cena';
import { cenovaHladina } from '$lib/server/konfigurator-hladina';
import { parseOplotenieCenaVstup } from '$lib/server/konfigurator-oplotenie-vstup';
import { allowRequest, KONF_WINDOW_MS } from '$lib/server/public-throttle';
import { resolveClientIp } from '$lib/server/client-ip';

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
	// sfalšovať (žiadne dôveryhodné klientske pole). PDF titul + názov Odoo leadu sú tak produkt-aware
	// a cena sa opečiatkuje oplotenie maticou (#410, gate `maCenovyZdroj('oplotenie')`).
	dopyt: (event) => dopytAction(event, 'oplotenie'),
	// #410: orientačná cena zvoleného modelu + „ceny modelov vedľa seba". SvelteKit ZAKAZUJE miešať
	// `default` s pomenovanými akciami, preto je aj `dopyt` pomenovaná (sveltekit-actions.md). Vzor
	// bazénovej `vypocet` — per-IP throttle → parse → cena v hladine odvodenej SERVER-SIDE z používateľa.
	vypocet: async ({ request, getClientAddress, setHeaders, locals }) => {
		let edgeIp: string | undefined;
		try {
			edgeIp = getClientAddress();
		} catch {
			edgeIp = undefined;
		}
		const ip = resolveClientIp(edgeIp, request.headers.get('cf-connecting-ip'));
		if (!allowRequest(ip)) {
			setHeaders({ 'retry-after': String(Math.ceil(KONF_WINDOW_MS / 1000)) });
			return fail(429, {
				cena: null,
				cenyModely: null,
				error: 'Priveľa požiadaviek. Skús to prosím o chvíľu.'
			});
		}

		const parsed = parseOplotenieCenaVstup(await request.formData());
		if ('error' in parsed) return fail(400, { cena: null, cenyModely: null, error: parsed.error });
		const { vstup } = parsed;
		// #318: hladina SERVER-SIDE z `locals.user` (prihlásený b2b → VO, inak MO). VO sa do MO/verejnej
		// odpovede NIKDY nedostane. `locals` je pri reálnom requeste vždy prítomné (`?.` obranné).
		const hladina = cenovaHladina(locals?.user ?? null);
		const cena = cenaPreModelOplotenie(
			{
				typ: vstup.typ,
				model: vstup.model,
				vyskaMm: vstup.vyskaMm,
				sirkaMm: vstup.sirkaMm,
				pocet: vstup.pocet
			},
			hladina
		);
		const cenyModely = cenyModelovOplotenie(
			vstup.typ,
			vstup.vyskaMm,
			vstup.sirkaMm,
			vstup.pocet,
			hladina
		);
		return { cena, cenyModely, error: null };
	}
} satisfies Actions;
