// Štandard +: nárezák (basic vs IZO) vyberá SKLO, nie štýl (Patrik 2026-07-27).
//
// Čo test stráži:
//  1. mapovanie štýl+sklo → sysStyl (vrátane opony, ktorá IZO nemá)
//  2. že ostatné systémy (Robust/Slide/Deluxe) zostávajú 1:1 — žiadny cudzí odpis
//  3. Money: cesta cez sklo dá PRESNE ten istý odpis ako pôvodný explicitný štýl
//     „4K IZO" (t.j. neprepisujeme vzorce, len vyberáme existujúcu konfiguráciu)
import { describe, it, expect } from 'vitest';
import {
	STANDARD_PLUS as STANDARD,
	STANDARD as STANDARD_STARY,
	jeIzoSklo,
	zakladnyStyl,
	jeOponaStyl,
	sysStylPre,
	stylyDoPonuky,
	sklaDoPonuky
} from '../src/lib/styl';
import { buildCFG, computeFlat, type SysRow, type RezRow } from '../src/lib/server/compute';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);
const IZO = 'Izolačné sklo 4.8.4';
const FLOAT = 'Float sklo 6 mm';
/** rozširujúci „U" profil — je LEN v IZO variante, takže je dôkazom, ktorý nárezák sa ťahal */
const U_PROFIL = 'ZASP202439';
/** existencia nárezáka = presne to, čo vidí server aj klient (cfg / data.styly) */
const existuje = (sysStyl: string) => !!cfg[sysStyl];

const kody = (sysStyl: string, S = 3000, V = 2400) =>
	computeFlat(cfg, sysStyl, S, V, false)!.odpis.map((o) => o.kod);
const odpis = (sysStyl: string, S = 3000, V = 2400) =>
	computeFlat(cfg, sysStyl, S, V, false)!.odpis;

describe('sysStylPre — sklo vyberá nárezák', () => {
	it('Štandard + basic: izolačné sklo → IZO nárezák, float → basic', () => {
		expect(sysStylPre(STANDARD, '4K', IZO, existuje)).toBe('Štandard +|4K IZO');
		expect(sysStylPre(STANDARD, '4K', FLOAT, existuje)).toBe('Štandard +|4K');
		for (const n of ['2K', '3K', '4K', '5K', '6K']) {
			expect(sysStylPre(STANDARD, n, IZO, existuje)).toBe(`Štandard +|${n} IZO`);
			expect(cfg[sysStylPre(STANDARD, n, IZO, existuje)]).toBeDefined();
			expect(cfg[sysStylPre(STANDARD, n, FLOAT, existuje)]).toBeDefined();
		}
	});

	it('starý uložený štýl „4K IZO" sa riadi sklom, nie príponou', () => {
		// späť-a-uprav / zabookmarkovaný POST: štýl ešte nesie IZO, ale sklo je float
		expect(sysStylPre(STANDARD, '4K IZO', FLOAT, existuje)).toBe('Štandard +|4K');
		expect(sysStylPre(STANDARD, '4K IZO', IZO, existuje)).toBe('Štandard +|4K IZO');
		// a nikdy nevznikne dvojité „IZO IZO" (neexistujúci nárezák)
		expect(cfg[sysStylPre(STANDARD, '4K IZO', IZO, existuje)]).toBeDefined();
	});

	it('Štandard + opona IZO variant NEMÁ — ostáva basic aj s izolačným sklom', () => {
		for (const n of ['2x2K', '2x3K', '2x4K']) {
			expect(sysStylPre(STANDARD, n, IZO, existuje)).toBe(`Štandard +|${n}`);
			expect(cfg[`Štandard +|${n} IZO`]).toBeUndefined();
		}
	});

	it('starší Štandard opona IZO variant MÁ — izolačné sklo ho vyberie', () => {
		for (const n of ['2x2K', '2x3K', '2x4K']) {
			expect(sysStylPre(STANDARD_STARY, n, IZO, existuje)).toBe(`Štandard|${n} IZO`);
			expect(sysStylPre(STANDARD_STARY, n, FLOAT, existuje)).toBe(`Štandard|${n}`);
			expect(cfg[`Štandard|${n} IZO`]).toBeDefined();
		}
	});

	it('starší Štandard basic 2K/3K/4K sa riadi sklom rovnako', () => {
		for (const n of ['2K', '3K', '4K']) {
			expect(sysStylPre(STANDARD_STARY, n, IZO, existuje)).toBe(`Štandard|${n} IZO`);
			expect(sysStylPre(STANDARD_STARY, n, FLOAT, existuje)).toBe(`Štandard|${n}`);
		}
		// 5K/6K starší Štandard nemá → izolačné sklo nesmie vyrobiť neexistujúci nárezák
		expect(cfg['Štandard|5K']).toBeUndefined();
	});

	it('ostatné systémy sa nemenia — každý seed štýl mapuje sám na seba', () => {
		for (const s of seed.sys as SysRow[]) {
			const [system, styl] = s.sysStyl.split('|');
			if (system === STANDARD || system === STANDARD_STARY) continue;
			for (const sklo of ['Izolačné sklo 4/16/4 číre', 'Kalené 8mm', '6mm číre'])
				expect(sysStylPre(system, styl, sklo, existuje)).toBe(s.sysStyl);
		}
	});

	it('pomocné predikáty', () => {
		expect(jeIzoSklo(IZO)).toBe(true);
		expect(jeIzoSklo(FLOAT)).toBe(false);
		expect(zakladnyStyl('6K IZO')).toBe('6K');
		expect(zakladnyStyl('6K')).toBe('6K');
		expect(jeOponaStyl('2x3K')).toBe(true);
		expect(jeOponaStyl('3K')).toBe(false);
	});
});

