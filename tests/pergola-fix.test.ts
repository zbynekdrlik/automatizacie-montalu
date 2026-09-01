// „Pergola s FIXom" (#378) — kontraktové vektory pre odvodenie rozmerov FIXu z
// pergoly + geometriu cez `pocitajFix`. FIX je DISPLAY-ONLY a Money-NEUTRÁLNY;
// Money-safety (že sa `pergola-fix.ts` neviaže na Money zápis) stráži samostatne
// `tests/pergola-narez-money-safety.test.ts` (`CISTY_ENGINE`).
import { describe, it, expect } from 'vitest';
import {
	odvodFixZPergoly,
	efektivnyFix,
	spocitajFixZPergoly,
	parseFixZPergoly,
	prazdnyFix,
	type FixZPergola,
	type PergolaFixVstup
} from '../src/lib/pergola-fix';

const PERGOLA: PergolaFixVstup = { hlbka: 3500, prednaSvetlost: 2200, vyskaZadna: 2900 };

function fix(over: Partial<FixZPergola> = {}): FixZPergola {
	return { ...prazdnyFix(), zapnuty: true, ...over };
}

describe('odvodFixZPergoly — rozmery FIXu z pergoly (#378)', () => {
	it('šírka = hĺbka, výška vpredu = predná svetlosť, výška pri stene = zadná výška, tvar = sikmy', () => {
		expect(odvodFixZPergoly(PERGOLA)).toEqual({ s: 3500, v1: 2200, v2: 2900, tvar: 'sikmy' });
	});

	it('rovné výšky (predná svetlosť == zadná výška) → tvar rovny', () => {
		expect(odvodFixZPergoly({ hlbka: 3000, prednaSvetlost: 2500, vyskaZadna: 2500 })).toEqual({
			s: 3000,
			v1: 2500,
			v2: 2500,
			tvar: 'rovny'
		});
	});

	it('rozmery sa zaokrúhlia na 0,1 mm (R1) — nezavlečie sa float drobec', () => {
		const o = odvodFixZPergoly({ hlbka: 3500.04, prednaSvetlost: 2200.06, vyskaZadna: 2900 });
		expect(o).toEqual({ s: 3500, v1: 2200.1, v2: 2900, tvar: 'sikmy' });
	});
});

describe('spocitajFixZPergoly — geometria cez pocitajFix (kontraktové vektory)', () => {
	it('šikmý FIX 3500/2200/2900, 1 pole → sklon 11,3°, plocha 8,925 m², šikmá 3569,3', () => {
		const { vykres, error } = spocitajFixZPergoly(
			fix({ s: 3500, v1: 2200, v2: 2900, polia: [3500] })
		);
		expect(error).toBeNull();
		expect(vykres).not.toBeNull();
		const r = vykres!;
		expect(r.S).toBe(3500);
		expect(r.V1).toBe(2200);
		expect(r.V2).toBe(2900);
		expect(r.alfa).toBe(11.3);
		expect(r.sikmaCelkom).toBe(3569.3);
		expect(r.uholOstry).toBe(78.7);
		expect(r.uholTupy).toBe(101.3);
		expect(r.m2).toBe(8.925);
		expect(r.polia).toHaveLength(1);
		expect(r.polia[0]!.sirka).toBe(3500);
	});

	it('rovný FIX 3000/2500, 1 pole → sklon 0°, plocha 7,5 m²', () => {
		const { vykres } = spocitajFixZPergoly(
			fix({ s: 3000, v1: 2500, v2: 2500, tvar: 'rovny', polia: [3000] })
		);
		expect(vykres!.alfa).toBe(0);
		expect(vykres!.m2).toBe(7.5);
	});

	it('vypnutý FIX → žiadny výkres, žiadna chyba', () => {
		expect(spocitajFixZPergoly(prazdnyFix())).toEqual({ vykres: null, error: null });
	});

	it('neplatný vstup (súčet polí ≠ šírka) → chyba, žiadny výkres (rovnaká kontrola ako /fix)', () => {
		const { vykres, error } = spocitajFixZPergoly(
			fix({ s: 3500, v1: 2200, v2: 2900, polia: [1000, 1000] })
		);
		expect(vykres).toBeNull();
		expect(error).toMatch(/nerovná/);
	});
});

