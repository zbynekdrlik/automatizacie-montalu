// Verejný zákaznícky konfigurátor pergoly (#275, fáza 1) — VEREJNÁ route (bez auth,
// pridaná do PUBLIC_PATHS v hooks.server.ts). Display-only, BEZ CIEN, BEZ Money kódov,
// BEZ nárezu. `load` posiela klientovi LEN názvy strešného skla + RAL farby (kód+názov) +
// číselné rozmedzia — NIKDY Money kód. `actions.vypocet`: per-IP rate-limit → parse →
// compute → súhrn (server-validované cez rozmedzia enginu). Žiadny import
// money/ceny/db/pergola (Money odpisová cesta) — Money-neutrálne (guard:
// tests/konfigurator-money-safety.test.ts). Parser žije v $lib/server/konfigurator-vstup.ts
// (nova-stranka pasca #1). Súčasť #280.
import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
// #329 časť 4: verejný konfigurátor ukazuje 6 zákazníckych KATEGÓRIÍ skla (nie 14 katalógových
// typov s hrúbkami). `KONF_SKLO_KATEGORIE` je client-safe (len katalógový `nazov` + label/popis/
// ikona, žiadny Money kód) — každá kategória sa mapuje na konkrétny katalógový `nazov`, ktorý sa
// POSTuje ďalej (parser + cena/PDF/dopyt/Odoo dostávajú nezmenený katalógový názov).
import { KONF_SKLO_KATEGORIE } from '$lib/konfigurator-sklo';
import { RAL_PALETA } from '$lib/vykres/ral';
import { KONF_RANGES, MODELY, konfiguruj } from '$lib/konfigurator';
import { parseKonfiguratorVstup } from '$lib/server/konfigurator-vstup';
// #279 Fáza C: orientačná PREDAJNÁ cena. #318: hladina-aware mappery (MO/VO) — MO pre verejného/
// interného návštevníka (byte-identické s #279), VO pre prihláseného veľkoobchodného (b2b). Server-only
// modul; seed sa do klientskeho bundle nikdy nedostane (guard konfigurator-money-safety).
import { cenaPreModel, cenyModelov } from '$lib/server/konfigurator-cena';
// #318: cenová hladina sa rozhoduje SERVER-SIDE z prihláseného používateľa (nikdy z klienta).
import { cenovaHladina } from '$lib/server/konfigurator-hladina';
import { allowRequest, KONF_WINDOW_MS } from '$lib/server/public-throttle';
import { resolveClientIp } from '$lib/server/client-ip';
// #277: verejný dopyt (kontaktný formulár → PDF ponuka BEZ CIEN). Táto route ju iba
// naimportuje a namountuje ako pomenovanú akciu `dopyt` — Money-NEUTRÁLNA (žiadny import
// money/pergola, zápis len do audit tabuľky `dopyt`, guard: tests/dopyt-money-safety.test.ts).
import { dopytAction, objednavkaAction } from '$lib/server/dopyt-action';

// GET (SSR render stránky) NIE JE rate-limitovaný — je lacný (statický katalóg + rozmedzia,
// žiadny výpočet) a rovnaká politika ako verejný /login dnes; drahý (výpočtový) je POST,
// ten je throttlovaný nižšie.
export const load: PageServerLoad = async () => {
	// LEN názvy skla (`.nazov`, NIKDY Money kód) + RAL možnosti (kód+názov, žiadny Money
	// údaj) + rozmedzia. Nič z toho neobsahuje cenu ani Money kód → žiadny únik.
	return {
		// #329 časť 4: 6 zákazníckych kategórií skla (label + popis + ikona + KONKRÉTNY katalógový
		// nazov), namiesto všetkých 14 katalógových typov. Money-neutrálne (žiadny Money kód).
		sklaKategorie: KONF_SKLO_KATEGORIE,
		farby: RAL_PALETA.map((r) => ({ kod: r.kod, nazov: r.nazov })),
		// #279 Fáza C: modely (kód + popis) na výber vo wizarde. LEN popisy, ŽIADNA cena —
		// cena je rozmerovo závislá a počíta ju akcia `vypocet` pri submite.
		modely: MODELY.map((m) => ({ kod: m.kod, popis: m.popis })),
		rozmedzia: KONF_RANGES
	};
};

