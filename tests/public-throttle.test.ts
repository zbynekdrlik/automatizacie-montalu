// Verejný per-IP rate limiter (#275) — obmedzuje hltanie verejného endpointu. Overuje
// fixné okno na IP, izoláciu medzi IP, roll-over okna a memory-strop cez zdieľaný bucket.
import { describe, it, expect, beforeEach } from 'vitest';
import {
	allowRequest,
	_resetPublicThrottle,
	KONF_MAX_REQ,
	KONF_WINDOW_MS,
	KONF_MAX_TRACKED
} from '../src/lib/server/public-throttle';

beforeEach(() => _resetPublicThrottle());

describe('allowRequest — fixné okno na IP', () => {
	it('povolí presne KONF_MAX_REQ požiadaviek, ďalšie odmietne', () => {
		const now = 1_000_000;
		for (let i = 0; i < KONF_MAX_REQ; i++) {
			expect(allowRequest('1.2.3.4', now)).toBe(true);
		}
		expect(allowRequest('1.2.3.4', now)).toBe(false);
		expect(allowRequest('1.2.3.4', now)).toBe(false);
	});

	it('po uplynutí okna sa počítadlo resetuje', () => {
		const t0 = 2_000_000;
		for (let i = 0; i < KONF_MAX_REQ; i++) allowRequest('9.9.9.9', t0);
		expect(allowRequest('9.9.9.9', t0)).toBe(false);
		// nové okno → znova povolené
		expect(allowRequest('9.9.9.9', t0 + KONF_WINDOW_MS)).toBe(true);
	});

	it('rôzne IP majú nezávislé počítadlá', () => {
		const now = 3_000_000;
		for (let i = 0; i < KONF_MAX_REQ; i++) allowRequest('1.1.1.1', now);
		expect(allowRequest('1.1.1.1', now)).toBe(false);
		// iná IP nie je ovplyvnená
		expect(allowRequest('2.2.2.2', now)).toBe(true);
	});

	it('chýbajúca IP (undefined) zdieľa jeden konzervatívny bucket', () => {
		const now = 4_000_000;
		for (let i = 0; i < KONF_MAX_REQ; i++) expect(allowRequest(undefined, now)).toBe(true);
		expect(allowRequest(undefined, now)).toBe(false);
	});

	it('IPv6: rotujúce /128 adresy v tej istej /64 zdieľajú jedno okno (žiadny bypass)', () => {
		const now = 6_500_000;
		// 40 požiadaviek z rôznych /128 v ROVNAKEJ /64 (2001:db8:1:2::/64)
		for (let i = 0; i < KONF_MAX_REQ; i++) {
			expect(allowRequest(`2001:db8:1:2::${(i + 1).toString(16)}`, now)).toBe(true);
		}
		// ďalšia adresa v tej istej /64 (aj keď „nová" /128) je už zablokovaná
		expect(allowRequest('2001:db8:1:2:ffff::9', now)).toBe(false);
		// adresa v INEJ /64 má vlastné okno
		expect(allowRequest('2001:db8:1:3::1', now)).toBe(true);
	});

	it('memory-strop: po prekročení KONF_MAX_TRACKED zmetie expirované okná (bez OOM)', () => {
		// naplň nad strop unikátnymi (starými) IP, potom nová IP v novom okne → sweep zmetie
		// expirované a nová požiadavka je stále obslúžená (funkčnosť ostáva)
		const t0 = 5_000_000;
		for (let i = 0; i <= KONF_MAX_TRACKED; i++) allowRequest(`10.0.${i >> 8}.${i & 255}`, t0);
		// nové okno → getFresh-štýl expirácia + sweep pri pridaní ďalšej novej IP
		expect(allowRequest('203.0.113.99', t0 + KONF_WINDOW_MS + 1)).toBe(true);
	});
});
