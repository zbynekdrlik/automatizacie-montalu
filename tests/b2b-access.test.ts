import { describe, it, expect } from 'vitest';
import { b2bRedirectTarget } from '../src/lib/server/b2b-access';

describe('b2bRedirectTarget (denylist)', () => {
	it('blokuje ne-zasklenia stránky', () => {
		for (const p of ['/', '/pergola', '/bazen', '/odpisy', '/problem', '/pouzivatelia', '/zasklenia/nastavenia'])
			expect(b2bRedirectTarget(p)).toBe('/zasklenia');
	});
	it('povolí zasklenia + assety + logout', () => {
		for (const p of ['/zasklenia', '/zasklenia/', '/logout', '/_app/immutable/x.js', '/favicon.png', '/health'])
			expect(b2bRedirectTarget(p)).toBeNull();
	});
	it('nastavenia pod zasklenia je blokované, ale samotné zasklenia nie', () => {
		expect(b2bRedirectTarget('/zasklenia/nastavenia')).toBe('/zasklenia');
		expect(b2bRedirectTarget('/zasklenia')).toBeNull();
	});
});
