// CLIP vizualizácia zábradlia (#554) — čistá geometria SVG náhľadu. 1 výplň =
// jeden obdĺžnik (0 priečok); N výplní = N polí oddelených priečkami na pozíciách
// `poziciePriecok` (mm od ľavého kraja, 1:1 zo šablóny). Popisky pozícií v mm ako
// v Exceli („priečka č.1 1003,0"). Bez browser API — testovateľné bez DOM.
import { describe, it, expect } from 'vitest';
import { clipNahladGeom } from '../src/lib/clip-nahlad';

describe('clipNahladGeom — počet polí a priečok', () => {
	it('1 výplň (žiadna priečka) → 1 pole, 0 priečok', () => {
		const g = clipNahladGeom(3000, 1200, []);
		expect(g.poleCount).toBe(1);
		expect(g.priecky).toHaveLength(0);
	});

	it('3 výplne → 3 polia, 2 priečky na 1003 / 1997 (Excel 37649)', () => {
		const g = clipNahladGeom(3000, 1200, [1003, 1997]);
		expect(g.poleCount).toBe(3);
		expect(g.priecky).toHaveLength(2);
		expect(g.priecky.map((p) => p.mm)).toEqual([1003, 1997]);
		// číslovanie od 1
		expect(g.priecky.map((p) => p.cislo)).toEqual([1, 2]);
		// pozícia v % z celkovej šírky (na umiestnenie čiary v mierke)
		expect(g.priecky[0]!.xPct).toBeCloseTo((1003 / 3000) * 100, 5);
		expect(g.priecky[1]!.xPct).toBeCloseTo((1997 / 3000) * 100, 5);
	});

	it('viewBox nesie skutočné rozmery zábradlia (mierka)', () => {
		const g = clipNahladGeom(2500, 1100, [1250]);
		expect(g.sirka).toBe(2500);
		expect(g.vyska).toBe(1100);
		expect(g.poleCount).toBe(2);
	});

	it('degenerovaná šírka 0 → žiadny pád (xPct = 0)', () => {
		const g = clipNahladGeom(0, 0, [100]);
		expect(g.priecky[0]!.xPct).toBe(0);
		expect(g.poleCount).toBe(2);
	});
});
