// Verejný zákaznícky konfigurátor pergoly (#275, fáza 1) — VEREJNÁ route (bez auth,
// pridaná do PUBLIC_PATHS v hooks.server.ts). Display-only, BEZ CIEN, BEZ Money kódov,
// BEZ nárezu. `load` posiela klientovi LEN názvy strešného skla + RAL farby (kód+názov) +
// číselné rozmedzia — NIKDY Money kód. `actions.default`: per-IP rate-limit → parse →
// compute → súhrn (server-validované cez rozmedzia enginu). Žiadny import
// money/ceny/db/pergola (Money odpisová cesta) — Money-neutrálne (guard:
// tests/konfigurator-money-safety.test.ts). Parser žije v $lib/server/konfigurator-vstup.ts
// (nova-stranka pasca #1). Súčasť #280.
import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { SKLO_STRECHA_TYPY } from '$lib/sklo-strecha';
import { RAL_PALETA } from '$lib/vykres/ral';
import { KONF_RANGES, konfiguruj } from '$lib/konfigurator';
import { parseKonfiguratorVstup } from '$lib/server/konfigurator-vstup';
import { allowRequest, KONF_WINDOW_MS } from '$lib/server/public-throttle';
import { resolveClientIp } from '$lib/server/client-ip';

// GET (SSR render stránky) NIE JE rate-limitovaný — je lacný (statický katalóg + rozmedzia,
// žiadny výpočet) a rovnaká politika ako verejný /login dnes; drahý (výpočtový) je POST,
// ten je throttlovaný nižšie.
export const load: PageServerLoad = async () => {
	// LEN názvy skla (`.nazov`, NIKDY Money kód) + RAL možnosti (kód+názov, žiadny Money
	// údaj) + rozmedzia. Nič z toho neobsahuje cenu ani Money kód → žiadny únik.
	return {
		sklaTypy: SKLO_STRECHA_TYPY.map((t) => t.nazov),
		farby: RAL_PALETA.map((r) => ({ kod: r.kod, nazov: r.nazov })),
		rozmedzia: KONF_RANGES
	};
};

export const actions = {
	// jednotný tvar návratu ({ vysledok, error }, jedno je vždy null) — čistý typ pre
	// use:enhance callback bez union-narrowingu (vzor /optimalizator).
	default: async ({ request, getClientAddress, setHeaders }) => {
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
		if ('error' in parsed) return fail(400, { vysledok: null, error: parsed.error });
		return { vysledok: konfiguruj(parsed.vstup), error: null };
	}
} satisfies Actions;
