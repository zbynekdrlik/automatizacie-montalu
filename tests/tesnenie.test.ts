// #342: Tesnenie — výpočet celkovej dĺžky zasklievacieho tesnenia pre STANDARD,
// klasifikácia skla (4mm/6mm/IZO) a Money odpis polozky.
//
// Vektory odvodené z Dominikove vzorca (7.9.2026, úloha 582, msg 1806754):
//   dĺžka = Σ(ZASP202415 rezy) + Σ(ZASP00024 rezy) + Σ(ZASP20244|ZASP00018 rezy)
// Mapovanie (8.9.2026, msg 1807247): 4mm→ZASK00005, 6mm→ZASK00006, IZO→žiadne.
import { describe, it, expect } from 'vitest';
import { buildCFG, computeFlat } from '../src/lib/server/compute';
import type { SysRow, RezRow } from '../src/lib/server/compute';
import {
	computeTesnenie,
	computeTesneniePooled,
	TESNENIE_SYSTEMY,
	klasifikujSkloPreTesnenie,
	TESNENIE_KODY,
	tesneniePolozky
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

// ---- computeTesnenie ----

describe('computeTesnenie', () => {
	it('vracia null pre Robust (nie STANDARD systém)', () => {
		const r = computeFlat(cfg, 'Robust|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		expect(computeTesnenie(r!.material, 'Robust')).toBeNull();
	});

	it('vracia null pre Slide', () => {
		const r = computeFlat(cfg, 'Slide|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		expect(computeTesnenie(r!.material, 'Slide')).toBeNull();
	});

	it('vracia null pre Deluxe', () => {
		const r = computeFlat(cfg, 'Deluxe|3K', 3000, 2100, false, 10);
		expect(r).not.toBeNull();
		expect(computeTesnenie(r!.material, 'Deluxe')).toBeNull();
	});

	// Štandard Drevo|4K — S=5500, V=2132 (rovnaké rozmery ako compute-drevostavby.test.ts)
	// Profily z testu:
	//   ZASP202415 (kladkový): 8 ks × 1333 mm = 10664 mm
	//   ZASP00024 (nos): 6 ks × 2099 mm = 12594 mm
	//   ZASP00018 (krajová klasik): 2 ks × 2099 mm = 4198 mm
	// Σ = 10664 + 12594 + 4198 = 27456 mm = 27.5 m
	describe('Štandard Drevo|4K (S=5500, V=2132)', () => {
		const result = computeFlat(cfg, 'Štandard Drevo|4K', 5500, 2132, false);
		if (!result) throw new Error('computeFlat returned null');
		// computeFlat returns system = sysStyl.split('|')[0] = 'Štandard Drevo'
		const tesnenie = computeTesnenie(result.material, result.system, 'Float sklo 6 mm');

		it('system = Štandard Drevo', () => {
			expect(result.system).toBe('Štandard Drevo');
		});

		it('vracia výsledok pre Štandard Drevo', () => {
			expect(tesnenie).not.toBeNull();
		});

		it('dlzkaMm = 27456', () => {
			expect(tesnenie!.dlzkaMm).toBe(27456);
		});

		it('dlzkaM = 27.5', () => {
			expect(tesnenie!.dlzkaM).toBe(27.5);
		});

		it('system = Štandard Drevo', () => {
			expect(tesnenie!.system).toBe('Štandard Drevo');
		});

		it('skloKlasifikacia = tesnenie6 pre 6mm sklo', () => {
			expect(tesnenie!.skloKlasifikacia).toBe('tesnenie6');
		});

		it('honestNull stále prítomný (ZASK202541 zostáva otvorený)', () => {
			expect(tesnenie!.honestNull).toContain('ZASK202541');
		});
	});

	// Štandard +|3K — S=3000, V=2100
	describe('Štandard +|3K (S=3000, V=2100)', () => {
		const result = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		if (!result) throw new Error('computeFlat returned null');
		const tesnenie = computeTesnenie(result.material, 'Štandard +', 'Float sklo 4 mm');

		it('vracia výsledok pre Štandard +', () => {
			expect(tesnenie).not.toBeNull();
		});

		it('dlzkaMm = 18060', () => {
			expect(tesnenie!.dlzkaMm).toBe(18060);
		});

		it('dlzkaM = 18.1', () => {
			expect(tesnenie!.dlzkaM).toBe(18.1);
		});

		it('skloKlasifikacia = tesnenie4 pre 4mm sklo', () => {
			expect(tesnenie!.skloKlasifikacia).toBe('tesnenie4');
		});
	});

	// IZO varianta Štandard +|3K IZO — rovnaké rozmery
	describe('Štandard +|3K IZO (S=3000, V=2100) — izolačné sklo', () => {
		const result = computeFlat(cfg, 'Štandard +|3K IZO', 3000, 2100, false);
		if (!result) throw new Error('computeFlat returned null');
		const tesnenie = computeTesnenie(result.material, 'Štandard +', 'Izolačné sklo 4.8.4');

		it('IZO má rovnakú dĺžku tesnenia ako basic (profily sú identické)', () => {
			expect(tesnenie!.dlzkaMm).toBe(18060);
		});

		it('skloKlasifikacia = izolacne', () => {
			expect(tesnenie!.skloKlasifikacia).toBe('izolacne');
		});

		it('honestNull hovorí o izolačnom skle bez tesnenia', () => {
			expect(tesnenie!.honestNull).toContain('bez tesnenia');
		});
	});

	// 2K (najmenší štýl) — S=2000, V=2000
	describe('Štandard +|2K (S=2000, V=2000)', () => {
		const result = computeFlat(cfg, 'Štandard +|2K', 2000, 2000, false);
		if (!result) throw new Error('computeFlat returned null');
		const tesnenie = computeTesnenie(result.material, 'Štandard +');

		it('vracia výsledok', () => {
			expect(tesnenie).not.toBeNull();
		});

		it('dlzkaMm > 0', () => {
			expect(tesnenie!.dlzkaMm).toBeGreaterThan(0);
		});

		it('dlzkaMm = 11572', () => {
			expect(tesnenie!.dlzkaMm).toBe(11572);
		});

		it('dlzkaM = 11.6', () => {
			expect(tesnenie!.dlzkaM).toBe(11.6);
		});
	});
});

// ---- tesneniePolozky ----

describe('tesneniePolozky', () => {
	it('vracia prázdne pre Robust', () => {
		const r = computeFlat(cfg, 'Robust|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky, warn } = tesneniePolozky(r!.material, 'Robust', 'Float sklo 6 mm');
		expect(polozky).toEqual([]);
		expect(warn).toBeNull();
	});

	it('vracia ZASK00005 pre 4mm sklo Štandard', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 4 mm');
		expect(polozky).toHaveLength(1);
		expect(polozky[0]!.kod).toBe('ZASK00005');
		expect(polozky[0]!.mj).toBe('m');
		// 18060 mm = 18.06 m (R3)
		expect(polozky[0]!.qty).toBe(18.06);
	});

	it('vracia ZASK00006 pre 6mm sklo Štandard', () => {
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
		// ZASK202541 honest-null stále prítomný
		expect(warn).toContain('ZASK202541');
	});

	it('vracia warn pre neznáme sklo (10mm)', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { polozky, warn } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 10 mm');
		expect(polozky).toEqual([]);
		expect(warn).toContain('10 mm');
		expect(warn).toContain('ZASK00005');
	});

	it('warn vždy obsahuje ZASK202541 honest-null pre STANDARD', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const { warn } = tesneniePolozky(r!.material, 'Štandard +', 'Float sklo 4 mm');
		expect(warn).toContain('ZASK202541');
	});
});

// ---- computeTesneniePooled ----

describe('computeTesneniePooled', () => {
	it('vracia null pre Robust-only zákazku', () => {
		const r = computeFlat(cfg, 'Robust|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const result = computeTesneniePooled(r!.material, ['Robust']);
		expect(result).toBeNull();
	});

	it('funguje s poolovaným materiálom jedného Štandard + posuvu', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const result = computeTesneniePooled(r!.material, ['Štandard +']);
		expect(result).not.toBeNull();
		expect(result!.dlzkaMm).toBe(18060);
	});

	it('ignoruje Robust system v zmiešanom poli', () => {
		const r = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		expect(r).not.toBeNull();
		const result = computeTesneniePooled(r!.material, ['Robust', 'Štandard +']);
		expect(result).not.toBeNull();
		expect(result!.dlzkaMm).toBe(18060);
	});
});

// ---- TESNENIE_SYSTEMY ----

describe('TESNENIE_SYSTEMY', () => {
	it('obsahuje Štandard, Štandard + a Štandard Drevo', () => {
		expect(TESNENIE_SYSTEMY).toEqual(['Štandard', 'Štandard +', 'Štandard Drevo']);
	});
});
