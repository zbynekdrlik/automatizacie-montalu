// #342: Tesnenie — výpočet celkovej dĺžky zasklievacieho tesnenia pre STANDARD.
// Vektory odvodené z Dominikove vzorca (7.9.2026, úloha 582, msg 1806754):
//   dĺžka = Σ(ZASP202415 rezy) + Σ(ZASP00024 rezy) + Σ(ZASP20244|ZASP00018 rezy)
// Cross-checked s compute-drevostavby.test.ts vektormi (S=5500, V=2132, Štandard Drevo|4K).
import { describe, it, expect } from 'vitest';
import { buildCFG, computeFlat } from '../src/lib/server/compute';
import type { SysRow, RezRow } from '../src/lib/server/compute';
import { computeTesnenie, computeTesneniePooled, TESNENIE_SYSTEMY } from '../src/lib/tesnenie';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);

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
		const tesnenie = computeTesnenie(result.material, result.system);

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

		it('honestNull obsahuje čaká na spresnenie', () => {
			expect(tesnenie!.honestNull).toContain('čaká na spresnenie');
			expect(tesnenie!.honestNull).toContain('ZASK00005');
			expect(tesnenie!.honestNull).toContain('ZASK00006');
		});
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
	// Σ = 5658 + 8268 + 4134 = 18060 mm = 18.1 m
	describe('Štandard +|3K (S=3000, V=2100)', () => {
		const result = computeFlat(cfg, 'Štandard +|3K', 3000, 2100, false);
		if (!result) throw new Error('computeFlat returned null');
		const tesnenie = computeTesnenie(result.material, 'Štandard +');

		it('vracia výsledok pre Štandard +', () => {
			expect(tesnenie).not.toBeNull();
		});

		it('dlzkaMm = 18060', () => {
			expect(tesnenie!.dlzkaMm).toBe(18060);
		});

		it('dlzkaM = 18.1', () => {
			expect(tesnenie!.dlzkaM).toBe(18.1);
		});
	});

	// IZO varianta Štandard +|3K IZO — rovnaké rozmery, rovnaké profily
	// (IZO mení len koľajnicu a U-profil, nie kladkový/nos/krajovú)
	// Rozmer kladkového pre IZO 3K: rovnaký val() vzorec, rozdiel je len IZO koľajnica
	// Podľa cfg_seed: Štandard +|3K IZO má rovnaké kladkové/nos/krajová ako basic 3K
	describe('Štandard +|3K IZO (S=3000, V=2100)', () => {
		const result = computeFlat(cfg, 'Štandard +|3K IZO', 3000, 2100, false);
		if (!result) throw new Error('computeFlat returned null');
		const tesnenie = computeTesnenie(result.material, 'Štandard +');

		it('IZO má rovnakú dĺžku tesnenia ako basic (profily sú identické)', () => {
			expect(tesnenie!.dlzkaMm).toBe(18060);
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

		// ZASP202415: pocetKs=4, offset=-147.5, val = (2000 + (-147.5))/2 = 926.25 → 926
		//   4 ks × 926 = 3704
		// ZASP00024 (nos): pocetKs=2 (2*(2-1)=2), rozmer = 2000-33 = 1967
		//   2 ks × 1967 = 3934
		// ZASP20244 (krajová): pocetKs=2, rozmer = 2000-33 = 1967
		//   2 ks × 1967 = 3934
		// Σ = 3704 + 3934 + 3934 = 11572 mm = 11.6 m
		it('dlzkaMm = 11572', () => {
			expect(tesnenie!.dlzkaMm).toBe(11572);
		});

		it('dlzkaM = 11.6', () => {
			expect(tesnenie!.dlzkaM).toBe(11.6);
		});
	});
});

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

describe('TESNENIE_SYSTEMY', () => {
	it('obsahuje Štandard, Štandard + a Štandard Drevo', () => {
		expect(TESNENIE_SYSTEMY).toEqual(['Štandard', 'Štandard +', 'Štandard Drevo']);
	});
});
