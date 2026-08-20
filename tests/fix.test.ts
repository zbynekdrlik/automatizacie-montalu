// Šikmé FIX zasklenie — geometria overená proti REÁLNYM výrobným výkresom, ktoré
// poslal Dominik (2026-07-27): OP260264 „FIX Minegis" (sklon 9,3°, 3 polia) a
// OP260236 „FIX KMS" (sklon 22,8° / zrkadlo 21,7°). Tie výkresy sú tu ground truth —
// keď sa čísla rozídu, chyba je v našom výpočte, nie vo výkrese.
import { describe, it, expect } from 'vitest';
import { pocitajFix, rovnomernePolia, chybaFixVstupu, FIX_MAX_POLI } from '../src/lib/fix';

describe('OP260264 „FIX Minegis" — sklon 9,3°, 3 polia (ground truth z výkresu)', () => {
	// výkres: základňa 2795, ľavý kraj 524, špička vpravo 64,6;
	// kumulatívne šírky 936,2 / 1859,8 / 2795 → šírky polí 936,2 / 923,6 / 935,2
	const r = pocitajFix(2795, 524, 64.6, [936.2, 923.6, 935.2]);

	it('sklon sedí s kótou 9,3° na výkrese', () => {
		expect(r.alfa).toBe(9.3);
		expect(r.klesaVpravo).toBe(true);
		expect(r.uholOstry).toBe(80.7); // pri vysokej strane
		expect(r.uholTupy).toBe(99.3); // pri špičke
	});

	it('kumulatívne dĺžky šikmej hrany sedia s kótami 948,7 / 1884,6 / 2832,3', () => {
		// výkres kótuje vonkajšie hrany, my počítame ideálnu geometriu → do 0,5 mm
		const ocakavane = [948.7, 1884.6, 2832.3];
		r.kumulSikma.forEach((x, i) => expect(Math.abs(x - ocakavane[i]!)).toBeLessThanOrEqual(0.5));
		expect(Math.abs(r.sikmaCelkom - 2832.3)).toBeLessThanOrEqual(0.5);
	});

	it('dĺžky šikmej hrany PO POLIACH sedia s rozdielmi kót výkresu', () => {
		// výkres kótuje kumulatívne 948,7 / 1884,6 / 2832,3 → jednotlivé polia
		const ocakavane = [948.7, 1884.6 - 948.7, 2832.3 - 1884.6];
		r.polia.forEach((p, i) => expect(Math.abs(p.sikma - ocakavane[i]!)).toBeLessThanOrEqual(0.5));
		// šikmá hrana je vždy DLHŠIA než šírka poľa (to je celý zmysel sklonu)
		r.polia.forEach((p) => expect(p.sikma).toBeGreaterThan(p.sirka));
		const sucet = r.polia.reduce((a, p) => a + p.sikma, 0);
		expect(Math.abs(sucet - r.sikmaCelkom)).toBeLessThanOrEqual(0.2);
	});

	it('kumulatívne šírky sedia s kótami 936,2 / 1859,8 / 2795', () => {
		expect(r.kumulSirka).toEqual([936.2, 1859.8, 2795]);
	});

	it('výšky na stĺpikoch sú VONKAJŠIE (výkres kótuje svetlé, o ~46 mm menšie)', () => {
		// výkres: 323,3 a 171,9 = svetlá výška skla; vonkajšia = svetlá + ~46,5 mm rámu
		expect(r.vyskyStlpikov).toEqual([370.1, 218.3]);
		expect(Math.abs(r.vyskyStlpikov[0]! - 46.8 - 323.3)).toBeLessThanOrEqual(0.5);
		expect(Math.abs(r.vyskyStlpikov[1]! - 46.4 - 171.9)).toBeLessThanOrEqual(0.5);
	});

	it('polia na seba nadväzujú a plocha je súčtom polí', () => {
		expect(r.polia[0]!.vLavo).toBe(524);
		expect(r.polia[2]!.vPravo).toBe(64.6);
		for (let i = 1; i < r.polia.length; i++) expect(r.polia[i]!.vLavo).toBe(r.polia[i - 1]!.vPravo);
		const sucet = r.polia.reduce((s, p) => s + p.m2, 0);
		expect(Math.abs(sucet - r.m2)).toBeLessThan(0.002);
	});
});

