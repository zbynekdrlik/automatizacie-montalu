// #445: Compute vectors for Štandard Drevo|4K — cross-checked against
// Patrik's Drevostavby 4K.xlsx template (S=5500, V=2132).
// These are NOT contractual Money vectors (no Money verification yet) — they
// verify that the cfg_seed formulas reproduce the Excel's material list.
import { describe, it, expect } from 'vitest';
import { buildCFG, computeFlat, validSys } from '../src/lib/server/compute';
import type { SysRow, RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

describe('Štandard Drevo|4K — cfg_seed formulas vs Excel template', () => {
	const SS = 'Štandard Drevo|4K';

	it('validSys recognises the system', () => {
		expect(validSys(cfg, SS)).not.toBeNull();
	});

	it('N = 4 panels', () => {
		expect(cfg[SS]!.N).toBe(4);
	});

	it('has exactly 2 sklo rows (S + V)', () => {
		expect(cfg[SS]!.sklo.s).toBeDefined();
		expect(cfg[SS]!.sklo.v).toBeDefined();
	});

	it('has 10 profil rez rows', () => {
		expect(cfg[SS]!.rez.length).toBe(10);
	});

	// Cross-check with S=5500, V=2132 (the template's sample dimensions)
	const S = 5500;
	const V = 2132;
	const result = computeFlat(cfg, SS, S, V, false);

	it('computeFlat returns a result', () => {
		expect(result).not.toBeNull();
	});

	// TS narrowing — throw ensures the 12 tests below always register
	if (!result) throw new Error('computeFlat returned null — tests cannot continue');

	it('sklo dimensions match Excel (priečka-split height)', () => {
		// Excel: šírka skla = 1323.5 → rounded to 1324 (whole mm)
		// Sklo šírka: (S-206)/4 = (5500-206)/4 = 5294/4 = 1323.5 → round = 1324
		expect(result.sklo.sirka).toBe(1324);
		// Excel: výška horného skla = 977.5 → rounded to 978
		// Sklo výška: 0.5*V - 88.5 = 1066 - 88.5 = 977.5 → round = 978
		expect(result.sklo.vyska).toBe(978);
	});

	// Profile cuts verification
	const byKod = (kod: string) => result.material.filter((m) => m.kod === kod);
	const odpisByKod = (kod: string) =>
		result.odpis.filter((o) => o.kod === kod).reduce((s, o) => s + o.metre, 0);

	it('ZASP00036 (horná koľajnica) — 1 ks × S=5500, 1 tyč 7500', () => {
		const rows = byKod('ZASP00036');
		expect(rows).toHaveLength(1);
		expect(rows[0]!.rezy).toEqual([{ rozmer: 5500, ks: 1 }]);
		expect(rows[0]!.tyce).toBe(1);
		expect(odpisByKod('ZASP00036')).toBe(7.5);
	});

	it('ZASP202432 (spodná koľajnica) — 1 ks × S=5500, 1 tyč 7500', () => {
		const rows = byKod('ZASP202432');
		expect(rows).toHaveLength(1);
		expect(rows[0]!.rezy).toEqual([{ rozmer: 5500, ks: 1 }]);
		expect(rows[0]!.tyce).toBe(1);
		expect(odpisByKod('ZASP202432')).toBe(7.5);
	});

	it('ZASP202415 (kladkový) — 8 ks × 1333mm, from 3600mm bars', () => {
		// Excel: rozmer = (S-170)/4 = 1332.5 → rounded to 1333 (with kerf 0)
		const rows = byKod('ZASP202415');
		expect(rows).toHaveLength(1);
		expect(rows[0]!.rezy).toEqual([{ rozmer: 1333, ks: 8 }]);
		expect(rows[0]!.barLen).toBe(3600);
	});

	it('ZASP00018 (krajová/rámová) — 2 ks × V-33=2099', () => {
		const rows = byKod('ZASP00018');
		expect(rows).toHaveLength(1);
		expect(rows[0]!.rezy).toEqual([{ rozmer: 2099, ks: 2 }]);
	});

	it('ZASP00024 (nos/stredový) — 6 ks × V-33=2099', () => {
		const rows = byKod('ZASP00024');
		expect(rows).toHaveLength(1);
		expect(rows[0]!.rezy).toEqual([{ rozmer: 2099, ks: 6 }]);
	});

	it('ZASP00021 (dorazová) — 2 ks × V-11=2121', () => {
		const rows = byKod('ZASP00021');
		expect(rows).toHaveLength(1);
		expect(rows[0]!.rezy).toEqual([{ rozmer: 2121, ks: 2 }]);
	});

	it('ZASP202439 (U-profily) — pooled 3 dimensions, all from 3600mm bars', () => {
		// Three rez entries with same code, pooled into one material row:
		// šírka U: 14 ks × (S-186)/4 = 1328.5 → 1329
		// výška U priečka: 12 ks × (V*0.5 - 115.5) = 950.5 → 951
		// výška U plný: 2 ks × (V - 161.4) = 1970.6 → 1971
		const rows = byKod('ZASP202439');
		expect(rows).toHaveLength(1);
		const m = rows[0]!;
		expect(m.barLen).toBe(3600);
		// Verify the 3 distinct cut dimensions are present
		const rezMap = new Map(m.rezy.map((r) => [r.rozmer, r.ks]));
		expect(rezMap.get(1329)).toBe(14); // šírka U
		expect(rezMap.get(951)).toBe(12); // výška U priečka
		expect(rezMap.get(1971)).toBe(2); // výška U plný
		// Total pieces: 14 + 12 + 2 = 28
		expect(m.rezy.reduce((s, r) => s + r.ks, 0)).toBe(28);
	});

	it('ZASP00113 (priečkový profil) — 3 ks × 1333mm, from 5800mm bars', () => {
		// Same dimension as kladkový: (S-170)/4 = 1332.5 → 1333
		const rows = byKod('ZASP00113');
		expect(rows).toHaveLength(1);
		expect(rows[0]!.rezy).toEqual([{ rozmer: 1333, ks: 3 }]);
		expect(rows[0]!.barLen).toBe(5800);
	});

	it('all cuts are 90° (rovný rez) — Standard system rule', () => {
		for (const m of result.material) {
			expect(m.sikmyRez).toBe(false);
		}
	});

	it('odpis has correct codes (ZASP only, no 11016/K-M)', () => {
		const codes = result.odpis.map((o) => o.kod);
		expect(codes.every((c) => c.startsWith('ZASP'))).toBe(true);
	});
});