export const actions = {
	// #277: verejný dopyt — validácia → rate-limit → honeypot → uloženie (audit) →
	// PDF ponuka s orientačnou cenou (#279 Fáza C, download-first). Money-neutrálne, žiadna
	// odpisová cesta (cena = orientačná MO predajná, nie Money nákupná).
	// #384: produkt je SERVER-AUTORITATÍVNY — táto (pergolová) podstránka viaže `'pergola'`, klient
	// ho nevie sfalšovať (žiadne dôveryhodné klientske pole). Produktové PR-y (#385–#390) mountujú
	// svoju akciu s vlastným kódom (`(e) => dopytAction(e, 'bazen')`).
	dopyt: (event) => dopytAction(event, 'pergola'),
	// #319: záväzná objednávka — kontakt + fakturačné údaje + súhlas → uloženie (je_objednavka=1) +
	// PDF špecifikácia + Odoo lead ako OPPORTUNITY. Money-neutrálne (ŽIADNA platobná brána, žiadny
	// odpis); zapečatí objednanú cenu vrátane MO/VO hladiny.
	objednavka: (event) => objednavkaAction(event, 'pergola'),
	// jednotný tvar návratu ({ vysledok, error }, jedno je vždy null) — čistý typ pre
	// use:enhance callback bez union-narrowingu (vzor /optimalizator).
	// SvelteKit ZAKAZUJE miešať `default` s pomenovanými akciami (actions.js:221 „When using
	// named actions, the default action cannot be used"). Keďže #277 pridal pomenovanú
	// `dopyt`, kalkulačka MUSÍ byť tiež pomenovaná — `vypocet` (formulár POSTuje `?/vypocet`).
	vypocet: async ({ request, getClientAddress, setHeaders, locals }) => {
		// per-IP rate-limit verejného endpointu — reálna klientska IP za Cloudflare (#264):
		// getClientAddress() (XFF_DEPTH=1) vracia CF edge IP, resolveClientIp z nej +
		// Cf-Connecting-Ip odvodí reálneho klienta (spoof-safe aj CF-down-safe).
		// getClientAddress() môže hodiť (ADDRESS_HEADER nastavený + hlavička chýba) — nesmie
		// zhodiť endpoint kvôli rate-limit kľúču.
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
				vysledok: null,
				error: 'Priveľa požiadaviek. Skús to prosím o chvíľu.'
			});
		}

		const parsed = parseKonfiguratorVstup(await request.formData());
		if ('error' in parsed)
			return fail(400, { vysledok: null, cena: null, cenyModely: null, error: parsed.error });
		const { vstup } = parsed;
		// #318: hladina sa určí SERVER-SIDE z `locals.user` — prihlásený b2b (veľkoobchod) → VO,
		// inak MO (neprihlásený/interný). `locals` je pri reálnom requeste vždy prítomné; `?.` je
		// obranné pre priame volania akcie (leak-guard test bez `locals` → MO). VO cena sa tak
		// dostane LEN oprávnenému účtu; verejná/MO odpoveď ostáva byte-identická s #279.
		const hladina = cenovaHladina(locals?.user ?? null);
		// orientačná cena zvoleného modelu + porovnanie všetkých 3 modelov (zrkadlo montalu.sk
		// „ceny modelov vedľa seba"), obe v odvodenej hladine. MO odpoveď NENESIE VO ani raw maticu.
		const cena = cenaPreModel(
			{ hlbkaMm: vstup.hlbka, sirkaMm: vstup.sirka, model: vstup.model },
			hladina
		);
		const cenyModely = cenyModelov(vstup.hlbka, vstup.sirka, hladina);
		return { vysledok: konfiguruj(vstup), cena, cenyModely, error: null };
	}
} satisfies Actions;
