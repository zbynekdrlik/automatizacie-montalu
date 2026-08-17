import { describe, it, expect } from 'vitest';
import { parseOptimalizatorVstup } from '../src/lib/server/optimalizator-vstup';

function fd(entries: [string, string][]): FormData {
	const f = new FormData();
	for (const [k, v] of entries) f.append(k, v);
	return f;
}

describe('parseOptimalizatorVstup', () => {
	it('sparsuje tyč, počet, reznú medzeru a riadky kusov', () => {
		const r = parseOptimalizatorVstup(
			fd([
				['dlzkaTyce', '6000'],
				['pocetTyci', '10'],
				['reznaMedzera', '10'],
				['dlzka', '2834'],
				['pocet', '2'],
				['dlzka', '1390'],
				['pocet', '1']
			])
		);
		expect('error' in r).toBe(false);
		if ('error' in r) return;
		expect(r.vstup.dlzkaTyce).toBe(6000);
		expect(r.vstup.pocetTyci).toBe(10);
		expect(r.vstup.reznaMedzera).toBe(10);
		expect(r.vstup.kusy).toEqual([
			{ dlzka: 2834, pocet: 2 },
			{ dlzka: 1390, pocet: 1 }
		]);
	});

	it('rezná medzera chýba → default 10 mm', () => {
		const r = parseOptimalizatorVstup(
			fd([
				['dlzkaTyce', '6000'],
				['pocetTyci', '5'],
				['dlzka', '1000'],
				['pocet', '1']
			])
		);
		expect('error' in r).toBe(false);
		if ('error' in r) return;
		expect(r.vstup.reznaMedzera).toBe(10);
	});

	it('desatinná čiarka aj medzery v čísle sa akceptujú', () => {
		const r = parseOptimalizatorVstup(
			fd([
				['dlzkaTyce', '6 000'],
				['pocetTyci', '5'],
				['reznaMedzera', '10'],
				['dlzka', '2834,5'],
				['pocet', '1']
			])
		);
		expect('error' in r).toBe(false);
		if ('error' in r) return;
		expect(r.vstup.dlzkaTyce).toBe(6000);
		expect(r.vstup.kusy[0].dlzka).toBeCloseTo(2834.5);
	});

	it('prázdne riadky kusov sa preskočia', () => {
		const r = parseOptimalizatorVstup(
			fd([
				['dlzkaTyce', '6000'],
				['pocetTyci', '5'],
				['reznaMedzera', '10'],
				['dlzka', ''],
				['pocet', ''],
				['dlzka', '1000'],
				['pocet', '3']
			])
		);
		expect('error' in r).toBe(false);
		if ('error' in r) return;
		expect(r.vstup.kusy).toEqual([{ dlzka: 1000, pocet: 3 }]);
	});

	it('chýbajúca/neplatná dĺžka tyče → chyba', () => {
		const r = parseOptimalizatorVstup(
			fd([
				['dlzkaTyce', '0'],
				['pocetTyci', '5'],
				['dlzka', '1000'],
				['pocet', '1']
			])
		);
		expect('error' in r).toBe(true);
	});

	it('neplatný počet tyčí → chyba', () => {
		const r = parseOptimalizatorVstup(
			fd([
				['dlzkaTyce', '6000'],
				['pocetTyci', '0'],
				['dlzka', '1000'],
				['pocet', '1']
			])
		);
		expect('error' in r).toBe(true);
	});

	it('žiadny platný kus → chyba', () => {
		const r = parseOptimalizatorVstup(
			fd([
				['dlzkaTyce', '6000'],
				['pocetTyci', '5'],
				['reznaMedzera', '10']
			])
		);
		expect('error' in r).toBe(true);
	});

	// horné stropy proti OOM/zamrznutiu procesu (review nález #212)
	it('absurdný počet v jednom riadku → chyba (žiadny OOM)', () => {
		const r = parseOptimalizatorVstup(
			fd([
				['dlzkaTyce', '6000'],
				['pocetTyci', '10'],
				['reznaMedzera', '10'],
				['dlzka', '1000'],
				['pocet', '1000000000']
			])
		);
		expect('error' in r).toBe(true);
	});

	it('príliš veľa kusov spolu (nad celkový strop) → chyba', () => {
		const rows: [string, string][] = [
			['dlzkaTyce', '6000'],
			['pocetTyci', '10'],
			['reznaMedzera', '10']
		];
		for (let i = 0; i < 10; i++) {
			rows.push(['dlzka', '1000']);
			rows.push(['pocet', '5000']); // 10×5000 = 50000 > 20000 strop
		}
		const r = parseOptimalizatorVstup(fd(rows));
		expect('error' in r).toBe(true);
	});

	it('absurdná dĺžka tyče alebo počet tyčí → chyba', () => {
		const velkaTyc = parseOptimalizatorVstup(
			fd([
				['dlzkaTyce', '9999999'],
				['pocetTyci', '10'],
				['dlzka', '1000'],
				['pocet', '1']
			])
		);
		expect('error' in velkaTyc).toBe(true);
		const velaTyci = parseOptimalizatorVstup(
			fd([
				['dlzkaTyce', '6000'],
				['pocetTyci', '999999'],
				['dlzka', '1000'],
				['pocet', '1']
			])
		);
		expect('error' in velaTyci).toBe(true);
	});
});
