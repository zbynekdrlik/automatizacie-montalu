// #251 SEC-1: in-memory brute-force ochrana pre verejný /login (Money-zápisová
// brána). Per (username, ip) počítadlo neúspechov + exponenciálne oneskorenie +
// dočasný lockout. In-memory `Map`: nasadenie je JEDEN docker kontajner, takže
// Map je autoritatívna; reštart = reset počítadiel je auditom akceptovaný.
//
// NIE DB-backed (odmietnuté): vyžadovalo by migráciu (kolízia s lane #246, ktorá
// vlastní db.ts/migracie.ts), audit povedal „in-memory Map stačí", a DB zápis na
// každý neúspech by zosilnil samotný DoS vektor. NIE 3rd-party lib: bundling
// riziko pod Vite SSR + adapter-node (rovnaká úvaha ako #245 pri pino/winston)
// pre ~70 riadkov logiky — Node Map + Date.now to pokrýva presne.
//
// Kľúč je (username.toLowerCase(), ip): kopíruje case-insensitive login (COLLATE
// NOCASE) a NEuzamkne reálneho užívateľa globálne — útočník z cudzej IP zamkne
// len svoju vlastnú (username, ip) dvojicu, marekova IP ostáva voľná.
import { logger } from './log';

const log = logger('login-throttle');

/** Počet neúspechov v okne, ktorý spustí lockout. Prah 5 → reálny user znesie 1-4 preklepy. */
export const MAX_FAILURES = 5;
/** Dĺžka lockoutu po dosiahnutí prahu. */
export const LOCKOUT_MS = 15 * 60 * 1000; // 15 min
/** Fixné okno od PRVÉHO neúspechu streaku: nezamknuté počítadlo staršie než
 *  WINDOW_MS sa resetuje na nulu. Meria sa od `firstAt` (nie kĺzavé okno). */
export const WINDOW_MS = 15 * 60 * 1000; // 15 min
/** Základ exponenciálneho oneskorenia (1. neúspech). */
export const BASE_DELAY_MS = 200;
/** Strop exponenciálneho oneskorenia. */
export const MAX_DELAY_MS = 5000;
/** Strop počtu sledovaných (username, ip) záznamov — obrana proti memory DoS cez
 *  variáciu mena/IP (#251 review 🟡). Pri prekročení sa expirované zmetú a ak treba,
 *  vyhodia sa najstaršie podľa firstAt. Bežná prevádzka má pár záznamov. */
export const MAX_TRACKED = 10_000;

interface Entry {
	failures: number;
	firstAt: number; // začiatok aktuálneho streaku (pre WINDOW_MS reset)
	lockedUntil: number; // 0 = nezamknuté
}

const attempts = new Map<string, Entry>();

function key(username: string, ip: string | undefined): string {
	// JSON tuple = jednoznačný kľúč bez kolízie a bez binárneho oddeľovača
	// (meno je case-insensitive ako COLLATE NOCASE login; IP môže chýbať).
	return JSON.stringify([username.trim().toLowerCase(), ip ?? '-']);
}

/**
 * Vráti aktuálny (ešte platný) záznam, alebo undefined ak neexistuje / vypršal.
 * Zamknutý záznam sa drží až do konca lockoutu; po expirácii locku ALEBO po
 * uplynutí WINDOW_MS bez pokusu sa zabudne (čistý štít). Reset po locku je
 * EXPLICITNÝ (#251 review 🔵 #4) — nezávisí od zhody LOCKOUT_MS == WINDOW_MS.
 */
function getFresh(k: string, now: number): Entry | undefined {
	const e = attempts.get(k);
	if (!e) return undefined;
	if (e.lockedUntil > now) return e; // stále zamknuté → drž
	if (e.lockedUntil > 0) {
		// lock existoval a vypršal → čistý štít (od nuly)
		attempts.delete(k);
		return undefined;
	}
	if (now - e.firstAt > WINDOW_MS) {
		// nezamknutý streak starší než okno → zabudni
		attempts.delete(k);
		return undefined;
	}
	return e;
}

