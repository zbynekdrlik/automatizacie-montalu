// Dodatočná sieťka BEZ posuvu (#89 — Patrik: „90% si kúpi posuv a sieťku chce
// až potom"). Modul nezapisuje do Money nič (rovnaký princíp ako fix-vstup.ts) —
// tu strážime len parsovanie a rozsahovú validáciu vstupu.
import { describe, it, expect } from 'vitest';
import { parseSietkaSamostatnaVstup } from '../src/lib/server/sietka-samostatna';

const fd = (o: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	return f;
};
const zaklad = {
	zak: 'ZAK1',
	op: 'OP1',
	zakaznik: 'X',
	system: 'Robust',
	styl: '3K',
	otvorS: '2000',
	otvorV: '1500'
};

describe('parseSietkaSamostatnaVstup', () => {
	it('platný vstup bez zadaného rozmeru sieťky (dielňa doplní)', () => {
		const { vstup, error } = parseSietkaSamostatnaVstup(fd(zaklad));
		expect(error).toBeNull();
		expect(vstup.system).toBe('Robust');
		expect(vstup.styl).toBe('3K');
		expect(vstup.otvorS).toBe(2000);
		expect(vstup.otvorV).toBe(1500);
		expect(vstup.sietka).toEqual({ sirka: null, vyska: null, uchyt: 'ziadny' });
	});

	it('platný vstup s rozmerom sieťky a úchytom', () => {
		const { vstup, error } = parseSietkaSamostatnaVstup(
			fd({ ...zaklad, sietkaSirka: '1900', sietkaVyska: '1400', sietkaUchyt: 'zamok' })
		);
		expect(error).toBeNull();
		expect(vstup.sietka).toEqual({ sirka: 1900, vyska: 1400, uchyt: 'zamok' });
	});

	it('Slide je tiež platný systém', () => {
		const { vstup, error } = parseSietkaSamostatnaVstup(fd({ ...zaklad, system: 'Slide' }));
		expect(error).toBeNull();
		expect(vstup.system).toBe('Slide');
	});

	it('chýbajúce povinné polia hlásia chybu', () => {
		expect(parseSietkaSamostatnaVstup(fd({ ...zaklad, zak: '' })).error).toMatch(/ZAK/);
		expect(parseSietkaSamostatnaVstup(fd({ ...zaklad, op: '' })).error).toMatch(/OP/);
		expect(parseSietkaSamostatnaVstup(fd({ ...zaklad, zakaznik: '' })).error).toMatch(/zákazník/);
	});

	it('systém mimo Robust/Slide (napr. skriptovaný POST) je odmietnutý', () => {
		expect(parseSietkaSamostatnaVstup(fd({ ...zaklad, system: 'Deluxe' })).error).toMatch(/systém/);
	});

	it('chýbajúci štýl je odmietnutý', () => {
		expect(parseSietkaSamostatnaVstup(fd({ ...zaklad, styl: '' })).error).toMatch(/štýl/);
	});

	it('rozmery otvoru mimo rozsahu sú odmietnuté', () => {
		expect(parseSietkaSamostatnaVstup(fd({ ...zaklad, otvorS: '100' })).error).toMatch(
			/Šírka otvoru/
		);
		expect(parseSietkaSamostatnaVstup(fd({ ...zaklad, otvorV: '100' })).error).toMatch(
			/Výška otvoru/
		);
	});

	it('nezmyselný rozmer sieťky je odmietnutý (skriptovaný POST obíde HTML5)', () => {
		expect(parseSietkaSamostatnaVstup(fd({ ...zaklad, sietkaSirka: '-5' })).error).toMatch(/šírka/);
	});
});
