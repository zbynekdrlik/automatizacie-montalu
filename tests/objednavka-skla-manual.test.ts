// #545: ručné riadky (modul='manual') + samostatná objednávka len skla (pole OP bez odpisu).
// Money-NEUTRÁLNE (objednávka u dodávateľa skla, žiadny odpis). DB je zdieľaná — každý test
// používa unikátne číslo zákazky, aby sa neovplyvňovali.
import { describe, it, expect } from 'vitest';
import { db } from '../src/lib/server/db';
import { modulNazov } from '../src/lib/modul-nazov';
import {
	pridajSkloManual,
	nastavOpZakazky,
	opPodkladu,
	listSklaPreZakazku
} from '../src/lib/server/objednavka-skla';

describe('#545 pridajSkloManual — ručný riadok objednávky skla', () => {
	it('uloží modul=manual, m2 = š×v×ks/1e6 a režim atyp', () => {
		const zak = 'ZAK-545-MAN-A';
		const id = pridajSkloManual({
			zak,
			popis: 'ATYP podľa výkresu',
			typSkla: 'Izolačné sklo 4/16/4 číre',
			sirkaMm: 1000,
			vyskaMm: 500,
			pocet: 3,
			rezim: 'atyp',
			createdBy: 'test'
		});
		expect(id).toBeGreaterThan(0);

		const rows = listSklaPreZakazku(zak);
		expect(rows).toHaveLength(1);
		const r = rows[0]!;
		expect(r.modul).toBe('manual');
		expect(r.popis).toBe('ATYP podľa výkresu');
		expect(r.typSkla).toBe('Izolačné sklo 4/16/4 číre');
		expect(r.sirkaMm).toBe(1000);
		expect(r.vyskaMm).toBe(500);
		expect(r.pocet).toBe(3);
		expect(r.rezim).toBe('atyp');
		// m2 = 1000 * 500 * 3 / 1e6 = 1.5
		expect(r.m2).toBeCloseTo(1.5, 6);
	});

	it('režim rozmery uloží rozmery (default)', () => {
		const zak = 'ZAK-545-MAN-R';
		pridajSkloManual({
			zak,
			popis: 'V.O.',
			typSkla: 'Float 4',
			sirkaMm: 314,
			vyskaMm: 365,
			pocet: 2,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		const r = listSklaPreZakazku(zak)[0]!;
		expect(r.rezim).toBe('rozmery');
		expect(r.m2).toBeCloseTo((314 * 365 * 2) / 1e6, 6);
	});

	it('prázdny typ skla → throw, nič sa neuloží', () => {
		const zak = 'ZAK-545-MAN-NOTYP';
		expect(() =>
			pridajSkloManual({
				zak,
				popis: 'x',
				typSkla: '   ',
				sirkaMm: 1000,
				vyskaMm: 1000,
				pocet: 1,
				rezim: 'rozmery',
				createdBy: 'test'
			})
		).toThrow();
		expect(listSklaPreZakazku(zak)).toHaveLength(0);
	});

	it('neplatné rozmery / počet → throw', () => {
		const base = {
			zak: 'ZAK-545-MAN-DIM',
			popis: 'x',
			typSkla: 'Float 4',
			rezim: 'rozmery' as const,
			createdBy: 'test'
		};
		expect(() => pridajSkloManual({ ...base, sirkaMm: 0, vyskaMm: 1000, pocet: 1 })).toThrow();
		expect(() => pridajSkloManual({ ...base, sirkaMm: 1000, vyskaMm: -5, pocet: 1 })).toThrow();
		expect(() => pridajSkloManual({ ...base, sirkaMm: 1000, vyskaMm: 1000, pocet: 0 })).toThrow();
		expect(() => pridajSkloManual({ ...base, sirkaMm: 1000.5, vyskaMm: 1000, pocet: 1 })).toThrow();
		expect(listSklaPreZakazku('ZAK-545-MAN-DIM')).toHaveLength(0);
	});

	it('MODUL_NAZVY.manual = „Pridané položky"', () => {
		expect(modulNazov('manual')).toBe('Pridané položky');
	});

	// #546: pergola honest-null vetva používa `pridajSkloManual` s `modul='pergola'` override,
	// aby operátorom zadané strešné sklo pristálo v sekcii „Pergola" (nie „Pridané položky").
	it('modul override → riadok pristane pod zadaným modulom (default ostáva manual)', () => {
		const zakDef = 'ZAK-546-MOD-DEF';
		pridajSkloManual({
			zak: zakDef,
			popis: 'x',
			typSkla: 'Float 4',
			sirkaMm: 1000,
			vyskaMm: 1000,
			pocet: 1,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		expect(listSklaPreZakazku(zakDef)[0]!.modul).toBe('manual');

		const zakPerg = 'ZAK-546-MOD-PERG';
		pridajSkloManual({
			zak: zakPerg,
			modul: 'pergola',
			popis: 'Strešné sklo — 4.4.2 číre',
			typSkla: '4.4.2 číre',
			sirkaMm: 1200,
			vyskaMm: 900,
			pocet: 2,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		const r = listSklaPreZakazku(zakPerg)[0]!;
		expect(r.modul).toBe('pergola');
		expect(r.popis).toBe('Strešné sklo — 4.4.2 číre');
		expect(modulNazov(r.modul)).toBe('Pergola');
	});
});

describe('#545 nastavOpZakazky — jedno OP pre celý podklad', () => {
	it('zapíše (normalizované) OP do VŠETKÝCH riadkov zákazky', () => {
		const zak = 'ZAK-545-OP-ALL';
		pridajSkloManual({
			zak,
			popis: 'A',
			typSkla: 'Float 4',
			sirkaMm: 1000,
			vyskaMm: 1000,
			pocet: 1,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		pridajSkloManual({
			zak,
			popis: 'B',
			typSkla: 'Float 4',
			sirkaMm: 500,
			vyskaMm: 500,
			pocet: 2,
			rezim: 'atyp',
			createdBy: 'test'
		});

		const op = nastavOpZakazky(zak, '260545'); // normOp → OP260545
		expect(op).toBe('OP260545');

		const rows = listSklaPreZakazku(zak);
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.op === 'OP260545')).toBe(true);
	});

	it('prázdne / neplatné OP → throw', () => {
		expect(() => nastavOpZakazky('ZAK-545-OP-BAD', '   ')).toThrow();
	});
});

describe('#545 opPodkladu — spoločné OP riadkov podkladu', () => {
	it('žiadne OP → prázdny reťazec', () => {
		const zak = 'ZAK-545-POD-NONE';
		pridajSkloManual({
			zak,
			popis: 'A',
			typSkla: 'Float 4',
			sirkaMm: 1000,
			vyskaMm: 1000,
			pocet: 1,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		expect(opPodkladu(zak)).toBe('');
	});

	it('jednotné OP → to OP', () => {
		const zak = 'ZAK-545-POD-ONE';
		pridajSkloManual({
			zak,
			popis: 'A',
			typSkla: 'Float 4',
			sirkaMm: 1000,
			vyskaMm: 1000,
			pocet: 1,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		nastavOpZakazky(zak, 'OP260600');
		expect(opPodkladu(zak)).toBe('OP260600');
	});

	it('rozdielne OP na riadkoch → null (mixed)', () => {
		const zak = 'ZAK-545-POD-MIX';
		const a = pridajSkloManual({
			zak,
			popis: 'A',
			typSkla: 'Float 4',
			sirkaMm: 1000,
			vyskaMm: 1000,
			pocet: 1,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		const b = pridajSkloManual({
			zak,
			popis: 'B',
			typSkla: 'Float 4',
			sirkaMm: 500,
			vyskaMm: 500,
			pocet: 1,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		// rozdielnosť OP na riadkoch simulujeme priamym UPDATE (nastavOpZakazky je hromadné,
		// takže cez public API by rozdielne OP nevznikli — to je práve invariant, ktorý stráži).
		db.prepare('UPDATE objednavka_skla SET op = ? WHERE id = ?').run('OP111111', a);
		db.prepare('UPDATE objednavka_skla SET op = ? WHERE id = ?').run('OP222222', b);
		expect(opPodkladu(zak)).toBeNull();
	});
});
