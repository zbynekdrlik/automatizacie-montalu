// Mostík kovanie → položky do Money xlsx. MONEY-KRITICKÉ: tieto riadky sú skutočný
// výdaj zo skladu, takže sa testuje aj to, čo sa NESMIE stať (tichá nula, chýbajúca
// jednotka, Slide bez skladovej zásoby, zlý/chýbajúci farebný variant).
import { describe, it, expect } from 'vitest';
import { buildCFG, type PosuvSpec } from '../src/lib/server/compute';
import { kovanieDoOdpisu } from '../src/lib/server/kovanie';
import type { Farba } from '../src/lib/komponenty';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as never, seed.rez as never);
const spec = (sysStyl: string, S = 3000, V = 2200): PosuvSpec => ({
	sysStyl,
	S,
	V,
	redukciaZero: false
});
// #338: Robust/Štandard majú RAL farebné varianty kovania → farba je povinná. Väčšina
// testov overuje farbo-neutrálne položky, tak default R9005; farbo-špecifické testy nižšie.
// (Farba typ rozšírený na R9006 v #354 — Deluxe kovanie má vlastný test súbor
// tests/kovanie-deluxe.test.ts, nie ďalší describe blok tu.)
const kov = (specs: PosuvSpec[], fab = false, farba: Farba | undefined = 'R9005') =>
	kovanieDoOdpisu(cfg, specs, fab, farba);
const qty = (r: { polozky: { kod: string; qty: number }[] }, kod: string) =>
	r.polozky.find((p) => p.kod === kod)?.qty;

describe('kovanieDoOdpisu — jeden posuv', () => {
	it('Robust 2K: kusy aj tesnenia, bez chyby', () => {
		const r = kov([spec('Robust|2K')]);
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK00027')).toBe(4); // kladka 2 ks × 2 krídla
		expect(qty(r, 'ZASK00029')).toBe(2); // uzávery
		expect(qty(r, 'ZASK202533')).toBe(4); // kľučka R9005: obojstranná FAB
		expect(qty(r, 'ZASK00037')).toBe(8); // rohovník obvodový podľa 2K koľajnice
	});

	it('každá položka má jednotku a metrážové sú „m", kusové „ks"', () => {
		const r = kov([spec('Robust|3K')]);
		expect(r.polozky.every((p) => p.mj === 'ks' || p.mj === 'm')).toBe(true);
		expect(r.polozky.find((p) => p.kod === 'ZASK00041')!.mj).toBe('m');
		expect(r.polozky.find((p) => p.kod === 'ZASK00038')!.mj).toBe('ks');
	});

	it('jednostranná FAB zníži kľučku a krytku vložky na polovicu, nič iné', () => {
		const oboj = kov([spec('Robust|3K')], false);
		const jedno = kov([spec('Robust|3K')], true);
		expect(qty(jedno, 'ZASK202533')).toBe(qty(oboj, 'ZASK202533')! / 2);
		expect(qty(jedno, 'ZASK202535')).toBe(qty(oboj, 'ZASK202535')! / 2);
		const bezFab = (r: typeof oboj) =>
			r.polozky.filter((p) => !['ZASK202533', 'ZASK202535'].includes(p.kod));
		expect(bezFab(jedno)).toEqual(bezFab(oboj));
	});

	it('ručná dĺžka koľajnice kovanie NEMENÍ (mení len profily)', () => {
		const bez = kov([spec('Robust|2K')]);
		const s = kov([{ ...spec('Robust|2K'), kolajnica: { horna: 2690 } }]);
		expect(s.polozky).toEqual(bez.polozky);
	});
});

describe('kovanieDoOdpisu — RAL farebné varianty (#338)', () => {
	it('R9005 pošle len R9005 variant, R7016 vôbec (absent, nie 0)', () => {
		const r = kov([spec('Robust|2K')], false, 'R9005');
		expect(qty(r, 'ZASK202533')).toBe(4); // kľučka R9005
		expect(qty(r, 'ZASK202535')).toBe(4); // krytka vložky R9005
		expect(r.polozky.find((p) => p.kod === 'ZASK202534')).toBeUndefined(); // R7016 kľučka
		expect(r.polozky.find((p) => p.kod === 'ZASK202536')).toBeUndefined(); // R7016 krytka
	});

	it('R7016 pošle len R7016 variant, R9005 vôbec', () => {
		const r = kov([spec('Robust|2K')], false, 'R7016');
		expect(qty(r, 'ZASK202534')).toBe(4); // kľučka R7016
		expect(qty(r, 'ZASK202536')).toBe(4); // krytka vložky R7016
		expect(r.polozky.find((p) => p.kod === 'ZASK202533')).toBeUndefined();
		expect(r.polozky.find((p) => p.kod === 'ZASK202535')).toBeUndefined();
	});

	it('chýbajúca farba pri systéme s RAL položkou → HLASNÁ chyba, nie tichý default', () => {
		const r = kovanieDoOdpisu(cfg, [spec('Robust|2K')], false, undefined);
		expect(r.polozky).toEqual([]);
		expect(r.err).toMatch(/farba kovania/);
		expect(r.err).toMatch(/ZASK202533/);
	});

	it('zrušené kódy ZASK00030/00034/00035 sa už neobjavia v žiadnej farbe', () => {
		for (const farba of ['R9005', 'R7016'] as const) {
			const r = kov([spec('Robust|2K')], false, farba);
			for (const kod of ['ZASK00030', 'ZASK00034', 'ZASK00035'])
				expect(r.polozky.find((p) => p.kod === kod)).toBeUndefined();
		}
	});
});

