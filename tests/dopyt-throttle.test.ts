// #277 — per-IP rate-limit pre verejný dopyt POST. Deterministický čas cez `now` param.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	allowDopyt,
	_resetDopytThrottle,
	MAX_PER_WINDOW,
	WINDOW_MS,
	MAX_TRACKED
} from '../src/lib/server/dopyt-throttle';

beforeEach(() => _resetDopytThrottle());

describe('allowDopyt', () => {
	it('povolí prvých MAX_PER_WINDOW, ďalší zamietne s retryAfter', () => {
		const ip = '1.2.3.4';
		const t0 = 1_000_000;
		for (let i = 0; i < MAX_PER_WINDOW; i++) {
			expect(allowDopyt(ip, t0).allowed).toBe(true);
		}
		const denied = allowDopyt(ip, t0 + 1000);
		expect(denied.allowed).toBe(false);
		expect(denied.retryAfterMs).toBe(WINDOW_MS - 1000);
	});

	it('po uplynutí okna sa počítadlo resetuje', () => {
		const ip = '5.6.7.8';
		const t0 = 2_000_000;
		for (let i = 0; i < MAX_PER_WINDOW; i++) allowDopyt(ip, t0);
		expect(allowDopyt(ip, t0 + 500).allowed).toBe(false);
		// nové okno
		expect(allowDopyt(ip, t0 + WINDOW_MS + 1).allowed).toBe(true);
	});

	it('rôzne IP majú nezávislé počítadlá', () => {
		const t0 = 3_000_000;
		for (let i = 0; i < MAX_PER_WINDOW; i++) allowDopyt('9.9.9.9', t0);
		expect(allowDopyt('9.9.9.9', t0).allowed).toBe(false);
		expect(allowDopyt('10.10.10.10', t0).allowed).toBe(true);
	});

	it('chýbajúca IP (undefined) použije bucket "-"', () => {
		const t0 = 4_000_000;
		for (let i = 0; i < MAX_PER_WINDOW; i++) expect(allowDopyt(undefined, t0).allowed).toBe(true);
		expect(allowDopyt(undefined, t0).allowed).toBe(false);
	});

	it('sweep pri prekročení MAX_TRACKED nezhodí a pustí ďalší', () => {
		const t0 = 5_000_000;
		for (let i = 0; i < MAX_TRACKED; i++) allowDopyt(`ip-${i}`, t0);
		// nová IP → sweep beží (všetky fresh → evikcia najstaršej), nesmie hádzať
		expect(allowDopyt('nova-ip', t0 + 1).allowed).toBe(true);
	});
});
