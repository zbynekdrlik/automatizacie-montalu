// Verejný konfigurátor pergoly (#333) — prevod ROZMEROV mm ↔ metre (zákaznícke
// zobrazenie). Overuje: mm → text „4,0" (čiarka, 1 desatinné), parse metrov (ČIARKA
// aj BODKA, zaokrúhlenie na 100 mm, clamp, prázdny/nečíselný → null) a smerový krok
// stepperom (on-grid presne o krok, off-grid na najbližšiu mriežku, clamp).
import { describe, it, expect } from 'vitest';
import { mmNaMetreText, parseMetreNaMm, krokMetre } from '../src/lib/konfigurator-jednotky';

describe('mmNaMetreText — mm → zákaznícky text v metroch (čiarka, 1 desatinné)', () => {
	it('celé metre → „X,0"', () => {
		expect(mmNaMetreText(4000)).toBe('4,0');
		expect(mmNaMetreText(5000)).toBe('5,0');
		expect(mmNaMetreText(2000)).toBe('2,0');
	});
	it('polovičné/desatinné metre → čiarka', () => {
		expect(mmNaMetreText(4500)).toBe('4,5');
		expect(mmNaMetreText(2800)).toBe('2,8');
		expect(mmNaMetreText(3500)).toBe('3,5');
	});
	it('null / nečíselné → prázdny reťazec (input ostane prázdny)', () => {
		expect(mmNaMetreText(null)).toBe('');
		expect(mmNaMetreText(Number.NaN)).toBe('');
		expect(mmNaMetreText(Number.POSITIVE_INFINITY)).toBe('');
	});
});

describe('parseMetreNaMm — text v metroch → mm (čiarka AJ bodka, 100 mm mriežka, clamp)', () => {
	const MIN = 2000;
	const MAX = 12000;
	it('akceptuje ČIARKU', () => {
		expect(parseMetreNaMm('4,5', MIN, MAX)).toBe(4500);
		expect(parseMetreNaMm('4,2', MIN, MAX)).toBe(4200);
	});
	it('akceptuje BODKU', () => {
		expect(parseMetreNaMm('4.5', MIN, MAX)).toBe(4500);
		expect(parseMetreNaMm('3.8', MIN, MAX)).toBe(3800);
	});
	it('celé číslo bez desatín', () => {
		expect(parseMetreNaMm('4', MIN, MAX)).toBe(4000);
		expect(parseMetreNaMm('5', MIN, MAX)).toBe(5000);
	});
	it('zaokrúhľuje na najbližších 100 mm (1 desatinné miesto)', () => {
		expect(parseMetreNaMm('4,24', MIN, MAX)).toBe(4200);
		expect(parseMetreNaMm('4,25', MIN, MAX)).toBe(4300);
		expect(parseMetreNaMm('4.06', MIN, MAX)).toBe(4100);
	});
	it('clamp na min/max (po zaokrúhlení)', () => {
		expect(parseMetreNaMm('15', MIN, MAX)).toBe(12000); // 15000 → clamp
		expect(parseMetreNaMm('0', MIN, MAX)).toBe(2000); // 0 → clamp na min
		expect(parseMetreNaMm('1,5', MIN, MAX)).toBe(2000);
	});
	it('medzery okolo hodnoty sú OK', () => {
		expect(parseMetreNaMm('  4,5  ', MIN, MAX)).toBe(4500);
	});
	it('prázdny / nečíselný vstup → null (hodnota sa NEmení počas mazania)', () => {
		expect(parseMetreNaMm('', MIN, MAX)).toBeNull();
		expect(parseMetreNaMm('   ', MIN, MAX)).toBeNull();
		expect(parseMetreNaMm('abc', MIN, MAX)).toBeNull();
		expect(parseMetreNaMm('4,', MIN, MAX)).toBe(4000); // rozpísaná „4," je platné 4 m
	});
});

describe('krokMetre — stepper krok so smerovým prichytením na mriežku', () => {
	const MIN = 2000;
	const MAX = 12000;
	it('on-grid hodnota sa posunie presne o krok (+500 / −500)', () => {
		expect(krokMetre(4000, 500, MIN, MAX)).toBe(4500);
		expect(krokMetre(4500, 500, MIN, MAX)).toBe(5000);
		expect(krokMetre(4000, -500, MIN, MAX)).toBe(3500);
		expect(krokMetre(4500, -500, MIN, MAX)).toBe(4000);
	});
	it('off-grid (ručný medzikrok) sa prichytí na najbližšiu mriežku v smere kroku', () => {
		expect(krokMetre(4200, 500, MIN, MAX)).toBe(4500);
		expect(krokMetre(4200, -500, MIN, MAX)).toBe(4000);
		expect(krokMetre(4700, 500, MIN, MAX)).toBe(5000);
		expect(krokMetre(4700, -500, MIN, MAX)).toBe(4500);
	});
	it('výškový krok 100 mm', () => {
		expect(krokMetre(2500, 100, 2000, 4000)).toBe(2600);
		expect(krokMetre(2500, -100, 2000, 4000)).toBe(2400);
		expect(krokMetre(2450, 100, 2000, 4000)).toBe(2500);
		expect(krokMetre(2450, -100, 2000, 4000)).toBe(2400);
	});
	it('clamp na hranice rozmedzia', () => {
		expect(krokMetre(12000, 500, MIN, MAX)).toBe(12000);
		expect(krokMetre(2000, -500, MIN, MAX)).toBe(2000);
		expect(krokMetre(4000, 100, 2000, 4000)).toBe(4000); // výška max
	});
	it('null (prázdna hodnota) → krok od min', () => {
		expect(krokMetre(null, 500, MIN, MAX)).toBe(2500);
		expect(krokMetre(null, -500, MIN, MAX)).toBe(2000); // clamp na min
	});
});
