// Odoo úloha 1459 (Patrik 22.10.2026, naliehavá): „Aj keď nemám koľajnicu navyše aj tak mi ju tam
// dáva" — starý „Štandard" IZO mal prídavnú (o veľkosť väčšiu) SPODNÚ koľajnicu natvrdo vo vzorcoch
// (`cfg_seed.json` `Štandard|*K IZO` poradie 15) a checkbox „Prídavná koľajnica" sa pri ňom vôbec
// neukázal (`plusRailEligible` systém `Štandard` nepoznal). ROZHODNUTÉ (#618 design): starý Štandard
// sa správa ako Štandard + — vo vzorcoch ZÁKLADNÁ spodná koľajnica (rovnaký riadok ako basic štýl),
// prídavnú pridá checkbox (pri IZO predvolene zaškrtnutý), dá sa odškrtnúť.
//
// Money: pri ZAŠKRTNUTOM checkboxe musí byť odpis BIT-IDENTICKÝ s dnešným (kód + názov + metre) —
// vektory nižšie sú dnešné hodnoty zo `standard-stary.test.ts` (S 3000 × V 2400).
import { describe, it, expect } from 'vitest';
import {
	buildCFG,
	computeFlat,
	computeMulti,
	buildPosuvSpec,
	type SysRow,
	type RezRow,
	type PosuvSpecInput
} from '../src/lib/server/compute';
import { plusRailEligible, pridavnaKolajnicaDefault } from '../src/lib/styl';
import { pridavnaJeVSietke } from '../src/lib/sietka';
import seed from '../src/lib/server/cfg_seed.json';

const cfg = buildCFG(seed.sys as SysRow[], seed.rez as RezRow[]);
const IZO = 'Izolačné sklo 4/8/4 číre';

const odpis = (sysStyl: string, pridavna: boolean) => {
	const r = computeFlat(cfg, sysStyl, 3000, 2400, false, 0, pridavna)!;
	const o: Record<string, number> = {};
	r.odpis.forEach((x) => (o[x.kod] = x.metre));
	return o;
};
const spodna = (sysStyl: string, pridavna: boolean) =>
	computeFlat(cfg, sysStyl, 3000, 2400, false, 0, pridavna)!.odpis.filter((o) =>
		/^Koľajnica\s+spodná/.test(o.nazov)
	);

// DNEŠNÉ (pred úlohou 1459) odpisy starého Štandard IZO — natvrdo zväčšená spodná koľajnica
const DNES: Record<string, Record<string, number>> = {
	'Štandard|2K IZO': {
		ZASP00107: 7.5,
		ZASP00030: 7.5,
		ZASP202415: 7.2,
		ZASP00018: 7.5,
		ZASP00024: 7.5,
		ZASP00021: 7.5,
		ZASP202439: 21.6
	},
	'Štandard|3K IZO': {
		ZASP00027: 7.5,
		ZASP00033: 7.5,
		ZASP202415: 7.2,
		ZASP00018: 7.5,
		ZASP00024: 15,
		ZASP00021: 7.5,
		ZASP202439: 21.6
	},
	'Štandard|4K IZO': {
		ZASP00036: 7.5,
		ZASP202432: 7.5,
		ZASP202415: 7.2,
		ZASP00018: 7.5,
		ZASP00024: 15,
		ZASP00021: 7.5,
		ZASP202439: 28.8
	},
	'Štandard|2x2K IZO': {
		ZASP00107: 7.5,
		ZASP00030: 7.5,
		ZASP202415: 7.2,
		ZASP00018: 15,
		ZASP00024: 15,
		ZASP00021: 7.5,
		ZASP202439: 28.8
	},
	'Štandard|2x3K IZO': {
		ZASP00027: 7.5,
		ZASP00033: 7.5,
		ZASP202415: 7.2,
		ZASP00018: 15,
		ZASP00024: 22.5,
		ZASP00021: 7.5,
		ZASP202439: 43.2
	},
	'Štandard|2x4K IZO': {
		ZASP00036: 7.5,
		ZASP202432: 7.5,
		ZASP202415: 7.2,
		ZASP00018: 15,
		ZASP00024: 30,
		ZASP00021: 7.5,
		ZASP202439: 57.6
	}
};