describe('OP260236 „FIX KMS" — sklon 22,8° a zrkadlo 21,7°', () => {
	it('L2: základňa 1557, 855 → 197,8 dá sklon aj šikmú hranu z výkresu', () => {
		const r = pocitajFix(1557, 855, 197.8, [1557]);
		expect(Math.abs(r.alfa - 22.8)).toBeLessThanOrEqual(0.2);
		expect(Math.abs(r.sikmaCelkom - 1688.7)).toBeLessThanOrEqual(2);
		expect(r.klesaVpravo).toBe(true);
	});

	it('P2 (zrkadlo): 233,9 → 858 stúpa doprava, dĺžky sú rovnaké', () => {
		const r = pocitajFix(1561, 233.9, 858, [1561]);
		expect(Math.abs(r.alfa - 21.7)).toBeLessThanOrEqual(0.2);
		expect(Math.abs(r.sikmaCelkom - 1680)).toBeLessThanOrEqual(2);
		expect(r.klesaVpravo).toBe(false);
		// tá istá konštrukcia otočená → identické dĺžky aj uhly
		const zrkadlo = pocitajFix(1561, 858, 233.9, [1561]);
		expect(zrkadlo.sikmaCelkom).toBe(r.sikmaCelkom);
		expect(zrkadlo.alfa).toBe(r.alfa);
		expect(zrkadlo.m2).toBe(r.m2);
	});
});

describe('rovnomernePolia', () => {
	it('rozdelí šírku a súčet sedí na milimeter (zvyšok berie posledné pole)', () => {
		for (const [S, n] of [
			[2795, 3],
			[3000, 4],
			[1234.5, 7],
			[900, 1]
		] as [number, number][]) {
			const p = rovnomernePolia(S, n);
			expect(p.length).toBe(n);
			expect(Math.abs(p.reduce((a, b) => a + b, 0) - S)).toBeLessThanOrEqual(0.05);
		}
	});
	it('nezmyselný počet sa zovrie na aspoň jedno pole', () => {
		expect(rovnomernePolia(2000, 0)).toEqual([2000]);
		expect(rovnomernePolia(2000, -3)).toEqual([2000]);
	});
});

describe('chybaFixVstupu — serverový strážca', () => {
	const ok = (S: number, V1: number, V2: number, p: number[]) => chybaFixVstupu(S, V1, V2, p);

	it('platný vstup prejde', () => {
		expect(ok(2795, 524, 64.6, [936.2, 923.6, 935.2])).toBeNull();
		// jedna výška 0 = konštrukcia do špičky
		expect(ok(3000, 1270, 0, [3000])).toBeNull();
	});

	it('rozmery mimo rozsahu neprejdú', () => {
		expect(ok(299, 500, 100, [299])).toMatch(/Šírka/);
		expect(ok(20001, 500, 100, [20001])).toMatch(/Šírka/);
		expect(ok(2000, -1, 100, [2000])).toMatch(/Výšky/);
		expect(ok(2000, 20001, 100, [2000])).toMatch(/Výšky/);
	});

	it('obe výšky 0 → nie je čo kresliť; rovnaké výšky → to nie je šikmý fix', () => {
		expect(ok(2000, 0, 0, [2000])).toMatch(/aspoň jednu výšku/);
		expect(ok(2000, 800, 800, [2000])).toMatch(/rovnaké/);
	});

	it('polia: počet, minimálna šírka aj súčet sa strážia', () => {
		expect(ok(2000, 800, 200, [])).toMatch(/Počet polí/);
		expect(ok(2000, 800, 200, rovnomernePolia(2000, FIX_MAX_POLI + 1))).toMatch(/Počet polí/);
		expect(ok(2000, 800, 200, [1950, 50])).toMatch(/Šírka poľa/);
		expect(ok(2000, 800, 200, [1000, 900])).toMatch(/nerovná/);
		// pol milimetra tolerancie (zaokrúhľovanie pri rovnomernom delení)
		expect(ok(2000, 800, 200, [666.7, 666.7, 666.6])).toBeNull();
	});
});
