import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { b2bRedirectTarget } from '../src/lib/server/b2b-access';
import { actions } from '../src/routes/fix/cad/+page.server';

// FIX z CADu (#380) je Money-WRITE most (nie čistý engine) — preto NIE JE v `CISTY_ENGINE`
// guarde `pergola-narez-money-safety.test.ts`. Namiesto toho asertujeme OPAK: most Money
// importuje ZÁMERNE, plus akčnú množinu a b2b hranicu.
// #393: zdieľaný CAD→Money tok sa presunul do `cad-odpis.ts` (Money+pergola wiring TAM),
// FIX identita (modul='fix') ostáva vo `fix-cad.ts` adaptéri — guard stráži OBE nové miesta.
const ROOT = path.resolve(__dirname, '..');
const zdroj = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('cad-odpis — zdieľaný Money-write most (reuse pergola enginu, #393)', () => {
	it('most cad-odpis napája pergola engine na Money ZÁMERNE', () => {
		const src = zdroj('src/lib/server/cad-odpis.ts');
		expect(src).toMatch(/server\/money/);
		expect(src).toMatch(/server\/pergola/);
	});
});

describe('fix-cad — FIX identita (modul=fix) nad zdieľaným mostom (#380/#393)', () => {
	it('fix-cad stavia na zdieľanom cad-odpis moste a nesie FIX identitu (modul=fix)', () => {
		const src = zdroj('src/lib/server/fix-cad.ts');
		expect(src).toMatch(/server\/cad-odpis/);
		// Dva samostatné matche namiesto /modul: 'fix'/: Stryker pri mutovaní fix-cad.ts
		// obalí string literál mutant-switchom, takže susedstvo `modul:` a `'fix'` sa v
		// inštrumentovanom zdroji rozpadne (dry run mutation-diff by padol) — literál 'fix'
		// aj kľúč modul: v ňom ostávajú samostatne.
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
