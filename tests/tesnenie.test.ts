// #342: Tesnenie — Money odpis zasklievacieho tesnenia pre STANDARD.
//
// Vektory odvodené z Dominikove vzorca (7.9.2026, úloha 582, msg 1806754):
//   dĺžka = Σ(ZASP202415 rezy) + Σ(ZASP00024 rezy) + Σ(ZASP20244|ZASP00018 rezy)
// Mapovanie (8.9.2026, msg 1807247): 4mm→ZASK00005, 6mm→ZASK00006, IZO→žiadne.
import { describe, it, expect } from 'vitest';
import { buildCFG, computeFlat } from '../src/lib/server/compute';
import type { SysRow, RezRow } from '../src/lib/server/compute';
import {
	TESNENIE_SYSTEMY,
	klasifikujSkloPreTesnenie,
	TESNENIE_KODY,
	tesneniePolozky,
	tesneniePolozkyPooled
} from '../src/lib/tesnenie';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

// ---- klasifikujSkloPreTesnenie ----

describe('klasifikujSkloPreTesnenie', () => {
	it('4mm sklo → tesnenie4', () => {
		expect(klasifikujSkloPreTesnenie('Float sklo 4 mm')).toBe('tesnenie4');
	});

	it('6mm sklo → tesnenie6', () => {
		expect(klasifikujSkloPreTesnenie('Float sklo 6 mm')).toBe('tesnenie6');
	});

	it('izolačné sklo → izolacne', () => {
		expect(klasifikujSkloPreTesnenie('Izolačné sklo 4.8.4')).toBe('izolacne');
	});

	it('10mm sklo → nezname (Dominik neurčil)', () => {
		expect(klasifikujSkloPreTesnenie('Float sklo 10 mm')).toBe('nezname');
	});

	it('undefined → nezname', () => {
		expect(klasifikujSkloPreTesnenie(undefined)).toBe('nezname');
	});

	it('prázdny reťazec → nezname', () => {
		expect(klasifikujSkloPreTesnenie('')).toBe('nezname');
	});

	it('iné izolačné meno → izolacne (regex jeIzoSklo)', () => {
		expect(klasifikujSkloPreTesnenie('Izolacne sklo 4/16/4')).toBe('izolacne');
	});

	// 🟡5 review: desatinné meno nesmie misroutovať (lookbehind (?<![\d.,]))
	it('"Float sklo 6,4 mm" → nezname (desatinné, nie 4 mm)', () => {
		expect(klasifikujSkloPreTesnenie('Float sklo 6,4 mm')).toBe('nezname');
	});

	it('"Float sklo 4.4 mm" → nezname (desatinné s bodkou)', () => {
		expect(klasifikujSkloPreTesnenie('Float sklo 4.4 mm')).toBe('nezname');
	});
});

// ---- TESNENIE_KODY ----

describe('TESNENIE_KODY', () => {
	it('tesnenie4 = ZASK00005', () => {
		expect(TESNENIE_KODY.tesnenie4.kod).toBe('ZASK00005');
	});

	it('tesnenie6 = ZASK00006', () => {
		expect(TESNENIE_KODY.tesnenie6.kod).toBe('ZASK00006');
	});
});

// ---- tesneniePolozky (single-posuv) ----

