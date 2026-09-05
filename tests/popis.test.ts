// Badge nad viac-zaskleniový plánom — #468: "posuv" → "zasklenie" v user-facing labeloch.
// Patrik 2026-07-28: má ťahať SYSTÉM, nie paušálne „Zimná záhrada".
// Display-only, Money odpis sa tým nemení.
import { describe, it, expect } from 'vitest';
import { popisMulti, posuvySlovom, zaskleniaSlovom } from '../src/lib/popis';

describe('posuvySlovom — slovenské množné číslo (backward compat)', () => {
	it('1 posuv, 2–4 posuvy, 5+ posuvov', () => {
		expect(posuvySlovom(1)).toBe('1 posuv');
		expect(posuvySlovom(2)).toBe('2 posuvy');
		expect(posuvySlovom(3)).toBe('3 posuvy');
		expect(posuvySlovom(4)).toBe('4 posuvy');
		expect(posuvySlovom(5)).toBe('5 posuvov');
		expect(posuvySlovom(12)).toBe('12 posuvov');
	});
});

describe('zaskleniaSlovom — slovenské množné číslo (#468)', () => {
	it('1 zasklenie, 2–4 zasklenia, 5+ zasklení', () => {
		expect(zaskleniaSlovom(1)).toBe('1 zasklenie');
		expect(zaskleniaSlovom(2)).toBe('2 zasklenia');
		expect(zaskleniaSlovom(3)).toBe('3 zasklenia');
		expect(zaskleniaSlovom(4)).toBe('4 zasklenia');
		expect(zaskleniaSlovom(5)).toBe('5 zasklení');
		expect(zaskleniaSlovom(12)).toBe('12 zasklení');
	});
});

describe('popisMulti — badge ťahá názov systému + počet ZASKLENÍ (#468)', () => {
	it('KĽÚČOVÉ: 3× Štandard + → „Štandard plus · 3 zasklenia" (nie „posuvy")', () => {
		const p = [{ system: 'Štandard +' }, { system: 'Štandard +' }, { system: 'Štandard +' }];
		expect(popisMulti(p)).toBe('Štandard plus · 3 zasklenia');
		expect(popisMulti(p)).not.toContain('posuvy');
		expect(popisMulti(p)).not.toContain('Zimná záhrada');
	});

	it('jeden systém sa neopakuje, aj keď je zasklení veľa', () => {
		const p = Array.from({ length: 6 }, () => ({ system: 'Robust' }));
		expect(popisMulti(p)).toBe('Robust · 6 zasklení');
	});

	it('zmiešané systémy sa vypíšu všetky v poradí zasklení', () => {
		expect(popisMulti([{ system: 'Štandard +' }, { system: 'Robust' }, { system: 'Slide' }])).toBe(
			'Štandard plus, Robust, Slide · 3 zasklenia'
		);
	});

	it('starý systém „Štandard" (bez plus) sa nezlúči so „Štandard +"', () => {
		expect(popisMulti([{ system: 'Štandard' }, { system: 'Štandard +' }])).toBe(
			'Starý štandard, Štandard plus · 2 zasklenia'
		);
	});

	it('prázdny/chýbajúci systém nezhodí popis — fallback „Zasklenia"', () => {
		expect(popisMulti([{ system: '' }, { system: '' }])).toBe('Zasklenia · 2 zasklenia');
		expect(popisMulti([])).toBe('Zasklenia · 0 zasklení');
	});
});
