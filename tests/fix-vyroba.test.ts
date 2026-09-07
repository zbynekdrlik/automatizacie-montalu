// Regresný test: FIX výrobné odpočty zo zamerania (issue 469)
// Podklady: att-15390/15391/15392 (7.9.2026) — reálny prípad zameranie → výrobný výkres.
//
// Zameranie (otvor): S=1578, V1=137 (ľavá, vyššia), V2=48 (pravá, nižšia)
// Výrobný výkres:    spodná hrana 1530, horná ~1532.6, uhol ~3.3°
//
// Jasne determinované: šírkový odpočet 48mm celkovo (24mm/stranu = profil).
// Výšky: lineárna interpolácia na zúžených hranách (x=24, x=1554).
// V2 diskrepancia (48→55.5 vo výkrese) je OTVORENÁ — test overuje len šírku a uhol.
import { describe, it, expect } from 'vitest';
import {
	prepocitajFixNaVyrobu,
	FIX_PROFIL_ODPOCET,
	type FixVyrobaVstup
} from '../src/lib/fix';

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

	it('uhol sa zachováva z pôvodného zamerania (~3.2°)', () => {
		const r = prepocitajFixNaVyrobu(vstup);
		// výrobný výkres hovorí 3.3° — náš výpočet dá 3.2° z ideálnej geometrie
		expect(r.alfa).toBeGreaterThanOrEqual(3.1);
		expect(r.alfa).toBeLessThanOrEqual(3.4);
	});

	it('šikmá hrana: ~1532 (výkres 1532.6 — do 1mm)', () => {
		const r = prepocitajFixNaVyrobu(vstup);
		expect(Math.abs(r.sikmaCelkom - 1532.6)).toBeLessThanOrEqual(1);
	});

	it('výšky na krajoch konštrukcie sú interpolované na zúžených hranách', () => {
		const r = prepocitajFixNaVyrobu(vstup);
		// Ľavá strana: V(24) = 137 + (48−137)×24/1578 = 135.6 (výkres 136.2 — do 1mm)
		expect(r.V1).toBeGreaterThan(134);
		expect(r.V1).toBeLessThan(137);
		// Pravá strana: V(1554) = 137 + (48−137)×1554/1578 = 49.4
		// (výkres hovorí 55.5 — V2 diskrepancia je OTVORENÁ otázka, tu testujeme len
		// že interpolácia prebehla, nie presný výkresový rozmer)
		expect(r.V2).toBeGreaterThan(48);
		expect(r.V2).toBeLessThan(52);
	});

	it('polia sa proporčne zúžia na nový S', () => {
		const vstupMulti: FixVyrobaVstup = {
			S: 1578,
			V1: 137,
			V2: 48,
			polia: [789, 789],
			odpocet: FIX_PROFIL_ODPOCET
		};
		const r = prepocitajFixNaVyrobu(vstupMulti);
		expect(r.S).toBe(1530);
		// súčet polí musí sedieť na nový S
		const sucet = r.polia.reduce((a, p) => a + p.sirka, 0);
		expect(Math.abs(sucet - 1530)).toBeLessThanOrEqual(0.5);
	});

	it('FIX_PROFIL_ODPOCET je 24mm (z podkladov)', () => {
		expect(FIX_PROFIL_ODPOCET).toBe(24);
	});

	it('odpočet 0 = identita (pôvodné rozmery bez zmeny)', () => {
		const r = prepocitajFixNaVyrobu({ ...vstup, odpocet: 0 });
		expect(r.S).toBe(1578);
		expect(r.V1).toBe(137);
		expect(r.V2).toBe(48);
	});
});
