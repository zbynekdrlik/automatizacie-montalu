// Regresný test: FIX výrobné odpočty zo zamerania (issue 469)
// Podklady: att-15390/15391/15392 (7.9.2026) — reálny prípad zameranie → výrobný výkres.
//
// Zameranie (otvor): S=1578, V1=137 (ľavá, vyššia), V2=48 (pravá, nižšia)
// Výrobný výkres:    spodná hrana 1530, horná 1532.6, uhol 3.3°
//
// Model: šírka sa zúži o 2×24mm profil; výškový rozdiel (dv = 89) sa zachováva
// cez zúženú šírku — potvrdzuje to hypot(1530, 89) = 1532.6 a atan(89/1530) = 3.3°
// (obe PRESNE sedí s výkresom). V1/V2 prechádzajú nezmenené.
//
// Výkresové výšky 136.2/55.5 sú na DETAIL A/B referenčných bodoch, nie na rohoch
// lichobežníka — vertikálny offset je OTVORENÁ OTÁZKA (Dominikov hovor).
// Polia: proporčné zúženie je zatiaľ predpoklad (1 pole v príklade — Dominik potvrdí).
import { describe, it, expect } from 'vitest';
import { prepocitajFixNaVyrobu, FIX_PROFIL_ODPOCET, type FixVyrobaVstup } from '../src/lib/fix';

describe('FIX výrobné odpočty — podklady att-15390/15391/15392 (issue 469)', () => {
	const vstup: FixVyrobaVstup = {
		S: 1578,
		V1: 137,
		V2: 48,
		polia: [1578],
		odpocet: FIX_PROFIL_ODPOCET
	};

	it('šírkový odpočet: zameranie 1578 → výroba 1530 (−48mm = 2×24 profil)', () => {
		const r = prepocitajFixNaVyrobu(vstup);
		expect(r.S).toBe(1530);
	});

	it('výškový rozdiel dv = 89 sa zachováva (V1=137, V2=48 nezmenené)', () => {
		const r = prepocitajFixNaVyrobu(vstup);
		expect(r.V1).toBe(137);
		expect(r.V2).toBe(48);
		expect(r.V1 - r.V2).toBe(89);
		expect(r.klesaVpravo).toBe(true);
	});

	it('uhol 3.3° — presný match s výkresom (atan(89/1530))', () => {
		const r = prepocitajFixNaVyrobu(vstup);
		expect(r.alfa).toBe(3.3);
	});

	it('šikmá hrana 1532.6 — presný match s výkresom (hypot(1530, 89))', () => {
		const r = prepocitajFixNaVyrobu(vstup);
		expect(r.sikmaCelkom).toBe(1532.6);
	});

	it('polia sa proporčne zúžia — súčet presne S_vyr', () => {
		const vstupMulti: FixVyrobaVstup = {
			S: 1578,
			V1: 137,
			V2: 48,
			polia: [789, 789],
			odpocet: FIX_PROFIL_ODPOCET
		};
		const r = prepocitajFixNaVyrobu(vstupMulti);
		expect(r.S).toBe(1530);
		expect(r.polia.map((p) => p.sirka)).toEqual([765, 765]);
		expect(r.polia.reduce((a, p) => a + p.sirka, 0)).toBe(1530);
	});

	it('drift vektor — nerovné polia, zvyšok v poslednom', () => {
		const vstupDrift: FixVyrobaVstup = {
			S: 1578,
			V1: 137,
			V2: 48,
			polia: [333, 333, 333, 579],
			odpocet: FIX_PROFIL_ODPOCET
		};
		const r = prepocitajFixNaVyrobu(vstupDrift);
		expect(r.S).toBe(1530);
		expect(r.polia.map((p) => p.sirka)).toEqual([322.9, 322.9, 322.9, 561.3]);
		expect(r.polia.reduce((a, p) => a + p.sirka, 0)).toBe(1530);
	});

	it('FIX_PROFIL_ODPOCET je 24mm (z podkladov)', () => {
		expect(FIX_PROFIL_ODPOCET).toBe(24);
	});

	it('default odpočet (bez explicitného parametra) = FIX_PROFIL_ODPOCET', () => {
		const r = prepocitajFixNaVyrobu({ S: 1578, V1: 137, V2: 48, polia: [1578] });
		expect(r.S).toBe(1530);
	});

	it('odpočet 0 = identita (S nezmenené, V1/V2 nezmenené)', () => {
		const r = prepocitajFixNaVyrobu({ ...vstup, odpocet: 0 });
		expect(r.S).toBe(1578);
		expect(r.V1).toBe(137);
		expect(r.V2).toBe(48);
	});
});
