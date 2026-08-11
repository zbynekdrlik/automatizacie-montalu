import { describe, it, expect } from 'vitest';
import { b2bRedirectTarget } from '../src/lib/server/b2b-access';

describe('b2bRedirectTarget (denylist)', () => {
	it('blokuje ne-zasklenia stránky', () => {
		for (const p of [
			'/',
			'/pergola',
			'/bazen',
			'/odpisy',
			'/problem',
			'/pouzivatelia',
			'/zasklenia/nastavenia'
		])
			expect(b2bRedirectTarget(p)).toBe('/zasklenia');
	});
	it('povolí zasklenia + assety + logout', () => {
		for (const p of [
			'/zasklenia',
			'/zasklenia/',
			'/logout',
			'/_app/immutable/x.js',
			'/favicon.png',
			'/health'
		])
			expect(b2bRedirectTarget(p)).toBeNull();
	});
	it('nastavenia pod zasklenia je blokované, ale samotné zasklenia nie', () => {
		expect(b2bRedirectTarget('/zasklenia/nastavenia')).toBe('/zasklenia');
		expect(b2bRedirectTarget('/zasklenia')).toBeNull();
	});

	// #144 — display-only pergola návrhový výkres (žiadny Money zápis) je pre b2b
	// výnimka POD inak zakázaným `/pergola` prefixom (Money odpis z CAD nárezu).
	it('#144: /pergola/navrh (a jej pod-cesty/akcie) je pre b2b povolené', () => {
		for (const p of ['/pergola/navrh', '/pergola/navrh/', '/pergola/navrh/cokolvek'])
			expect(b2bRedirectTarget(p)).toBeNull();
	});
	it('#144: samotné /pergola (Money odpis z CAD nárezu) ostáva zablokované', () => {
		expect(b2bRedirectTarget('/pergola')).toBe('/zasklenia');
		expect(b2bRedirectTarget('/pergola/')).toBe('/zasklenia');
	});
	it('#144: iná pod-cesta /pergola/* než navrh ostáva zablokovaná (výnimka je úzka)', () => {
		expect(b2bRedirectTarget('/pergola/odpis')).toBe('/zasklenia');
		// blízky, ale NIE zhodný názov (nie sub-cesta ani presná zhoda) sa nesmie
		// omylom chytiť do výnimky cez naivný startsWith('/pergola/navrh')
		expect(b2bRedirectTarget('/pergola/navrhovy-cokolvek')).toBe('/zasklenia');
	});
});
