// Predvolené sklo = vždy ČÍRE (Patrik 2026-07-27) + formát rozmeru skla na
// objednávku („1050mm × 2115mm").
//
// Kľúčová vec, ktorú test STRÁŽI: zmena predvoľby NESMIE zmeniť Money odpis.
// Sklo vstupuje do výpočtu jediným kanálom — `redukciaZero` (sklozávislé riadky),
// plus `hrubka` pri Deluxe. Test preto pre KAŽDÝ systém+štýl porovná odpis
// spočítaný pôvodnou predvoľbou (prvé sklo v katalógu) s odpisom spočítaným
// novou predvoľbou (číre) a musia byť IDENTICKÉ.
import { describe, it, expect } from 'vitest';
import { defaultSklo, fmtSkloRozmer } from '../src/lib/sklo';
import { buildCFG, computeFlat, type SysRow, type RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

// katalóg skiel v poradí, v akom ho appka ponúka (poradie ASC), podľa systému —
// zrkadlí prod stav glass_types (overené čítaním ostrej DB 2026-07-27)
const KATALOG: Record<string, { nazov: string; redukciaZero: boolean; hrubka: number }[]> = {
	Robust: [
		{ nazov: 'Izolačné sklo 4/16/4 mliečne', redukciaZero: false, hrubka: 0 },
		{ nazov: 'Izolačné sklo 4/16/4 číre', redukciaZero: true, hrubka: 0 },
		{ nazov: 'Kalené 8mm', redukciaZero: false, hrubka: 0 },
		{ nazov: 'Kalené 10mm', redukciaZero: false, hrubka: 0 }
	],
	Slide: [
		{ nazov: 'Izolačné sklo 4/8/4 mliečne', redukciaZero: true, hrubka: 0 },
		{ nazov: 'Izolačné sklo 4/8/4 číre', redukciaZero: true, hrubka: 0 },
		{ nazov: '6mm číre', redukciaZero: false, hrubka: 0 },
		{ nazov: '6mm mliečne', redukciaZero: false, hrubka: 0 },
		{ nazov: '3.3.1', redukciaZero: false, hrubka: 0 }
	],
	Deluxe: [
		{ nazov: 'Float kalené 6 mm', redukciaZero: false, hrubka: 6 },
		{ nazov: 'Float kalené 10 mm', redukciaZero: false, hrubka: 10 }
	],
	'Štandard +': [
		{ nazov: 'Float sklo 4 mm', redukciaZero: false, hrubka: 0 },
		{ nazov: 'Float sklo 6 mm', redukciaZero: false, hrubka: 0 },
		{ nazov: 'Float sklo 10 mm', redukciaZero: false, hrubka: 0 },
		{ nazov: 'Izolačné sklo 4.8.4', redukciaZero: true, hrubka: 0 }
	]
};

describe('defaultSklo — predvoľba je vždy číre', () => {
	it('Robust: 4/16/4 číre (nie mliečne, ktoré je prvé v katalógu)', () => {
		const zoznam = KATALOG.Robust!.map((g) => g.nazov);
		expect(zoznam[0]).toBe('Izolačné sklo 4/16/4 mliečne'); // pôvodná predvoľba
		expect(defaultSklo(zoznam)).toBe('Izolačné sklo 4/16/4 číre');
	});

	it('Slide: 4/8/4 číre (štandardná skladba bez redukcie — Patrik)', () => {
		expect(defaultSklo(KATALOG.Slide!.map((g) => g.nazov))).toBe('Izolačné sklo 4/8/4 číre');
	});

	it('systém bez „číre" v názvoch → prvé sklo v katalógu (Deluxe, Štandard +)', () => {
		expect(defaultSklo(KATALOG.Deluxe!.map((g) => g.nazov))).toBe('Float kalené 6 mm');
		expect(defaultSklo(KATALOG['Štandard +']!.map((g) => g.nazov))).toBe('Float sklo 4 mm');
	});

	it('prázdny zoznam nespadne (vráti prázdny string)', () => {
		expect(defaultSklo([])).toBe('');
	});

	it('nezávisí od velkosti písmen ani od pozície slova', () => {
		expect(defaultSklo(['Kalené 8mm', 'ČÍRE sklo 6mm'])).toBe('ČÍRE sklo 6mm');
	});
});

describe('Money-neutralita: nová predvoľba nemení ani jeden odpisový riadok', () => {
	const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);
	const rozmery: [number, number][] = [
		[3000, 2000],
		[5000, 2200],
		[4645, 2320]
	];

	for (const sysStyl of Object.keys(cfg)) {
		const system = sysStyl.split('|')[0];
		const katalog = KATALOG[system!];
		if (!katalog) continue;
		const stare = katalog[0]!;
		const nove = katalog.find((g) => g.nazov === defaultSklo(katalog.map((x) => x.nazov)))!;

		it(`${sysStyl}: odpis pri „${stare.nazov}" == odpis pri „${nove.nazov}"`, () => {
			for (const [S, V] of rozmery) {
				const a = computeFlat(cfg, sysStyl, S, V, stare.redukciaZero, stare.hrubka);
				const b = computeFlat(cfg, sysStyl, S, V, nove.redukciaZero, nove.hrubka);
				// Deluxe: hrúbka skla VYBERÁ kladku/klzný profil, takže tam sa 6 vs 10 mm
				// líšiť MÔŽE — predvoľba však ostáva prvé sklo (6 mm), teda tá istá.
				if (system === 'Deluxe') expect(nove.nazov).toBe(stare.nazov);
				expect(a === null).toBe(b === null);
				if (!a || !b) continue;
				expect(b.odpis, `${sysStyl} ${S}×${V}`).toEqual(a.odpis);
			}
		});
	}
});

describe('fmtSkloRozmer — kopírovateľný rozmer na objednávku skla', () => {
	it('jednotka hneď za číslom, medzera × medzera', () => {
		expect(fmtSkloRozmer(1050, 2115)).toBe('1050mm × 2115mm');
		expect(fmtSkloRozmer(1445, 2115)).toBe('1445mm × 2115mm');
	});

	it('sklo sa objednáva na celé mm → zaokrúhli', () => {
		expect(fmtSkloRozmer(904.578, 2049.5)).toBe('905mm × 2050mm');
	});
});
