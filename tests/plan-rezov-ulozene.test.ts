// #505: CRUD testy pre plan-rezov-ulozene.ts — vzor objednavka-skla.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/lib/server/db';
import { ulozPlan, listPlany, getPlan, zmazPlan } from '../src/lib/server/plan-rezov-ulozene';

// Clean slate pred každým testom
beforeEach(() => {
	db.prepare('DELETE FROM plan_rezov_ulozene').run();
});

describe('plan-rezov-ulozene CRUD (#505)', () => {
	it('ulozPlan vloží riadok a vráti id', () => {
		const id = ulozPlan({
			nazov: 'Brány vstup',
			zak: 'ZAK-001',
			cadText: 'PROFIL 100X50\t2\t5330\nPROFIL 100X50\t1\t1550',
			dlzkaTyce: 6000,
			reznaMedzera: 4,
			createdBy: 'dominik'
		});
		expect(id).toBeGreaterThan(0);

		const row = getPlan(id);
		expect(row).not.toBeNull();
		expect(row!.nazov).toBe('Brány vstup');
		expect(row!.zak).toBe('ZAK-001');
		expect(row!.cadText).toBe('PROFIL 100X50\t2\t5330\nPROFIL 100X50\t1\t1550');
		expect(row!.dlzkaTyce).toBe(6000);
		expect(row!.reznaMedzera).toBe(4);
		expect(row!.createdBy).toBe('dominik');
		expect(row!.createdAt).toBeTruthy();
	});

	it('ulozPlan s prázdnym zak uloží prázdny reťazec', () => {
		const id = ulozPlan({
			nazov: 'Test bez zákazky',
			cadText: 'X\t1\t1000',
			dlzkaTyce: 7500,
			reznaMedzera: 3,
			createdBy: 'test'
		});
		const row = getPlan(id);
		expect(row!.zak).toBe('');
		expect(row!.dlzkaTyce).toBe(7500);
		expect(row!.reznaMedzera).toBe(3);
	});

	it('listPlany vráti plány zoradené od najnovšieho', () => {
		ulozPlan({
			nazov: 'A',
			cadText: 'X\t1\t1000',
			dlzkaTyce: 6000,
			reznaMedzera: 4,
			createdBy: 'x'
		});
		ulozPlan({
			nazov: 'B',
			cadText: 'Y\t1\t2000',
			dlzkaTyce: 7500,
			reznaMedzera: 4,
			createdBy: 'y'
		});

		const list = listPlany();
		expect(list.length).toBe(2);
		// Novší (B) prvý
		expect(list[0]!.nazov).toBe('B');
		expect(list[1]!.nazov).toBe('A');
		// Prehlad nemá cadText
		expect('cadText' in list[0]!).toBe(false);
	});

	it('getPlan vráti null pre neexistujúce id', () => {
		expect(getPlan(99999)).toBeNull();
	});

	it('zmazPlan odstráni riadok', () => {
		const id = ulozPlan({
			nazov: 'Na zmazanie',
			cadText: 'X\t1\t1000',
			dlzkaTyce: 6000,
			reznaMedzera: 4,
			createdBy: 'test'
		});
		expect(getPlan(id)).not.toBeNull();
		zmazPlan(id);
		expect(getPlan(id)).toBeNull();
	});

	it('zmazPlan na neexistujúcom id nepadne', () => {
		expect(() => zmazPlan(99999)).not.toThrow();
	});
});
