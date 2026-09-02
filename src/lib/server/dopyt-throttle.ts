// Per-IP rate-limit pre verejný dopyt POST (#277). Rovnaká disciplína ako `login-throttle`:
// in-memory `Map` (nasadenie = JEDEN docker kontajner, Map je autoritatívna; reštart = reset
// je akceptovaný), ŽIADNA 3rd-party lib (bundling riziko pod Vite SSR + adapter-node pre ~50
// riadkov logiky), MAX_TRACKED sweep proti memory DoS cez rotáciu IP. Kľúč = klientska IP
// (rozlíšená `resolveClientIp` volajúcim — CF-aware). Fixné okno od prvého pokusu.
import { logger } from './log';

const log = logger('dopyt-throttle');

/** Default max. odoslaní z jednej IP v okne. Reálny zákazník odošle 1–3×; 8 znesie aj preklepy/opravy. */
export const DEFAULT_MAX_PER_WINDOW = 8;

/**
 * Rozparsuje limit z env (`DOPYT_MAX_PER_WINDOW`). PROD ho NIKDY nenastavuje → default 8.
 * Vyčlenené ako pure helper kvôli testovateľnosti — `MAX_PER_WINDOW` sa číta pri MODULE-LOADE,
 * takže env sa v ňom v unit teste ťažko prepisuje; helper otestuje samotné parsovanie.
 * Nevalidná/prázdna/nulová hodnota → default (rovnaká `Number(...) || X` disciplína ako inde v repe).
 */
export function resolveMaxPerWindow(raw: string | undefined): number {
	return Number(raw) || DEFAULT_MAX_PER_WINDOW;
}

/**
 * Max. odoslaní z jednej IP v okne. Env-konfigurovateľné (`DOPYT_MAX_PER_WINDOW`): PROD nikdy
 * nenastavuje → 8. E2E preview ho zvýši, lebo CELÁ suite odosiela dopyty z JEDNEJ IP (127.0.0.1)
 * v JEDNOM preview procese — per-IP okno (10 min > ~8 min beh) by inak nazbieralo naprieč
 * NESÚVISIACIMI spec-mi a 9. dopyt (posledný produkt abecedne) by dostal 429 (žiadny PDF →
 * download timeout). Samotné throttlovanie je pokryté `tests/dopyt-throttle.test.ts` (unit).
 */
export const MAX_PER_WINDOW = resolveMaxPerWindow(process.env.DOPYT_MAX_PER_WINDOW);
/** Fixné okno od PRVÉHO pokusu — po ňom sa počítadlo resetuje. */
export const WINDOW_MS = 10 * 60 * 1000; // 10 min
/** Strop sledovaných IP (obrana proti memory DoS cez rotáciu IP), ako `login-throttle`. */
export const MAX_TRACKED = 10_000;

interface Entry {
	count: number;
	firstAt: number;
}

const hits = new Map<string, Entry>();

function key(ip: string | undefined): string {
	return ip ?? '-';
}

/** Obmedz rast Map: zmeť expirované okná; ak stále priveľa, vyhoď najstaršie podľa firstAt. */
function sweepIfNeeded(now: number): void {
	if (hits.size < MAX_TRACKED) return;
	for (const [k, e] of hits) {
		if (now - e.firstAt > WINDOW_MS) hits.delete(k);
	}
	if (hits.size < MAX_TRACKED) return;
	const byAge = [...hits.entries()].sort((a, b) => a[1].firstAt - b[1].firstAt);
	const toEvict = hits.size - MAX_TRACKED + 1;
	for (const [kOld] of byAge.slice(0, toEvict)) hits.delete(kOld);
}

/**
 * Zaznamenaj a vyhodnoť pokus o odoslanie dopytu z danej IP. Vráti či je povolený a (ak nie)
 * koľko ms do konca okna. Volať RAZ za POST — počítadlo sa inkrementuje len keď je povolené,
 * takže zablokovaná IP neposúva okno donekonečna.
 */
export function allowDopyt(
	ip: string | undefined,
	now: number = Date.now()
): { allowed: boolean; retryAfterMs: number } {
	const k = key(ip);
	let e = hits.get(k);
	if (e && now - e.firstAt > WINDOW_MS) {
		hits.delete(k);
		e = undefined;
	}
	if (!e) {
		sweepIfNeeded(now);
		e = { count: 0, firstAt: now };
		hits.set(k, e);
	}
	if (e.count >= MAX_PER_WINDOW) {
		const retryAfterMs = Math.max(0, e.firstAt + WINDOW_MS - now);
		log.warn('dopyt rate-limit', { ip, count: e.count, retryAfterMs });
		return { allowed: false, retryAfterMs };
	}
	e.count += 1;
	return { allowed: true, retryAfterMs: 0 };
}

/** LEN pre testy — vyčisti in-memory stav medzi test blokmi. */
export function _resetDopytThrottle(): void {
	hits.clear();
}
