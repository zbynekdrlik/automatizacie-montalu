// Mostík kovanie → položky do Money xlsx. MONEY-KRITICKÉ: tieto riadky sú skutočný
// výdaj zo skladu, takže sa testuje aj to, čo sa NESMIE stať (tichá nula, chýbajúca
// jednotka, Slide bez skladovej zásoby).
import { describe, it, expect } from 'vitest';
import { buildCFG, type PosuvSpec } from '../src/lib/server/compute';
import { kovanieDoOdpisu } from '../src/lib/server/kovanie';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as never, seed.rez as never);
const spec = (sysStyl: string, S = 3000, V = 2200): PosuvSpec => ({
	sysStyl,
	S,
	V,
	redukciaZero: false
});
const qty = (r: { polozky: { kod: string; qty: number }[] }, kod: string) =>
	r.polozky.find((p) => p.kod === kod)?.qty;

describe('kovanieDoOdpisu — jeden posuv', () => {
	it('Robust 2K: kusy aj tesnenia, bez chyby', () => {
		const r = kovanieDoOdpisu(cfg, [spec('Robust|2K')], false);
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK00027')).toBe(4); // kladka 2 ks × 2 krídla
		expect(qty(r, 'ZASK00029')).toBe(2); // uzávery
		expect(qty(r, 'ZASK00030')).toBe(4); // kľučka: obojstranná FAB
		expect(qty(r, 'ZASK00037')).toBe(8); // rohovník obvodový podľa 2K koľajnice
	});

	it('každá položka má jednotku a metrážové sú „m", kusové „ks"', () => {
		const r = kovanieDoOdpisu(cfg, [spec('Robust|3K')], false);
		expect(r.polozky.every((p) => p.mj === 'ks' || p.mj === 'm')).toBe(true);
		expect(r.polozky.find((p) => p.kod === 'ZASK00041')!.mj).toBe('m');
		expect(r.polozky.find((p) => p.kod === 'ZASK00038')!.mj).toBe('ks');
	});

	it('jednostranná FAB zníži kľučku a krytku vložky na polovicu, nič iné', () => {
		const oboj = kovanieDoOdpisu(cfg, [spec('Robust|3K')], false);
		const jedno = kovanieDoOdpisu(cfg, [spec('Robust|3K')], true);
		expect(qty(jedno, 'ZASK00030')).toBe(qty(oboj, 'ZASK00030')! / 2);
		expect(qty(jedno, 'ZASK00035')).toBe(qty(oboj, 'ZASK00035')! / 2);
		const bezFab = (r: typeof oboj) =>
			r.polozky.filter((p) => !['ZASK00030', 'ZASK00035'].includes(p.kod));
		expect(bezFab(jedno)).toEqual(bezFab(oboj));
	});

	it('ručná dĺžka koľajnice kovanie NEMENÍ (mení len profily)', () => {
		const bez = kovanieDoOdpisu(cfg, [spec('Robust|2K')], false);
		const s = kovanieDoOdpisu(cfg, [{ ...spec('Robust|2K'), kolajnica: { horna: 2690 } }], false);
		expect(s.polozky).toEqual(bez.polozky);
	});
});

describe('kovanieDoOdpisu — viac posuvov (zimná záhrada)', () => {
	it('kusy sa SČÍTAJÚ za posuvy (na rozdiel od profilov sa nič nezdieľa)', () => {
		const jeden = kovanieDoOdpisu(cfg, [spec('Robust|2K')], false);
		const dva = kovanieDoOdpisu(cfg, [spec('Robust|2K'), spec('Robust|2K', 4000, 2100)], false);
		expect(qty(dva, 'ZASK00027')).toBe(2 * qty(jeden, 'ZASK00027')!);
		expect(qty(dva, 'ZASK00037')).toBe(2 * qty(jeden, 'ZASK00037')!);
	});

	it('rôzne štýly v jednej zákazke sa spočítajú každý po svojom', () => {
		const r = kovanieDoOdpisu(cfg, [spec('Robust|2K'), spec('Robust|3K')], false);
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK00027')).toBe(4 + 6); // 2 krídla + 3 krídla, po 2 ks
		expect(qty(r, 'ZASK00037')).toBe(8 + 12); // 2K koľajnica + 3K koľajnica
	});

	it('tesnenia (metre) sa sčítajú, nie zaokrúhlia nadol', () => {
		const r = kovanieDoOdpisu(cfg, [spec('Robust|2K'), spec('Robust|2K')], false);
		const jeden = kovanieDoOdpisu(cfg, [spec('Robust|2K')], false);
		expect(qty(r, 'ZASK20242')).toBeCloseTo(2 * qty(jeden, 'ZASK20242')!, 3);
	});
});

describe('systémy bez kovania', () => {
	it('Slide zatiaľ neposiela nič (kódy nemajú v Money skladovú zásobu)', () => {
		const r = kovanieDoOdpisu(cfg, [spec('Slide|2K')], false);
		expect(r.err).toBeNull();
		expect(r.polozky).toEqual([]);
	});

	it('Štandard + / Deluxe kovanie nemajú — odpis profilov beží ďalej bez chyby', () => {
		for (const ss of ['Štandard +|2K', 'Deluxe|2K'])
			expect(kovanieDoOdpisu(cfg, [spec(ss)], false)).toEqual({ polozky: [], err: null });
	});

	it('zmiešaná zákazka: Robust dá kovanie, Štandard + nie', () => {
		const r = kovanieDoOdpisu(cfg, [spec('Robust|2K'), spec('Štandard +|2K')], false);
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK00027')).toBe(4);
	});
});

describe('fail-loud', () => {
	it('neznámy nárezák zastaví odpis chybou, nie prázdnym zoznamom', () => {
		const r = kovanieDoOdpisu(cfg, [spec('Robust|9K')], false);
		expect(r.polozky).toEqual([]);
		expect(r.err).toMatch(/Kovanie/);
	});
});
