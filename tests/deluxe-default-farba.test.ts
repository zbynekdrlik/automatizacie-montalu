// #6413 att 14955: Deluxe má pevnú farbu kovania „nerezová mušľa" (R9006) —
// RAL dropdown sa nezobrazuje, server používa defaultnú farbu automaticky.
import { describe, it, expect } from 'vitest';
import { defaultFarba } from '../src/lib/server/komponenty-cfg';
import { kovanieDoOdpisu } from '../src/lib/server/kovanie';
import { buildCFG, type PosuvSpec } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as never, seed.rez as never);

describe('defaultFarba — #6413 att 14955 (Deluxe = nerezová mušľa)', () => {
	it('Deluxe má defaultnú farbu R9006', () => {
		expect(defaultFarba('Deluxe')).toBe('R9006');
	});

	it('Robust nemá defaultnú farbu (operátor vyberá)', () => {
		expect(defaultFarba('Robust')).toBeUndefined();
	});

	it('Slide nemá defaultnú farbu', () => {
		expect(defaultFarba('Slide')).toBeUndefined();
	});

	it('Štandard nemá defaultnú farbu', () => {
		expect(defaultFarba('Štandard')).toBeUndefined();
	});

	it('Deluxe odpis s default farbou R9006 funguje bez chyby', () => {
		const spec: PosuvSpec = {
			sysStyl: 'Deluxe|2K',
			S: 3000,
			V: 2200,
			redukciaZero: false,
			skloHrubka: 10
		};
		const farba = defaultFarba('Deluxe');
		expect(farba).toBe('R9006');
		const r = kovanieDoOdpisu(cfg, [spec], false, farba);
		expect(r.err).toBeNull();
		// R9006 krytky sú v odpise (nie R7016)
		expect(r.polozky.some((p) => p.kod === 'ZASK202525')).toBe(true); // stredová L R9006
		expect(r.polozky.some((p) => p.kod === 'ZASK202526')).toBe(false); // stredová L R7016
	});

	it('Deluxe odpis s farba=undefined vyhlási chybu (defense in depth)', () => {
		const spec: PosuvSpec = {
			sysStyl: 'Deluxe|2K',
			S: 3000,
			V: 2200,
			redukciaZero: false,
			skloHrubka: 10
		};
		// Bez farby engine MUSÍ vyhlásit chybu (farbo-závislé položky nemajú variant)
		const r = kovanieDoOdpisu(cfg, [spec], false, undefined);
		expect(r.err).not.toBeNull();
	});
});
