// #251 SEC-1: in-memory brute-force throttle pre /login. Per (username, ip)
// počítadlo neúspechov → 5 neúspechov / 15 min → 15 min lock; exponenciálne
// oneskorenie; úspech vyčistí počítadlo; kľúč (username, ip) NIE globálny.
// `now` je injektovateľný, takže expiráciu netreba reálne čakať.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	lockoutRemainingMs,
	nextDelayMs,
	recordFailure,
	recordSuccess,
	_resetThrottle,
	MAX_FAILURES,
	LOCKOUT_MS,
	WINDOW_MS
} from '../src/lib/server/login-throttle';

const U = 'marek';
const IP = '10.0.0.1';

describe('login-throttle (brute-force ochrana)', () => {
	beforeEach(() => _resetThrottle());

	it('MAX_FAILURES neúspechov zamkne, menej NIE', () => {
		const now = 1_000_000;
		for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(U, IP, now);
		// po 4 neúspechoch ešte nie je zamknuté (prah 5) — real user s 1-2 preklepmi prejde
		expect(lockoutRemainingMs(U, IP, now)).toBe(0);
		recordFailure(U, IP, now); // 5. neúspech → lock
		expect(lockoutRemainingMs(U, IP, now)).toBeGreaterThan(0);
		expect(lockoutRemainingMs(U, IP, now)).toBeLessThanOrEqual(LOCKOUT_MS);
	});

	it('lockout vyprší po LOCKOUT_MS a počítadlo sa resetuje', () => {
		const now = 5_000_000;
		for (let i = 0; i < MAX_FAILURES; i++) recordFailure(U, IP, now);
		expect(lockoutRemainingMs(U, IP, now)).toBeGreaterThan(0);
		// tesne pred expiráciou stále zamknuté
		expect(lockoutRemainingMs(U, IP, now + LOCKOUT_MS - 1)).toBeGreaterThan(0);
		// po expirácii voľné + čistý štít (0 neúspechov)
		expect(lockoutRemainingMs(U, IP, now + LOCKOUT_MS + 1)).toBe(0);
		expect(nextDelayMs(U, IP, now + LOCKOUT_MS + 1)).toBe(0);
	});

	it('kľúč je (username, ip) — iná IP toho istého mena sa NEuzamkne', () => {
		const now = 2_000_000;
		for (let i = 0; i < MAX_FAILURES; i++) recordFailure(U, IP, now);
		expect(lockoutRemainingMs(U, IP, now)).toBeGreaterThan(0);
		// reálny marek z inej IP musí prejsť (útočník z cudzej IP ho neuzamkne)
		expect(lockoutRemainingMs(U, '203.0.113.9', now)).toBe(0);
		// iné meno z tej istej IP tiež nie
		expect(lockoutRemainingMs('niekto-iny', IP, now)).toBe(0);
	});

	it('username je case-insensitive (kopíruje COLLATE NOCASE login)', () => {
		const now = 3_000_000;
		for (let i = 0; i < MAX_FAILURES; i++) recordFailure('Marek', IP, now);
		expect(lockoutRemainingMs('marek', IP, now)).toBeGreaterThan(0);
		expect(lockoutRemainingMs('MAREK', IP, now)).toBeGreaterThan(0);
	});

	it('úspešné prihlásenie vyčistí počítadlo (žiadny zvyškový lock)', () => {
		const now = 4_000_000;
		for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(U, IP, now);
		recordSuccess(U, IP);
		// po úspechu je stav čistý — ďalší neúspech začína od nuly, nie od 4
		expect(nextDelayMs(U, IP, now)).toBe(0);
		recordFailure(U, IP, now);
		expect(lockoutRemainingMs(U, IP, now)).toBe(0); // len 1 neúspech, nie 5
	});

	it('exponenciálne oneskorenie rastie s počtom neúspechov, ostáva ohraničené', () => {
		const now = 6_000_000;
		expect(nextDelayMs(U, IP, now)).toBe(0); // 0 neúspechov → bez oneskorenia
		recordFailure(U, IP, now);
		const d1 = nextDelayMs(U, IP, now);
		recordFailure(U, IP, now);
		const d2 = nextDelayMs(U, IP, now);
		expect(d1).toBeGreaterThan(0);
		expect(d2).toBeGreaterThan(d1); // exponenciálne rastie
		expect(d2).toBeLessThanOrEqual(5000); // strop
	});

	it('okno bez pokusov (WINDOW_MS) resetuje počítadlo pred lockom', () => {
		const now = 7_000_000;
		for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(U, IP, now);
		// 4 neúspechy, potom 15+ min ticho → streak vyprší
		const later = now + WINDOW_MS + 1;
		recordFailure(U, IP, later); // toto je 1. neúspech nového okna, nie 5.
		expect(lockoutRemainingMs(U, IP, later)).toBe(0);
	});
});
