import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-b2blim-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'l.db');
await import('../src/lib/server/db'); // triggers migrate + seed (all systems/styles)
const { loadCfg } = await import('../src/lib/server/db');
const { checkB2BWidth, checkB2BHeight, B2B_LIMITS } = await import('../src/lib/server/b2b-limits');
const cfg = loadCfg();

describe('checkB2BWidth', () => {
	it('Deluxe 2K@3000 → blok, poradí 3K', () => {
		const err = checkB2BWidth(cfg, 'Deluxe|2K', 3000);
		expect(err).toBeTruthy();
		expect(err).toContain('3K');
	});
	it('Deluxe 3K@3000 → OK (1000 = max)', () => {
		expect(checkB2BWidth(cfg, 'Deluxe|3K', 3000)).toBeNull();
	});
	it('Deluxe 2K@1800 → OK (900 v rozsahu)', () => {
		expect(checkB2BWidth(cfg, 'Deluxe|2K', 1800)).toBeNull();
	});
	it('dvojité: 2x2K@6000 Deluxe → blok, poradí 2x3K (rovnaká rodina)', () => {
		const err = checkB2BWidth(cfg, 'Deluxe|2x2K', 6000);
		expect(err).toBeTruthy();
		expect(err).toContain('2x3K');
	});
	it('mŕtva zóna: Deluxe 2K@3100 → blok bez fungujúceho štýlu (3K=1033>max, 4K=775<min)', () => {
		const err = checkB2BWidth(cfg, 'Deluxe|2K', 3100);
		expect(err).toBeTruthy();
		expect(err).toContain('Uprav šírku');
	});
	it('Robust širší limit: 2K@2800 → OK (1400 ≤ 1500)', () => {
		expect(checkB2BWidth(cfg, 'Robust|2K', 2800)).toBeNull();
	});
	it('príliš úzke: Deluxe 3K@2000 → blok, poradí menej polí (2K = 1000 OK)', () => {
		const err = checkB2BWidth(cfg, 'Deluxe|3K', 2000);
		expect(err).toBeTruthy();
		expect(err).toContain('2K');
	});
	it('neznámy systém (mimo B2B_LIMITS) → fail-open, nelimituje', () => {
		expect(checkB2BWidth(cfg, 'Nieco|2K', 3000)).toBeNull();
	});
	it('chýbajúca cfg položka pre sysStyl → fail-open, nelimituje', () => {
		expect(checkB2BWidth(cfg, 'Robust|Neexistuje', 3000)).toBeNull();
	});
});

describe('checkB2BHeight', () => {
	it('Deluxe 2600 → warning (nad 2500)', () => {
		expect(checkB2BHeight('Deluxe|2K', 2600)).toContain('BEZ ZÁRUKY');
	});
	it('Deluxe 2500 → OK (hranica)', () => {
		expect(checkB2BHeight('Deluxe|2K', 2500)).toBeNull();
	});
	it('Robust 2600 → OK (Robust má 2600)', () => {
		expect(checkB2BHeight('Robust|2K', 2600)).toBeNull();
	});
	it('Robust 2700 → warning', () => {
		expect(checkB2BHeight('Robust|2K', 2700)).toContain('BEZ ZÁRUKY');
	});
	it('neznámy systém (mimo B2B_LIMITS) → fail-open, nelimituje', () => {
		expect(checkB2BHeight('Nieco|2K', 3000)).toBeNull();
	});
});

describe('B2B_LIMITS', () => {
	it('má tri systémy so správnymi hodnotami', () => {
		expect(B2B_LIMITS.Robust.maxHeight).toBe(2600);
		expect(B2B_LIMITS.Deluxe.maxPanel).toBe(1000);
		expect(B2B_LIMITS.Slide.maxPanel).toBe(1300);
	});
});

describe('B2B_LIMITS pokrytie systémov (drift guard)', () => {
	// checkB2BWidth/checkB2BHeight fail-open (return null = nelimituj) pre systém
	// mimo B2B_LIMITS. Ak sa osadí 4. systém bez pridania limitu, b2b dostane
	// NEOBMEDZENÉ rozmery na ňom — tento test to odchytí PRED nasadením.
	it('každý osadený (seeded) systém má B2B_LIMITS položku', () => {
		const seededSystems = [...new Set(Object.keys(cfg).map((k) => k.split('|')[0]))];
		expect(seededSystems.length).toBeGreaterThan(0); // self-check: nesmie kontrolovať prázdnu množinu
		for (const system of seededSystems) {
			expect(Object.keys(B2B_LIMITS)).toContain(system);
		}
	});
});
