// Zdieľaný „shell" cenových `vypocet` akcií verejných konfigurátorov (#428, rule-of-four:
// pergola/bazén/zimná záhrada/oplotenie). Extrahovaná je LEN identická, Money-NEUTRÁLNA throttle
// predohra (reálna klientska IP za Cloudflare → per-IP rate-limit → 429). Parse, výpočet ceny a tvar
// odpovede ostávajú per-produkt v jednotlivých route akciách (majú odlišné parsery, cenové funkcie a
// RÔZNE NÁVRATOVÉ tvary — pergola nesie `vysledok`, zimná záhrada nemá `cenyModely`), takže plný
// `vypocetAction(event, parse, cenaFn)` by buď menil tvary odpovedí (behaviorálna zmena) alebo pridal
// viac indirekcie než odstráni — viď design komentár #428.
import { fail } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { allowRequest, KONF_WINDOW_MS } from './public-throttle';
import { resolveClientIp } from './client-ip';

/**
 * Per-IP rate-limit predohra cenovej `vypocet` akcie. Vráti `null` keď je požiadavka POVOLENÁ
 * (volateľ pokračuje parse → cena), alebo `fail(429, …)` ActionFailure keď je zaškrtená (volateľ ho
 * rovno vráti). `prazdno` = prázdne dátové polia návratového tvaru DANEJ akcie (napr.
 * `{ cena: null, cenyModely: null }` / `{ vysledok: null }`), aby 429 telo `{ ...prazdno, error }`
 * malo rovnaký tvar (vrátane poradia kľúčov) ako úspešná/400 vetva tej istej akcie — byte-identické s
 * pôvodným inline kódom.
 *
 * Reálna klientska IP za Cloudflare (#264): `getClientAddress()` (XFF_DEPTH=1) vracia CF edge IP,
 * `resolveClientIp` z nej + `Cf-Connecting-Ip` odvodí reálneho klienta (spoof-safe aj CF-down-safe).
 * `getClientAddress()` môže hodiť (ADDRESS_HEADER nastavený + hlavička chýba) — nesmie zhodiť endpoint
 * kvôli rate-limit kľúču.
 */
export function cenaThrottle(
	event: Pick<RequestEvent, 'request' | 'getClientAddress' | 'setHeaders'>,
	prazdno: Record<string, null>
): ReturnType<typeof fail> | null {
	let edgeIp: string | undefined;
	try {
		edgeIp = event.getClientAddress();
	} catch {
		edgeIp = undefined;
	}
	const ip = resolveClientIp(edgeIp, event.request.headers.get('cf-connecting-ip'));
	if (!allowRequest(ip)) {
		event.setHeaders({ 'retry-after': String(Math.ceil(KONF_WINDOW_MS / 1000)) });
		return fail(429, { ...prazdno, error: 'Priveľa požiadaviek. Skús to prosím o chvíľu.' });
	}
	return null;
}
