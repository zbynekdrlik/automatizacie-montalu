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
import { SKLO_STRECHA_TYPY } from '$lib/sklo-strecha';
import { RAL_PALETA } from '$lib/vykres/ral';
import { KONF_RANGES, MODELY, konfiguruj } from '$lib/konfigurator';
import { parseKonfiguratorVstup } from '$lib/server/konfigurator-vstup';
// #279 Fáza C: orientačná PREDAJNÁ cena (LEN MO — VO sa v mapperi odstráni). Server-only
// modul; seed sa do klientskeho bundle nikdy nedostane (guard konfigurator-money-safety).
import { verejnaCenaPreModel, verejneCenyModelov } from '$lib/server/konfigurator-cena';
import { allowRequest, KONF_WINDOW_MS } from '$lib/server/public-throttle';
import { resolveClientIp } from '$lib/server/client-ip';
// #277: verejný dopyt (kontaktný formulár → PDF ponuka BEZ CIEN). Táto route ju iba
// naimportuje a namountuje ako pomenovanú akciu `dopyt` — Money-NEUTRÁLNA (žiadny import
// money/pergola, zápis len do audit tabuľky `dopyt`, guard: tests/dopyt-money-safety.test.ts).
import { dopytAction } from '$lib/server/dopyt-action';

// GET (SSR render stránky) NIE JE rate-limitovaný — je lacný (statický katalóg + rozmedzia,
// žiadny výpočet) a rovnaká politika ako verejný /login dnes; drahý (výpočtový) je POST,
// ten je throttlovaný nižšie.
export const load: PageServerLoad = async () => {
	// LEN názvy skla (`.nazov`, NIKDY Money kód) + RAL možnosti (kód+názov, žiadny Money
	// údaj) + rozmedzia. Nič z toho neobsahuje cenu ani Money kód → žiadny únik.
	return {
		sklaTypy: SKLO_STRECHA_TYPY.map((t) => t.nazov),
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
	dopyt: dopytAction,
	// jednotný tvar návratu ({ vysledok, error }, jedno je vždy null) — čistý typ pre
	// use:enhance callback bez union-narrowingu (vzor /optimalizator).
	// SvelteKit ZAKAZUJE miešať `default` s pomenovanými akciami (actions.js:221 „When using
	// named actions, the default action cannot be used"). Keďže #277 pridal pomenovanú
	// `dopyt`, kalkulačka MUSÍ byť tiež pomenovaná — `vypocet` (formulár POSTuje `?/vypocet`).
	vypocet: async ({ request, getClientAddress, setHeaders }) => {
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
		// #279 Fáza C: orientačná cena zvoleného modelu (LEN MO) + porovnanie všetkých 3
		// modelov (zrkadlo montalu.sk „ceny modelov vedľa seba"). VO sa v mapperi odstráni —
		// verejná odpoveď NIKDY nenesie veľkoobchodnú cenu ani raw maticu.
		const cena = verejnaCenaPreModel({
			hlbkaMm: vstup.hlbka,
			sirkaMm: vstup.sirka,
			model: vstup.model
		});
		const cenyModely = verejneCenyModelov(vstup.hlbka, vstup.sirka);
		return { vysledok: konfiguruj(vstup), cena, cenyModely, error: null };
	}
} satisfies Actions;
