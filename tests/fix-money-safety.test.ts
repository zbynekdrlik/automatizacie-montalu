// #85 (rozpočítanie fixu podľa posuvu) je ZMENA VÝHRADNE v src/lib/fix.ts +
// src/lib/server/fix-vstup.ts + src/routes/fix/** — nedotýka sa src/lib/server/compute.ts
// ani zasklenia odpisu. Tento test je BYTE-IDENTICKÝ canary: rovnaký vstup ako
// `tests/compute.test.ts` (Robust|2K 5000×2000, Excel ground truth), tá istá
// očakávaná hodnota — ak by táto PR omylom pohla čo i len jedno číslo v odpise,
// tento test to chytí bez ohľadu na to, čo sa zmenilo v FIX module.
import { describe, it, expect } from 'vitest';
import { buildCFG, computeFlat } from '../src/lib/server/compute';
import type { SysRow, RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

describe('Money safety (#85) — zasklenia odpis je byte-identický, FIX modul doň nezasahuje', () => {
	it('Robust|2K 5000×2000 — odpis aj sklo sedia PRESNE na Excel ground truth (nezmenené touto PR)', () => {
		const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);
		const r = computeFlat(cfg, 'Robust|2K', 5000, 2000, false);
		expect(r).not.toBeNull();
		const odpisByKod: Record<string, number> = {};
		r!.odpis.forEach((x) => (odpisByKod[x.kod] = x.metre));
		expect(odpisByKod).toEqual({ ZASP00014: 15, ZASP00002: 22.5, ZASP00010: 7.5 });
		expect(r!.sklo).toEqual({ sirka: 2374, vyska: 1795, pocet: 2 });
	});

	it('src/lib/fix.ts neimportuje nič z compute.ts / Money zapisovača (statická kontrola)', async () => {
		const fs = await import('node:fs');
		const src = fs.readFileSync(new URL('../src/lib/fix.ts', import.meta.url), 'utf8');
		expect(src).not.toMatch(/from ['"].*server\/compute['"]/);
		expect(src).not.toMatch(/writeOdpis|MONEY_LIVE/);
		// #380: „Fix z appky" (kresliaci režim) ostáva Money-CLEAN aj keď „Fix z cadu"
		// (Money lane) zdieľa /fix prefix — kresliaci engine NEIMPORTUJE Money most/vrstvu.
		expect(src).not.toMatch(/server\/fix-cad|server\/money|server\/pergola/);
	});

	it('kresliaci FIX výkres (FixVykres2D) ostáva Money-CLEAN (#380)', async () => {
		const fs = await import('node:fs');
		const src = fs.readFileSync(
			new URL('../src/lib/components/FixVykres2D.svelte', import.meta.url),
			'utf8'
		);
		expect(src).not.toMatch(/server\/fix-cad|server\/money|server\/pergola|writeOdpis|MONEY_LIVE/);
	});
});
