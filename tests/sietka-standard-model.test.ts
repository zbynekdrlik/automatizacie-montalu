// #569 — čistý model sieťky Štandard (`$lib/sietka-standard`): jeden zdroj pravdy pre
// krížovú deltu kladkového a rozmer sieťoviny. Geometria (Patrik, úloha 1070): starý
// Štandard má koncový profil 38 + nos 33, plus 54,5 + nos 33 → pri tom istom kladkovom je
// plus rám o 16,5 mm širší. Preto pri kombinácii rodín kladkový sieťky ±K voči posuvu.
import { describe, it, expect } from 'vitest';
import {
	SIETKA_STANDARD_SEED,
	SIETKA_STANDARD_BOUNDS,
	krizDelta,
	sietkaStandardRozmer
} from '../src/lib/sietka-standard';

describe('krizDelta — znamienko podľa smeru kombinácie', () => {
	it('Š+ posuv + stará sieťka → +K (starý rám je užší, kladkový sieťky dlhší)', () => {
		expect(krizDelta('Štandard +', 'Štandard', 16.5)).toBe(16.5);
	});
	it('starý posuv + sieťka plus → −K (Patrik 1070: „má byť o 16mm menšia voči posuvu")', () => {
		expect(krizDelta('Štandard', 'Štandard +', 16.5)).toBe(-16.5);
	});
	it('rovnaká rodina → 0', () => {
		expect(krizDelta('Štandard', 'Štandard', 16.5)).toBe(0);
		expect(krizDelta('Štandard +', 'Štandard +', 16.5)).toBe(0);
	});
	it('K je parameter (editor), nie konštanta v kóde', () => {
		expect(krizDelta('Štandard +', 'Štandard', 20)).toBe(20);
		expect(krizDelta('Štandard', 'Štandard +', 20)).toBe(-20);
	});
});

describe('sietkaStandardRozmer — sieťovina z rámu, nie zo skla', () => {
	const p = SIETKA_STANDARD_SEED;
	it('seed hodnoty = dnešné správanie (K 16,5 / R 17 / H 3)', () => {
		expect(p).toEqual({ k: 16.5, r: 17, h: 3 });
	});
	it('rovnaká rodina: šírka = kladkový + R, výška = základné sklo V + H', () => {
		const x = sietkaStandardRozmer({
			kladkovyPosuv: 942.5,
			skloVZaklad: 1735,
			posuvSystem: 'Štandard +',
			sietkaSystem: 'Štandard +',
			params: p
		});
		expect(x.krizDelta).toBe(0);
		expect(x.sietovina).toEqual({ sirka: 960, vyska: 1738 }); // 942,5+17 = 959,5 → 960
	});
	it('Š+ posuv + stará sieťka: 942,5 + 16,5 + 17 = 976 (jedno zaokrúhlenie na konci)', () => {
		const x = sietkaStandardRozmer({
			kladkovyPosuv: 942.5,
			skloVZaklad: 1735,
			posuvSystem: 'Štandard +',
			sietkaSystem: 'Štandard',
			params: p
		});
		expect(x.krizDelta).toBe(16.5);
		expect(x.sietovina).toEqual({ sirka: 976, vyska: 1738 });
	});
	it('starý posuv + sieťka plus: 952,33 − 16,5 + 17 = 952,83 → 953', () => {
		const x = sietkaStandardRozmer({
			kladkovyPosuv: 2857 / 3,
			skloVZaklad: 1735,
			posuvSystem: 'Štandard',
			sietkaSystem: 'Štandard +',
			params: p
		});
		expect(x.krizDelta).toBe(-16.5);
		expect(x.sietovina).toEqual({ sirka: 953, vyska: 1738 });
	});
	it('R a H sú parametre — zmena sa premietne 1:1', () => {
		const x = sietkaStandardRozmer({
			kladkovyPosuv: 942.5,
			skloVZaklad: 1735,
			posuvSystem: 'Štandard +',
			sietkaSystem: 'Štandard +',
			params: { k: 16.5, r: 20, h: 5 }
		});
		expect(x.sietovina).toEqual({ sirka: 963, vyska: 1740 }); // 962,5 → 963
	});
});

describe('SIETKA_STANDARD_BOUNDS — preklep v editore sa odmietne', () => {
	it('seed hodnoty sú v medziach', () => {
		for (const k of ['k', 'r', 'h'] as const) {
			expect(SIETKA_STANDARD_SEED[k]).toBeGreaterThanOrEqual(SIETKA_STANDARD_BOUNDS[k].min);
			expect(SIETKA_STANDARD_SEED[k]).toBeLessThanOrEqual(SIETKA_STANDARD_BOUNDS[k].max);
		}
	});
});