describe('efektivnyFix — auto odvodenie vs ručný override', () => {
	it('auto → prepíše rozmery odvodením z pergoly (server nedôveruje klientovým rozmerom)', () => {
		// klient poslal nezmyselné rozmery, ale auto je zapnuté → prepíšu sa z pergoly
		const e = efektivnyFix(fix({ auto: true, s: 999, v1: 111, v2: 222, polia: [999] }), PERGOLA);
		expect(e.s).toBe(3500);
		expect(e.v1).toBe(2200);
		expect(e.v2).toBe(2900);
		expect(e.tvar).toBe('sikmy');
		expect(e.polia).toEqual([3500]);
	});

	it('auto zachová POČET polí operátora a rovnomerne ich rozdelí na odvodenú šírku', () => {
		const e = efektivnyFix(fix({ auto: true, polia: [100, 100, 100] }), PERGOLA);
		expect(e.polia).toHaveLength(3);
		expect(e.polia.reduce((a, b) => a + b, 0)).toBeCloseTo(3500, 5);
	});

	it('override (auto=false) → rozmery ostanú nezmenené', () => {
		const over = fix({ auto: false, s: 4200, v1: 1800, v2: 2600, polia: [4200] });
		expect(efektivnyFix(over, PERGOLA)).toEqual(over);
	});

	it('vypnutý FIX → nezmenený (netreba nič odvádzať)', () => {
		const off = prazdnyFix();
		expect(efektivnyFix(off, PERGOLA)).toEqual(off);
	});
});

describe('parseFixZPergoly — round-trip z formulára', () => {
	function form(entries: Record<string, string>): FormData {
		const f = new FormData();
		for (const [k, v] of Object.entries(entries)) f.set(k, v);
		return f;
	}

	it('zapnutý auto FIX s poľami', () => {
		const p = parseFixZPergoly(
			form({
				pergolaSFixom: '1',
				fixAuto: '1',
				fixTvar: 'sikmy',
				fixSirka: '3500',
				fixV1: '2200',
				fixV2: '2900',
				fixPolia: '[3500]',
				fixZrkadlo: '1',
				fixSklo: '4-8-4 IZO číre',
				fixPoznamka: 'bok pergoly'
			})
		);
		expect(p.zapnuty).toBe(true);
		expect(p.auto).toBe(true);
		expect(p.s).toBe(3500);
		expect(p.v1).toBe(2200);
		expect(p.v2).toBe(2900);
		expect(p.zrkadlo).toBe(true);
		expect(p.sklo).toBe('4-8-4 IZO číre');
		expect(p.poznamka).toBe('bok pergoly');
		expect(p.polia).toEqual([3500]);
	});

	it('rovný fix → v2 skopírované z v1 (poistka pre skriptovaný POST)', () => {
		const p = parseFixZPergoly(
			form({ pergolaSFixom: '1', fixTvar: 'rovny', fixSirka: '3000', fixV1: '2500' })
		);
		expect(p.tvar).toBe('rovny');
		expect(p.v2).toBe(2500);
		// prázdne fixPolia + kladná šírka → jedno pole cez celú šírku
		expect(p.polia).toEqual([3000]);
	});

	it('chýbajúci pergolaSFixom → vypnutý; chýbajúci fixAuto → auto (default true)', () => {
		const p = parseFixZPergoly(form({}));
		expect(p.zapnuty).toBe(false);
		expect(p.auto).toBe(true);
	});

	it('fixAuto=0 → override', () => {
		const p = parseFixZPergoly(form({ pergolaSFixom: '1', fixAuto: '0' }));
		expect(p.auto).toBe(false);
	});
});

describe('Money-neutralita — FIX nenesie Money kód (honest-null, #378)', () => {
	it('spocitajFixZPergoly vracia LEN geometriu (vykres/error), žiadny Money kód ani položku', () => {
		const out = spocitajFixZPergoly(fix({ s: 3500, v1: 2200, v2: 2900, polia: [3500] }));
		expect(Object.keys(out).sort()).toEqual(['error', 'vykres']);
		// žiadny kľúč typu Polozka (kod/qty/mj) sa v návratovej hodnote nevyskytuje
		expect(JSON.stringify(out)).not.toMatch(/"kod"|"qty"|"mj"/);
	});
});
