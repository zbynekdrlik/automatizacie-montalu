// #522: `buildRozpisLines` — appková polovica kontraktu montalu_narezak_upload `lines`
// (odoo-erp #6517/#6949). Mapuje PlanRezovVysledok → montalu.rozpis.line[] pre tablet
// „Čo rezať". Čisté, Money-neutrálne, testovateľné v izolácii (žiadny db, žiadny Odoo).
//
// Zdroj pravdy = `spocitajPlanRezov` (ten istý vysledok, z ktorého ide PDF aj detail),
// preto testy stavajú vysledok cez REÁLNY compute a overujú PRESNÉ `lines` JSON vrátane
// prevodu mm → m.
import { describe, it, expect } from 'vitest';
import { spocitajPlanRezov, type PlanRezovVysledok } from '../src/lib/server/plan-rezov';
import { parsePlanRezov as parse } from '../src/lib/server/plan-rezov-vstup';
import { buildRozpisLines } from '../src/lib/server/odoo-rozpis-lines';

function vysledokZCad(cad: string, dlzkaTyce = 6000, reznaMedzera = 4): PlanRezovVysledok {
	const { riadky, preskocene } = parse(cad);
	return spocitajPlanRezov({ dlzkaTyce, reznaMedzera, riadky }, preskocene);
}

describe('buildRozpisLines — mapovanie PlanRezovVysledok → montalu.rozpis.line', () => {
	it('jeden riadok na (profil × dĺžka), mnozstvo = počet kusov, mj = ks, dlzka v metroch', () => {
		const v = vysledokZCad('STABILIZAČNÝ PROFIL 100X50\t3\t2000\nLAT 80x19\t4\t1865');
		const lines = buildRozpisLines(v);
		expect(lines).toEqual([
			{
				kod: '',
				nazov: 'STABILIZAČNÝ PROFIL 100X50',
				mnozstvo: 3,
				mj: 'ks',
				dlzka: 2,
				poznamka: ''
			},
			{ kod: '', nazov: 'LAT 80x19', mnozstvo: 4, mj: 'ks', dlzka: 1.865, poznamka: '' }
		]);
	});

	it('profil s viacerými dĺžkami → viac riadkov, zoradené zostupne podľa dĺžky', () => {
		const v = vysledokZCad('PROFIL X\t2\t4500\nPROFIL X\t3\t2100');
		const lines = buildRozpisLines(v);
		expect(lines).toEqual([
			{ kod: '', nazov: 'PROFIL X', mnozstvo: 2, mj: 'ks', dlzka: 4.5, poznamka: '' },
			{ kod: '', nazov: 'PROFIL X', mnozstvo: 3, mj: 'ks', dlzka: 2.1, poznamka: '' }
		]);
	});

	it('prevod mm → m zachová 0.1 mm presnosť (2834.5 mm → 2.8345 m)', () => {
		const v = vysledokZCad('PROFIL Z\t1\t2834,5');
		const lines = buildRozpisLines(v);
		expect(lines).toHaveLength(1);
		expect(lines[0]!.dlzka).toBe(2.8345);
	});

	it('prázdny vysledok → žiadne riadky', () => {
		const v = vysledokZCad('');
		expect(buildRozpisLines(v)).toEqual([]);
	});

	it('rezy dlhšie ako tyč (tooLong) nevytvoria riadok (nedajú sa narezať zo zadanej tyče)', () => {
		// 7000 mm > tyč 6000 mm → tooLong; profil nemá žiadny narezateľný kus → 0 riadkov
		const v = vysledokZCad('PROFIL Y\t1\t7000');
		expect(buildRozpisLines(v)).toEqual([]);
		// istota: compute to naozaj označilo ako tooLong
		expect(v.tooLong.length).toBeGreaterThan(0);
	});

	it('kombinácia narezateľných + tooLong: len narezateľné idú do riadkov', () => {
		const v = vysledokZCad('PROFIL W\t2\t3000\nPROFIL W\t1\t9000');
		const lines = buildRozpisLines(v);
		expect(lines).toEqual([
			{ kod: '', nazov: 'PROFIL W', mnozstvo: 2, mj: 'ks', dlzka: 3, poznamka: '' }
		]);
	});
});
