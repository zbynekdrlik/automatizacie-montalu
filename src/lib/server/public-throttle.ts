// #275: generický per-IP rate limiter pre VEREJNÉ (bez-auth) endpointy. In-memory
// fixed-window počítadlo na IP — nasadenie je JEDEN docker kontajner (Map je
// autoritatívna; reštart = reset počítadiel je akceptovaný, rovnako ako login-throttle
// #251). Žiadna 3rd-party lib (bundling riziko pod Vite SSR + adapter-node pre pár
// desiatok riadkov — rovnaká úvaha ako #245/#251/#264).
//
// NIE lockout (to je login brute-force ochrana, #251) — verejná kalkulačka len bráni
// hltaniu endpointu: max `KONF_MAX_REQ` požiadaviek na IP za `KONF_WINDOW_MS`; nad limit
// vráti false → akcia odpovie friendly chybou. Kľúč je reálna klientska IP (za Cloudflare
// odvodená cez `resolveClientIp`, #264) — nie meno (verejný endpoint nemá používateľa).
import { logger } from './log';

const log = logger('public-throttle');

/** Max požiadaviek na jednu IP za okno. */
export const KONF_MAX_REQ = 40;
/** Dĺžka fixného okna. */
export const KONF_WINDOW_MS = 60_000; // 1 min
/** Strop sledovaných IP záznamov — obrana proti memory DoS cez rotáciu IP (ako #251). */
export const KONF_MAX_TRACKED = 20_000;

interface Bucket {
	count: number;
	windowStart: number;
}

const buckets = new Map<string, Bucket>();

/** Obmedz rast Map: pri dosiahnutí stropu zmeť okná, ktoré už vypršali; ak treba, vyhoď
 *  najstaršie podľa windowStart. Beží len pri veľkej Map (bežná prevádzka má pár IP). */
function sweep(now: number): void {
	if (buckets.size < KONF_MAX_TRACKED) return;
	for (const [k, b] of buckets) if (now - b.windowStart >= KONF_WINDOW_MS) buckets.delete(k);
	if (buckets.size < KONF_MAX_TRACKED) return;
	const byAge = [...buckets.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
	const toEvict = buckets.size - KONF_MAX_TRACKED + 1;
	for (const [kOld] of byAge.slice(0, toEvict)) buckets.delete(kOld);
}

/**
 * Zaznamenaj požiadavku z `ip`; vráť true ak je POVOLENÁ (pod limitom), false ak limit
 * v aktuálnom okne prekročený. `ip` undefined → jeden zdieľaný bucket „-" (bez IP sa
 * jednotlivci nedajú rozlíšiť — konzervatívne zdieľajú limit).
 */
export function allowRequest(ip: string | undefined, now: number = Date.now()): boolean {
	const key = ip ?? '-';
	let b = buckets.get(key);
	if (!b || now - b.windowStart >= KONF_WINDOW_MS) {
		if (!b) sweep(now); // nový kľúč → skontroluj strop pred pridaním
		b = { count: 0, windowStart: now };
		buckets.set(key, b);
	}
	b.count += 1;
	if (b.count > KONF_MAX_REQ) {
		// zaloguj len raz na okno (pri prvom prekročení), nie na každú blokovanú požiadavku
		if (b.count === KONF_MAX_REQ + 1)
			log.warn('verejný rate-limit prekročený', { ip, limit: KONF_MAX_REQ });
		return false;
	}
	return true;
}

/** LEN pre testy — vyčisti celý in-memory stav medzi test blokmi. */
export function _resetPublicThrottle(): void {
	buckets.clear();
}