/**
 * Obmedz rast Map (#251 review 🟡): keď počet záznamov dosiahne MAX_TRACKED,
 * najprv zmeť expirované (lock vypršal, alebo nezamknuté po okne); ak je ich
 * stále priveľa, vyhoď najstaršie podľa firstAt tak, aby sa nový záznam zmestil.
 * Beží len pri veľkej Map (bežná prevádzka má pár záznamov) → O(n) je zriedkavé.
 */
function sweepIfNeeded(now: number): void {
	if (attempts.size < MAX_TRACKED) return;
	for (const [k, e] of attempts) {
		const lockExpired = e.lockedUntil > 0 && e.lockedUntil <= now;
		const windowExpired = e.lockedUntil <= now && now - e.firstAt > WINDOW_MS;
		if (lockExpired || windowExpired) attempts.delete(k);
	}
	if (attempts.size < MAX_TRACKED) return;
	// stále priveľa aktívnych záznamov → vyhoď najstaršie na strop
	const byAge = [...attempts.entries()].sort((a, b) => a[1].firstAt - b[1].firstAt);
	const toEvict = attempts.size - MAX_TRACKED + 1;
	for (let i = 0; i < toEvict && i < byAge.length; i++) attempts.delete(byAge[i][0]);
}

/** ms do konca lockoutu (0 = nie je zamknuté). Volať PRED pokusom o login. */
export function lockoutRemainingMs(
	username: string,
	ip: string | undefined,
	now: number = Date.now()
): number {
	const e = getFresh(key(username, ip), now);
	return e && e.lockedUntil > now ? e.lockedUntil - now : 0;
}

/** Exponenciálne oneskorenie (ms) pred spracovaním ďalšieho pokusu podľa počtu neúspechov. */
export function nextDelayMs(
	username: string,
	ip: string | undefined,
	now: number = Date.now()
): number {
	const e = getFresh(key(username, ip), now);
	const f = e ? e.failures : 0;
	if (f < 1) return 0;
	return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (f - 1));
}

/**
 * Zaznamenaj neúspešný pokus (volať LEN keď nie je zamknuté — akcia to overí
 * cez lockoutRemainingMs). Vráti true ak tým vznikol NOVÝ lockout (loguje WARN).
 */
export function recordFailure(
	username: string,
	ip: string | undefined,
	now: number = Date.now()
): boolean {
	const k = key(username, ip);
	// getFresh rieši reset po expirácii locku aj po uplynutí okna (jednotná logika)
	let e = getFresh(k, now);
	if (!e) {
		sweepIfNeeded(now); // obmedz rast Map pred pridaním nového záznamu
		e = { failures: 0, firstAt: now, lockedUntil: 0 };
		attempts.set(k, e);
	}
	e.failures += 1;
	if (e.failures >= MAX_FAILURES && e.lockedUntil <= now) {
		e.lockedUntil = now + LOCKOUT_MS;
		log.warn('login lockout', {
			username: username.trim(),
			ip,
			failures: e.failures,
			lockMs: LOCKOUT_MS
		});
		return true;
	}
	return false;
}

/** Úspešné prihlásenie — vyčisti počítadlo (username, ip), žiadny zvyškový lock. */
export function recordSuccess(username: string, ip: string | undefined): void {
	attempts.delete(key(username, ip));
}

/**
 * Aplikuj exponenciálne oneskorenie (reálny sleep) pred spracovaním pokusu —
 * spomaľuje brute-force. Pod testom (VITEST/NODE_ENV=test) je no-op ako log.ts,
 * aby testy reálne nespali (hodnotu oneskorenia overuje nextDelayMs unit test).
 */
export async function applyLoginBackoff(username: string, ip: string | undefined): Promise<void> {
	if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
	const ms = nextDelayMs(username, ip);
	if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/** LEN pre testy — vyčisti celý in-memory stav medzi test blokmi. */
export function _resetThrottle(): void {
	attempts.clear();
}