describe('kovanieDoOdpisu — STANDARD (#338)', () => {
	it('Štandard 2K: kladka, protikus, zámok R9005; tesnenia/kefy chýbajú (warn)', () => {
		const r = kov([spec('Štandard|2K')], false, 'R9005');
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK00002')).toBe(4); // kladka dvojitá 2 ks × 2 okná
		expect(qty(r, 'ZASK202531')).toBe(2); // automaticky zamok R9005: 2 koncové okná
		expect(qty(r, 'ZASK20252')).toBe(2); // protikus zámku 1 ks × 2 zámky
		expect(r.polozky.find((p) => p.kod === 'ZASK202532')).toBeUndefined(); // R7016
		expect(r.warn).toMatch(/tesnenia/i); // upozornenie na neúplnosť
	});

	it('Štandard opona (2x2K): zámok 3, protikus 3', () => {
		const r = kov([spec('Štandard|2x2K')], false, 'R7016');
		expect(qty(r, 'ZASK202532')).toBe(3); // R7016 zámok, opona
		expect(qty(r, 'ZASK20252')).toBe(3); // protikus = počet zámkov
		expect(r.polozky.find((p) => p.kod === 'ZASK202531')).toBeUndefined();
	});

	it('Štandard IZO variant má rovnaký počet zámkov ako basic', () => {
		const basic = kov([spec('Štandard|3K')], false, 'R9005');
		const izo = kov([spec('Štandard|3K IZO')], false, 'R9005');
		expect(qty(izo, 'ZASK202531')).toBe(qty(basic, 'ZASK202531'));
	});
});

describe('kovanieDoOdpisu — viac posuvov (zimná záhrada)', () => {
	it('kusy sa SČÍTAJÚ za posuvy (na rozdiel od profilov sa nič nezdieľa)', () => {
		const jeden = kov([spec('Robust|2K')]);
		const dva = kov([spec('Robust|2K'), spec('Robust|2K', 4000, 2100)]);
		expect(qty(dva, 'ZASK00027')).toBe(2 * qty(jeden, 'ZASK00027')!);
		expect(qty(dva, 'ZASK00037')).toBe(2 * qty(jeden, 'ZASK00037')!);
	});

	it('rôzne štýly v jednej zákazke sa spočítajú každý po svojom', () => {
		const r = kov([spec('Robust|2K'), spec('Robust|3K')]);
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK00027')).toBe(4 + 6); // 2 krídla + 3 krídla, po 2 ks
		expect(qty(r, 'ZASK00037')).toBe(8 + 12); // 2K koľajnica + 3K koľajnica
	});

	it('tesnenia (metre) sa sčítajú, nie zaokrúhlia nadol', () => {
		const r = kov([spec('Robust|2K'), spec('Robust|2K')]);
		const jeden = kov([spec('Robust|2K')]);
		expect(qty(r, 'ZASK20242')).toBeCloseTo(2 * qty(jeden, 'ZASK20242')!, 3);
	});
});

describe('kovanieDoOdpisu — SLIDE (#357, zapnuté — 2 z 11 kódov s 0 ks vynechané)', () => {
	it('R7016 (jediná Slide farba so skladom): kladka, zámok, protikus, tesnenia — bez chyby, s warn o madle', () => {
		const r = kov([spec('Slide|2K')], false, 'R7016');
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK20253')).toBe(4); // kladka 2 ks × 2 krídla
		expect(qty(r, 'ZASK202538')).toBe(2); // zámok R7016: 2K → 2 ks
		expect(qty(r, 'ZASK20255')).toBe(2); // protikus zámku 1 ks × 2 zámky
		expect(r.polozky.find((p) => p.kod === 'ZASK20258')).toBeUndefined(); // madlo — 0 ks, vynechané
		expect(r.warn).toMatch(/[Mm]adlo/); // #357 upozornenie na chýbajúce madlo
		expect(r.warn).not.toMatch(/zámok/i); // R7016 zámok odpis DOSTÁVA, hláška ho nespomína
	});

	it('R9005 (bez skladu) na Slide-only objednávke: HLASNÁ chyba, žiadne kovanie sa neodošle (#354 poistka)', () => {
		const r = kov([spec('Slide|2K')], false, 'R9005');
		expect(r.err).toMatch(/Kovanie/);
		expect(r.polozky).toEqual([]);
	});

	it('Štandard + kovanie nemá — odpis profilov beží ďalej bez chyby', () => {
		expect(kov([spec('Štandard +|2K')])).toEqual({ polozky: [], err: null, warn: null });
	});
	// Deluxe DOSTALO kovanie v #354 (madlo/kefy/10mm krytky) — testy v
	// tests/kovanie-deluxe.test.ts nahrádzajú pôvodné "Deluxe kovanie nemá".

	it('zmiešaná zákazka: Robust dá kovanie, Štandard + nie', () => {
		const r = kov([spec('Robust|2K'), spec('Štandard +|2K')]);
		expect(r.err).toBeNull();
		expect(qty(r, 'ZASK00027')).toBe(4);
	});
});

describe('fail-loud', () => {
	it('neznámy nárezák zastaví odpis chybou, nie prázdnym zoznamom', () => {
		const r = kov([spec('Robust|9K')]);
		expect(r.polozky).toEqual([]);
		expect(r.err).toMatch(/Kovanie/);
	});
});
