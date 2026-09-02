// Predvolené sklo = vždy ČÍRE (Patrik 2026-07-27), Deluxe = 10 mm (Patrik #431)
// + formát rozmeru skla na objednávku („1050mm × 2115mm").
//
// Kľúčová vec, ktorú test STRÁŽI: zmena predvoľby NESMIE zmeniť Money odpis —
// PLATÍ pre všetky systémy OKREM Deluxe. Sklo vstupuje do výpočtu jediným kanálom
// — `redukciaZero` (sklozávislé riadky), plus `hrubka` pri Deluxe. Test preto pre
// KAŽDÝ systém+štýl porovná odpis spočítaný pôvodnou predvoľbou (prvé sklo) s
// odpisom novou predvoľbou (číre) a musia byť IDENTICKÉ. VÝNIMKA Deluxe (#431):
// predvoľba sa zámerne presunula 6→10 mm a 10 mm dáva INÝ (úplnejší) odpis, takže
// pre Deluxe neutralita neplatí — over sa len, že predvoľba je naozaj 10 mm.
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

	it('Deluxe: primárne sklo 10 mm (Patrik #431 — predtým prvé v poradí = 6 mm)', () => {
		const zoznam = KATALOG.Deluxe!.map((g) => g.nazov);
		expect(zoznam[0]).toBe('Float kalené 6 mm'); // prvé v poradí (pôvodná predvoľba)
		expect(defaultSklo(zoznam, 'Deluxe')).toBe('Float kalené 10 mm');
	});

	it('systém bez „číre" a bez Deluxe-pravidla → prvé sklo v katalógu (Štandard +)', () => {
		expect(
			defaultSklo(
				KATALOG['Štandard +']!.map((g) => g.nazov),
				'Štandard +'
			)
		).toBe('Float sklo 4 mm');
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
		const nove = katalog.find(
			(g) =>
				g.nazov ===
				defaultSklo(
					katalog.map((x) => x.nazov),
					system
				)
		)!;

		it(`${sysStyl}: predvoľba nemení odpis${system === 'Deluxe' ? ' (Deluxe #431: predvoľba = 10 mm, odpis sa ZÁMERNE líši)' : ` (predvoľba „${nove.nazov}")`}`, () => {
			for (const [S, V] of rozmery) {
				// Deluxe: predvoľba sa #431 (Patrik 2026-09-02) presunula z prvého skla
				// (6 mm) na 10 mm. 10 mm VYBERÁ iný kladka/klzný profil A pridá 10 mm
				// krytky, takže odpis sa oproti 6 mm ZÁMERNE líši — Money-neutralita
				// „predvoľba nemení odpis" pre Deluxe už neplatí (obsluha stále volí sklo;
				// odpis pre KONKRÉTNE sklo je nezmenený). Over len, že predvoľba je 10 mm.
				if (system === 'Deluxe') {
					expect(nove.nazov).toBe('Float kalené 10 mm');
					continue;
				}
				const a = computeFlat(cfg, sysStyl, S, V, stare.redukciaZero, stare.hrubka);
				const b = computeFlat(cfg, sysStyl, S, V, nove.redukciaZero, nove.hrubka);
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
