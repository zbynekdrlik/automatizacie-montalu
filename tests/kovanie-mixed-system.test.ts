// #6413 bounce 🟡1: zmiešané systémy v jednej zákazke — farba kovania musí byť
// per-spec (defaultFarba systému, formulárová farba len pre systémy bez defaultu).
import { describe, it, expect } from 'vitest';
import { kovanieDoOdpisu } from '../src/lib/server/kovanie';
import { buildCFG, type PosuvSpec } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as never, seed.rez as never);

const DELUXE_SPEC: PosuvSpec = {
	sysStyl: 'Deluxe|2K',
	S: 3000,
	V: 2200,
	redukciaZero: false,
	skloHrubka: 10
};

const ROBUST_SPEC: PosuvSpec = {
	sysStyl: 'Robust|2K',
	S: 3000,
	V: 2200,
	redukciaZero: false,
	skloHrubka: 6
};

describe('kovanieDoOdpisu — zmiešané systémy #6413 bounce 🟡1', () => {
	it('Deluxe + Robust s formulárovou R7016: Deluxe dostane svoju R9006', () => {
		// formulárová farba R7016 (pre Robust), Deluxe má default R9006
		const r = kovanieDoOdpisu(cfg, [DELUXE_SPEC, ROBUST_SPEC], false, 'R7016');
		expect(r.err).toBeNull();
		// Deluxe stredová krytka L musí byť R9006 (ZASK202525), nie R7016 (ZASK202526)
		expect(r.polozky.some((p) => p.kod === 'ZASK202525')).toBe(true);
		expect(r.polozky.some((p) => p.kod === 'ZASK202526')).toBe(false);
	});

	it('Robust + Deluxe s formulárovou R9005: Deluxe dostane R9006, Robust R9005', () => {
		// Robust primárny + Deluxe sekundárny — formulárová R9005 nesmie pretiecť na Deluxe
		const r = kovanieDoOdpisu(cfg, [ROBUST_SPEC, DELUXE_SPEC], false, 'R9005');
		expect(r.err).toBeNull();
		// Deluxe stredová krytka L = R9006 (ZASK202525)
		expect(r.polozky.some((p) => p.kod === 'ZASK202525')).toBe(true);
	});

	it('Deluxe samotný bez farbaKovania: defaultFarba R9006 zabezpečí odpis', () => {
		// kovanieDoOdpisu s per-spec defaults: Deluxe dostane R9006 aj keď farbaKovania je undefined
		const r = kovanieDoOdpisu(cfg, [DELUXE_SPEC], false, undefined);
		expect(r.err).toBeNull();
		expect(r.polozky.some((p) => p.kod === 'ZASK202525')).toBe(true);
	});
});