describe('ponuky vo formulári', () => {
	const styly = (seed.sys as SysRow[])
		.filter((s) => s.sysStyl.startsWith(STANDARD + '|'))
		.map((s) => s.sysStyl.split('|')[1]);

	it('Štandard + ponúka len počty krídel — žiadny štýl s „IZO"', () => {
		const p = stylyDoPonuky(STANDARD, styly);
		expect(p.some((s) => /IZO/i.test(s))).toBe(false);
		expect(p).toEqual(
			expect.arrayContaining(['2K', '3K', '4K', '5K', '6K', '2x2K', '2x3K', '2x4K'])
		);
		expect(new Set(p).size).toBe(p.length); // bez duplicít
	});

	it('iný systém má ponuku štýlov nedotknutú', () => {
		const robust = ['2K', '3K', '4K', '2x2K'];
		expect(stylyDoPonuky('Robust', robust)).toEqual(robust);
	});

	it('opona neponúka izolačné sklo, basic áno', () => {
		const skla = ['Float sklo 4 mm', FLOAT, 'Float sklo 10 mm', IZO];
		expect(sklaDoPonuky(STANDARD, '2x3K', skla, existuje)).not.toContain(IZO);
		expect(sklaDoPonuky(STANDARD, '4K', skla, existuje)).toContain(IZO);
		// starší Štandard IZO oponu MÁ → izolačné sklo v ponuke ostáva
		expect(sklaDoPonuky(STANDARD_STARY, '2x3K', skla, existuje)).toContain(IZO);
		expect(sklaDoPonuky('Slide', '2x3K', ['Izolačné sklo 4/8/4 číre'], existuje)).toContain(
			'Izolačné sklo 4/8/4 číre'
		);
	});
});

describe('Money: výber sklom dá PRESNE ten istý odpis ako pôvodný IZO štýl', () => {
	it('4K + izolačné = nárezák „4K IZO" (vrátane U profilu), 4K + float = basic', () => {
		const izo = odpis(sysStylPre(STANDARD, '4K', IZO, existuje));
		expect(izo).toEqual(odpis('Štandard +|4K IZO'));
		expect(izo.map((o) => o.kod)).toContain(U_PROFIL);

		const basic = odpis(sysStylPre(STANDARD, '4K', FLOAT, existuje));
		expect(basic).toEqual(odpis('Štandard +|4K'));
		expect(basic.map((o) => o.kod)).not.toContain(U_PROFIL);
		// a naozaj sú to DVE rôzne skladby (inak by test nič nestrážil)
		expect(izo).not.toEqual(basic);
	});

	it('pre každý počet krídel platí to isté (2K…6K)', () => {
		for (const n of ['2K', '3K', '4K', '5K', '6K']) {
			expect(kody(sysStylPre(STANDARD, n, IZO, existuje))).toContain(U_PROFIL);
			expect(kody(sysStylPre(STANDARD, n, FLOAT, existuje))).not.toContain(U_PROFIL);
			expect(odpis(sysStylPre(STANDARD, n, IZO, existuje))).toEqual(odpis(`Štandard +|${n} IZO`));
		}
	});

	it('opona s izolačným sklom NEZmení odpis (žiadny IZO nárezák neexistuje)', () => {
		for (const n of ['2x2K', '2x3K', '2x4K'])
			expect(odpis(sysStylPre(STANDARD, n, IZO, existuje))).toEqual(odpis(`Štandard +|${n}`));
	});
});
