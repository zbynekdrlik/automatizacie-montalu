// #431 bod 1: Deluxe má PREDVOLENÚ farbu kovania R9006 (nerezová mušľa) —
// RAL select je VIDITEĽNÝ (krytky = 2 farebné Money kódy), R9006 je len predvoľba.
// Server defense: ak formulár farbu nepošle, engine použije predvolenú.
import { describe, it, expect } from 'vitest';
import { predvolenaFarba } from '../src/lib/server/komponenty-cfg';
import { kovanieDoOdpisu } from '../src/lib/server/kovanie';
import { buildCFG, type PosuvSpec } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as never, seed.rez as never);

describe('predvolenaFarba — #431 bod 1 (Deluxe = nerezová mušľa, krytky = 2 farby)', () => {
	it('Deluxe má predvolenú farbu R9006', () => {
		expect(predvolenaFarba('Deluxe')).toBe('R9006');
	});

	it('Robust nemá predvolenú farbu (operátor vyberá)', () => {
		expect(predvolenaFarba('Robust')).toBeUndefined();
	});

	it('Slide nemá predvolenú farbu', () => {
		expect(predvolenaFarba('Slide')).toBeUndefined();
	});

	it('Štandard nemá predvolenú farbu', () => {
		expect(predvolenaFarba('Štandard')).toBeUndefined();
	});

	it('Deluxe odpis s predvolenou farbou R9006 funguje bez chyby', () => {
		const spec: PosuvSpec = {
			sysStyl: 'Deluxe|2K',
			S: 3000,
			V: 2200,
			redukciaZero: false,
			skloHrubka: 10
		};
		const farba = predvolenaFarba('Deluxe');
		expect(farba).toBe('R9006');
		const r = kovanieDoOdpisu(cfg, [spec], false, farba);
		expect(r.err).toBeNull();
		// R9006 krytky sú v odpise (nie R7016)
		expect(r.polozky.some((p) => p.kod === 'ZASK202525')).toBe(true); // stredová L R9006
		expect(r.polozky.some((p) => p.kod === 'ZASK202526')).toBe(false); // stredová L R7016
	});

	it('Deluxe odpis s R7016 funguje — operátor môže zvoliť inú farbu', () => {
		const spec: PosuvSpec = {
			sysStyl: 'Deluxe|2K',
			S: 3000,
			V: 2200,
			redukciaZero: false,
			skloHrubka: 10
		};
		const r = kovanieDoOdpisu(cfg, [spec], false, 'R7016');
		expect(r.err).toBeNull();
		// R7016 krytky sú v odpise (nie R9006)
		expect(r.polozky.some((p) => p.kod === 'ZASK202526')).toBe(true); // stredová L R7016
		expect(r.polozky.some((p) => p.kod === 'ZASK202525')).toBe(false); // stredová L R9006
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
