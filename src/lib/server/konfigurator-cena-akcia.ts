// Zdieľaný „shell" cenových `vypocet` akcií verejných konfigurátorov (#428, rule-of-four:
// pergola/bazén/zimná záhrada/oplotenie). Extrahovaná je LEN identická, Money-NEUTRÁLNA throttle
// predohra (reálna klientska IP za Cloudflare → per-IP rate-limit → 429). Parse, výpočet ceny a tvar
// odpovede ostávajú per-produkt v jednotlivých route akciách (majú odlišné parsery, cenové funkcie a
// RÔZNE NÁVRATOVÉ tvary — pergola nesie `vysledok`, zimná záhrada nemá `cenyModely`), takže plný
// `vypocetAction(event, parse, cenaFn)` by buď menil tvary odpovedí (behaviorálna zmena) alebo pridal
// viac indirekcie než odstráni — viď design komentár #428.
import { fail } from '@sveltejs/kit';
import type { ActionFailure, RequestEvent } from '@sveltejs/kit';
import { allowRequest, KONF_WINDOW_MS } from './public-throttle';
import { clientIp } from './client-ip';

/**
 * Per-IP rate-limit predohra cenovej `vypocet` akcie. Vráti `null` keď je požiadavka POVOLENÁ
 * (volateľ pokračuje parse → cena), alebo `fail(429, …)` `ActionFailure` keď je zaškrtená (volateľ ho
 * rovno vráti). `prazdno` = prázdne dátové polia návratového tvaru DANEJ akcie (napr.
 * `{ cena: null, cenyModely: null }` / `{ vysledok: null }`), aby 429 telo `{ ...prazdno, error }`
 * malo rovnaký tvar (vrátane poradia kľúčov) ako úspešná/400 vetva tej istej akcie — byte-identické s
 * pôvodným inline kódom. Generický `P` DRŽÍ presný typ návratu (`ActionFailure<P & { error }>`), takže
 * generovaný route `./$types` `ActionData` nestratí tvar 429 vetvy (nekolabuje na `{}`).
 *
 * Reálna klientska IP za Cloudflare (#264) sa odvodí zdieľaným `clientIp(event)` (`client-ip.ts`).
 */
export function cenaThrottle<P extends Record<string, null>>(
	event: Pick<RequestEvent, 'request' | 'getClientAddress' | 'setHeaders'>,
	prazdno: P
): ActionFailure<P & { error: string }> | null {
	if (!allowRequest(clientIp(event))) {
		event.setHeaders({ 'retry-after': String(Math.ceil(KONF_WINDOW_MS / 1000)) });
		return fail(429, { ...prazdno, error: 'Priveľa požiadaviek. Skús to prosím o chvíľu.' });
	}
	return null;
}
