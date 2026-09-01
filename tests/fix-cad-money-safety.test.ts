import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { b2bRedirectTarget } from '../src/lib/server/b2b-access';
import { actions } from '../src/routes/fix/cad/+page.server';

// FIX z CADu (#380) je Money-WRITE most (nie čistý engine) — preto NIE JE v `CISTY_ENGINE`
// guarde `pergola-narez-money-safety.test.ts`. Namiesto toho asertujeme OPAK: most Money
// importuje ZÁMERNE (vzor `pergola-rezervacia.ts`), plus akčnú množinu a b2b hranicu.
const ROOT = path.resolve(__dirname, '..');
const zdroj = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('fix-cad — Money-write most (opak čistoty enginu)', () => {
	it('most fix-cad napája pergola engine na Money ZÁMERNE (modul=fix)', () => {
		const src = zdroj('src/lib/server/fix-cad.ts');
		expect(src).toMatch(/server\/money/);
		expect(src).toMatch(/server\/pergola/);
		// Dva samostatné matche namiesto /modul: 'fix'/: Stryker pri mutovaní
		// fix-cad.ts obalí string literál mutant-switchom, takže susedstvo
		// `modul:` a `'fix'` sa v inštrumentovanom zdroji rozpadne (dry run
		// mutation-diff by padol) — literál 'fix' aj kľúč modul: v ňom ostávajú.
		expect(src).toMatch(/modul:/);
		expect(src).toMatch(/'fix'/);
	});
});

describe('/fix/cad — akčná množina + b2b hranica', () => {
	it('má práve akcie odoslat/spocitat/upravit', () => {
		expect(Object.keys(actions).sort()).toEqual(['odoslat', 'spocitat', 'upravit']);
	});

	it('b2b sa na Money-write route /fix/cad nedostane (presmerovaný na /zasklenia)', () => {
		// /fix je už v B2B_FORBIDDEN_PREFIXES → prefix kryje aj /fix/cad
		expect(b2bRedirectTarget('/fix/cad')).toBe('/zasklenia');
		expect(b2bRedirectTarget('/fix')).toBe('/zasklenia');
	});
});