describe('tesneniePolozky', () => {
	it('vracia prázdne pre Robust (nie STANDARD systém)', () => {
		const r = computeFlat(cfg, 'Robust|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky, warn } = tesneniePolozky(r!.material, 'Robust', 'Float sklo 6 mm');
		expect(polozky).toEqual([]);
		expect(warn).toBeNull();
	});

	// Štandard +|3K — S=3000, V=2100
	// Profily:
	//   ZASP202415 (kladkový, 3600mm tyč): pocetKs=6, koef=1, delitN=1, offset=-172.5
	//     val = (1*3000 + (-172.5)) / 3 = 942.5 → 943 (Math.round, kerf=0)
	//     6 ks × 943 = 5658 mm
	//   ZASP00024 (nos, 7500mm tyč): pocetKs=4 (2*(3-1)=4), rozmer = V-33 = 2067
	//     4 ks × 2067 = 8268 mm
	//   ZASP20244 (krajová PLUS, 7500mm tyč): pocetKs=2, rozmer = V-33 = 2067
	//     2 ks × 2067 = 4134 mm
	// Σ = 5658 + 8268 + 4134 = 18060 mm = 18.06 m (R3)
	it('vracia ZASK00005 pre 4mm sklo Štandard + (18.06 m)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 4 mm');
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.kod).toBe('ZASK00005');
		expect(polozky[0]!.mj).toBe('m');
		expect(polozky[0]!.qty).toBe(18.06);
	});

	it('vracia ZASK00006 pre 6mm sklo Štandard +', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 6 mm');
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.kod).toBe('ZASK00006');
		expect(polozky[0]!.qty).toBe(18.06);
	});

	it('vracia prázdne polozky pre izolačné sklo (bez gumy)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K IZO', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky, warn } = tesneniePolozky(r!.material, 'Štandard +', 'Izolačné sklo 4.8.4');
		expect(polozky).toEqual([]);
		// Izolačné = žiadny warn (Dominik: "bez gumy" = OK)
		expect(warn).toBeNull();
	});

	it('vracia warn pre neznáme sklo (10mm)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky, warn } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 10 mm');
		expect(polozky).toEqual([]);
		expect(warn).toContain('10 mm');
		expect(warn).toContain('ZASK00005');
	});

	// ZASK202541 NIE JE v tesnenie warn — vlastní ho KOVANIE_NEUPLNE (🟡2 review fix)
	it('warn NEobsahuje ZASK202541 (vlastní ho KOVANIE_NEUPLNE)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { warn } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 4 mm');
		// 4mm = platný kód, žiadny warn vôbec
		expect(warn).toBeNull();
	});

	// Štandard Drevo|4K — S=5500, V=2132 (cross-check s compute-drevostavby.test.ts)
	// Profily:
	//   ZASP202415 (kladkový): 8 ks × 1333 mm = 10664 mm
	//   ZASP00024 (nos): 6 ks × 2099 mm = 12594 mm
	//   ZASP00018 (krajová klasik): 2 ks × 2099 mm = 4198 mm
	// Σ = 10664 + 12594 + 4198 = 27456 mm = 27.456 m (R3)
	it('Štandard Drevo 4K: 27.456 m pre 6mm sklo', () => {
		const result = computeFlat(cfg, 'Štandard Drevo|4K', 5500, 2132, false);
		expect(result).not.toBeNull();
		expect(result!.system).toBe('Štandard Drevo');
		const { polozky } = tesneniePolozky(result!.material, 'Štandard Drevo', 'Float sklo 6 mm');
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.kod).toBe('ZASK00006');
		expect(polozky[0]!.qty).toBe(27.456);
	});

	// Štandard +|2K — S=2000, V=2000
	// ZASP202415: pocetKs=4, offset=-147.5, val = (2000 + (-147.5))/2 = 926.25 → 926
	//   4 ks × 926 = 3704
	// ZASP00024 (nos): pocetKs=2 (2*(2-1)=2), rozmer = 2000-33 = 1967
	//   2 ks × 1967 = 3934
	// ZASP20244 (krajová): pocetKs=2, rozmer = 2000-33 = 1967
	//   2 ks × 1967 = 3934
	// Σ = 3704 + 3934 + 3934 = 11572 mm = 11.572 m (R3)
	it('Štandard + 2K: 11.572 m', () => {
		const r = computeFlat(cfg, 'Štandard +|2K', 2000, 2000, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 4 mm');
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.qty).toBe(11.572);
	});

	// IZO varianta Štandard +|3K IZO — rovnaké profily, rovnaká dĺžka
	it('Štandard + 3K IZO: rovnaká dĺžka ako basic (profily identické)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K IZO', 3000, 2100, false);
		expect(r).not.toBeNull();
		// IZO → prázdne polozky (bez gumy), ale dĺžka by bola rovnaká
		const { polozky: p4 } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 4 mm');
		expect(p4[0]!.qty).toBe(18.06);
	});
});

// ---- tesneniePolozkyPooled (multi-posuv) ----

describe('tesneniePolozkyPooled', () => {
	it('vracia prázdne pre Robust-only zákazku', () => {
		const r = computeFlat(cfg, 'Robust|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozkyPooled(r!.material, ['Robust'], 'Float sklo 6 mm');
		expect(polozky).toEqual([]);
	});

	it('funguje s jedným Štandard + posuvom', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozkyPooled(r!.material, ['Štandard +'], 'Float sklo 6 mm');
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.kod).toBe('ZASK00006');
		expect(polozky[0]!.qty).toBe(18.06);
	});

	it('ignoruje Robust system v zmiešanom poli', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozkyPooled(
			r!.material,
			['Robust', 'Štandard +'],
			'Float sklo 6 mm'
		);
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.qty).toBe(18.06);
	});

	it('warn NEobsahuje ZASK202541', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { warn } = tesneniePolozkyPooled(r!.material, ['Štandard +'], 'Float sklo 6 mm');
		expect(warn).toBeNull(); // 6mm = platný kód, žiadny warn
	});
});

// ---- TESNENIE_SYSTEMY ----

describe('TESNENIE_SYSTEMY', () => {
	it('obsahuje Štandard, Štandard + a Štandard Drevo', () => {
		expect(TESNENIE_SYSTEMY).toEqual(['Štandard', 'Štandard +', 'Štandard Drevo']);
	});
});
