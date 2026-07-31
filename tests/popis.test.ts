// Badge nad viac-posuvovým plánom — Patrik 2026-07-28: má ťahať SYSTÉM, nie paušálne
// „Zimná záhrada". Display-only, Money odpis sa tým nemení.
import { describe, it, expect } from 'vitest';
import { popisMulti, posuvySlovom } from '../src/lib/popis';

describe('posuvySlovom — slovenské množné číslo', () => {
	it('1 posuv, 2–4 posuvy, 5+ posuvov', () => {
		expect(posuvySlovom(1)).toBe('1 posuv');
		expect(posuvySlovom(2)).toBe('2 posuvy');
		expect(posuvySlovom(3)).toBe('3 posuvy');
		expect(posuvySlovom(4)).toBe('4 posuvy');
		expect(posuvySlovom(5)).toBe('5 posuvov');
		expect(posuvySlovom(12)).toBe('12 posuvov');
	});
});

describe('popisMulti — badge ťahá názov systému', () => {
	it('KĽÚČOVÉ: 3× Štandard + → „Štandard plus · 3 posuvy" (nie „Zimná záhrada")', () => {
		const p = [
			{ system: 'Štandard +' },
			{ system: 'Štandard +' },
			{ system: 'Štandard +' }
		];
		expect(popisMulti(p)).toBe('Štandard plus · 3 posuvy');
		expect(popisMulti(p)).not.toContain('Zimná záhrada');
	});

	it('jeden systém sa neopakuje, aj keď je posuvov veľa', () => {
		const p = Array.from({ length: 6 }, () => ({ system: 'Robust' }));
		expect(popisMulti(p)).toBe('Robust · 6 posuvov');
	});

	it('zmiešané systémy sa vypíšu všetky v poradí posuvov', () => {
		expect(
			popisMulti([{ system: 'Štandard +' }, { system: 'Robust' }, { system: 'Slide' }])
		).toBe('Štandard plus, Robust, Slide · 3 posuvy');
	});

	it('starý systém „Štandard" (bez plus) sa nezlúči so „Štandard +"', () => {
		expect(popisMulti([{ system: 'Štandard' }, { system: 'Štandard +' }])).toBe(
			'Starý štandard, Štandard plus · 2 posuvy'
		);
	});

	it('prázdny/chýbajúci systém nezhodí popis — fallback „Zasklenia"', () => {
		expect(popisMulti([{ system: '' }, { system: '' }])).toBe('Zasklenia · 2 posuvy');
		expect(popisMulti([])).toBe('Zasklenia · 0 posuvov');
	});
});