// [štýl, dnešná (zväčšená) spodná, základná spodná, názov dnešnej spodnej]
const SPODNE: [string, string, string, string][] = [
	['2K', 'ZASP00030', 'ZASP00104', 'Koľajnica spodná 3K Surový 7500 mm'],
	['3K', 'ZASP00033', 'ZASP00030', 'Koľajnica spodná 4K Surový 7500 mm'],
	['4K', 'ZASP202432', 'ZASP00033', 'Koľajnica spodná 5K Surový 7500 mm'],
	['2x2K', 'ZASP00030', 'ZASP00104', 'Koľajnica spodná 3K Surový 7500 mm'],
	['2x3K', 'ZASP00033', 'ZASP00030', 'Koľajnica spodná 4K Surový 7500 mm'],
	['2x4K', 'ZASP202432', 'ZASP00033', 'Koľajnica spodná 5K Surový 7500 mm']
];

describe('úloha 1459 — starý Štandard IZO: prídavná spodná koľajnica LEN cez checkbox', () => {
	it.each(SPODNE)(
		'Štandard|%s IZO bez prídavnej → ZÁKLADNÁ spodná (%s → %s)',
		(styl, dnes, zaklad) => {
			const o = odpis(`Štandard|${styl} IZO`, false);
			expect(Object.keys(o)).toContain(zaklad);
			expect(Object.keys(o)).not.toContain(dnes);
			// metre sa nemenia (rovnaký riadok, rovnaká tyč 7500) — mení sa len kód
			expect(o[zaklad]).toBe(DNES[`Štandard|${styl} IZO`]![dnes]);
		}
	);

	it.each(SPODNE)(
		'Štandard|%s IZO s prídavnou → BIT-IDENTICKÉ s dnešným odpisom (kód, názov, metre)',
		(styl, dnes, _zaklad, nazov) => {
			expect(odpis(`Štandard|${styl} IZO`, true)).toEqual(DNES[`Štandard|${styl} IZO`]);
			expect(spodna(`Štandard|${styl} IZO`, true)).toEqual([
				{ kod: dnes, nazov, metre: DNES[`Štandard|${styl} IZO`]![dnes] }
			]);
		}
	);

	it('checkbox je pri starom Štandarde viditeľný (plusRailEligible) — všetky štýly aj IZO', () => {
		for (const s of ['2K', '3K', '4K', '2x2K', '2x3K', '2x4K']) {
			expect(plusRailEligible('Štandard', s), s).toBe(true);
			expect(plusRailEligible('Štandard', `${s} IZO`), `${s} IZO`).toBe(true);
		}
	});

	it('pri IZO skle je predvolene zaškrtnutý (rovnako ako Štandard +), pri inom skle nie', () => {
		for (const s of ['2K', '3K', '4K', '2x2K', '2x3K', '2x4K']) {
			expect(pridavnaKolajnicaDefault('Štandard', s, IZO), s).toBe(true);
			expect(pridavnaKolajnicaDefault('Štandard', `${s} IZO`, IZO), `${s} IZO`).toBe(true);
			expect(pridavnaKolajnicaDefault('Štandard', s, 'Float sklo 6 mm'), s).toBe(false);
			// trieda skladby (#443) má prednosť pred názvom
			expect(pridavnaKolajnicaDefault('Štandard', s, 'Iné', 16), s).toBe(true);
			expect(pridavnaKolajnicaDefault('Štandard', s, 'Iné', 6), s).toBe(false);
		}
		// Štandard + bez zmeny
		expect(pridavnaKolajnicaDefault('Štandard +', '3K', IZO)).toBe(true);
		expect(pridavnaKolajnicaDefault('Štandard +', '6K', IZO)).toBe(false);
		// iné systémy auto-default nemajú (Patrikovo „pri štandardoch IZO")
		expect(pridavnaKolajnicaDefault('Robust', '2K', IZO)).toBe(false);
		expect(pridavnaKolajnicaDefault('Slide', '2K', IZO)).toBe(false);
		expect(pridavnaKolajnicaDefault('Deluxe', '2K', IZO)).toBe(false);
		expect(pridavnaKolajnicaDefault('Štandard Drevo', '4K', IZO)).toBe(false);
	});

	it('seed: spodná koľajnica IZO štýlu = PRESNE riadok basic štýlu (kód, názov, vzorec, tyč)', () => {
		const rez = seed.rez as (RezRow & { dlzkaTyce?: number })[];
		const spod = (ss: string) =>
			rez.filter((r) => r.sysStyl === ss && /^Koľajnica\s+spodná/.test(r.nazov));
		for (const [styl] of SPODNE) {
			const izo = spod(`Štandard|${styl} IZO`);
			const basic = spod(`Štandard|${styl}`);
			expect(izo, styl).toHaveLength(1);
			expect(basic, styl).toHaveLength(1);
			const { sysStyl: _a, ...i } = izo[0]!;
			const { sysStyl: _b, ...b } = basic[0]!;
			expect(i, styl).toEqual(b);
		}
	});

	it('basic starý Štandard: bez prídavnej nezmenený, s prídavnou o veľkosť väčšia spodná', () => {
		expect(spodna('Štandard|3K', false).map((o) => o.kod)).toEqual(['ZASP00030']);
		expect(spodna('Štandard|3K', true).map((o) => o.kod)).toEqual(['ZASP00033']);
		expect(spodna('Štandard|2K', false).map((o) => o.kod)).toEqual(['ZASP00104']);
	});

	it('zimná záhrada (príloha úlohy: 3K IZO + 2K IZO) — checkbox platí pre obe zasklenia', () => {
		const spec = (sysStyl: string, pridavnaKolajnica: boolean) =>
			buildPosuvSpec({
				sysStyl,
				S: 3000,
				V: 2400,
				redukciaZero: false,
				skloHrubka: 0,
				skloKorekcia: null,
				pridavnaKolajnica,
				kolajnica: undefined,
				otvaranie: undefined,
				sklo: undefined,
				kovanieL: undefined,
				kovanieP: undefined,
				kovanieStred: undefined,
				kovanieStredOkno: undefined,
				kliny: undefined,
				sietka: undefined
			} satisfies PosuvSpecInput);
		const kody = (p: boolean) =>
			computeMulti(cfg, [spec('Štandard|3K IZO', p), spec('Štandard|2K IZO', p)])!
				.odpis.filter((o) => /^Koľajnica\s+spodná/.test(o.nazov))
				.map((o) => o.kod)
				.sort();
		// zaškrtnuté = presne screenshot úlohy (3K IZO → 4K, 2K IZO → 3K)
		expect(kody(true)).toEqual(['ZASP00030', 'ZASP00033']);
		// odškrtnuté = spodná = horná (3K → 3K, 2K → 2K)
		expect(kody(false)).toEqual(['ZASP00030', 'ZASP00104']);
	});

	it('sieťka na 2K IZO: starý Štandard sa správa ako Štandard + (3K sada už obsahuje prídavnú)', () => {
		const kolajnice = (sysStyl: string, p: boolean) =>
			computeFlat(cfg, sysStyl, 3000, 2400, false, 0, p, undefined, { uchyt: 'ziadny' })!
				.odpis.filter((o) => /^Koľajnica/.test(o.nazov))
				.map((o) => o.kod);
		for (const p of [false, true]) {
			expect(kolajnice('Štandard|2K IZO', p)).toEqual(kolajnice('Štandard +|2K IZO', p));
			expect(kolajnice('Štandard|2K IZO', p)).toEqual(['ZASP00027', 'ZASP00030']);
		}
		// hláška pri checkboxe sa pri starom Štandarde ukáže tiež
		expect(pridavnaJeVSietke('Štandard', '2K IZO', true)).toBe(true);
		expect(pridavnaJeVSietke('Štandard', '3K IZO', true)).toBe(false);
	});
});
