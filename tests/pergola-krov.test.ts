// Pergola — KROV uloženie (#161), engine testy. Implementuje LEN POTVRDENÉ vzorce z
// analýzy nahrávky callu s Dominikom (13.8.2026, komentár na #161). Display-only — do
// Money NIČ nezapisuje (statický guard: tests/pergola-narez-money-safety.test.ts).
//
// KĽÚČOVÝ VERIFIKAČNÝ VEKTOR (z tabuľky na scr_030, číselne overený v analýze): pri
// sklone 8° (uhol3 = 1) je ps = ls = tan(1°)·29 + 0,01 = 0,516 → 0,52 a lv = pv =
// tan(1°)·37,28 + 0,01 = 0,661 → 0,66. Dekódovaný „trojuholník 0,52–29–0,01" = (ps, c,
// konštanta) pri 8°. Toto je jediný pár uhol↔hodnota, ktorý call číselne potvrdil.
import { describe, it, expect } from 'vitest';
import {
	krovUlozenie,
	KROV_C,
	KROV_CC,
	KROV_KONST,
	KROV_PRAH_STUPNE,
	KROV_FREZ_ZMENA_STUPNE
} from '../src/lib/pergola-krov';

describe('konštanty uloženia — potvrdené hodnoty z callu (nie magické čísla)', () => {
	it('c = 29, cc = 37,28, konštanta = 0,01, prah = 7°', () => {
		expect(KROV_C).toBe(29);
		expect(KROV_CC).toBe(37.28);
		expect(KROV_KONST).toBe(0.01);
		expect(KROV_PRAH_STUPNE).toBe(7);
		expect(KROV_FREZ_ZMENA_STUPNE).toBe(9);
	});
});

describe('krovUlozenie — VERIFIKAČNÝ VEKTOR 8° (tabuľka scr_030)', () => {
	const r = krovUlozenie(8);

	it('podporované, režim „otvara" (dva dotyky + previs), uhol2 = 1, uhol3 = 1', () => {
		expect(r.podporovane).toBe(true);
		expect(r.rezim).toBe('otvara');
		expect(r.uhol2).toBe(1);
		expect(r.uhol3).toBe(1);
	});

	it('ps = ls = 0,52 (tan(1°)·29 + 0,01 = 0,516 → 0,52) — presne tabuľka', () => {
		expect(r.ps).toBe(0.52);
		expect(r.ls).toBe(0.52);
		expect(r.ps).toBe(r.ls); // invariant: ls = ps (obe z odvesny c)
	});

	it('lv = pv = 0,66 (tan(1°)·37,28 + 0,01 = 0,661 → 0,66) — presne tabuľka', () => {
		expect(r.lv).toBe(0.66);
		expect(r.pv).toBe(0.66);
		expect(r.lv).toBe(r.pv); // invariant: lv = pv (obe z odvesny cc)
	});

	it('surová (nezaokrúhlená) hodnota sedí na tangens vzorec — nič sa nehádže', () => {
		const t = Math.tan((1 * Math.PI) / 180);
		expect(t * KROV_C + KROV_KONST).toBeCloseTo(0.5162, 3);
		expect(t * KROV_CC + KROV_KONST).toBeCloseTo(0.6607, 3);
	});

	it('dekódovaný trojuholník 0,52–29–0,01 = (ps, c, konštanta) pri 8°', () => {
		expect([r.ps, r.konstanty.c, r.konstanty.konst]).toEqual([0.52, 29, 0.01]);
	});
});

describe('krovUlozenie — prah 7° (CAD uhol2 = IF(UHOL<=7,0,1))', () => {
	it('= 7° → uhol2 = 0, režim „rovnobezne", offsety = konštanta 0,01 (uloženie neotvorené)', () => {
		const r = krovUlozenie(7);
		expect(r.podporovane).toBe(true);
		expect(r.rezim).toBe('rovnobezne');
		expect(r.uhol2).toBe(0);
		expect(r.uhol3).toBe(0);
		expect(r.ps).toBe(0.01);
		expect(r.ls).toBe(0.01);
		expect(r.lv).toBe(0.01);
		expect(r.pv).toBe(0.01);
	});

	it('tesne nad 7° (7,2°) → uhol2 = 1, režim „otvara", kladné rastúce offsety', () => {
		const r = krovUlozenie(7.2);
		expect(r.uhol2).toBe(1);
		expect(r.rezim).toBe('otvara');
		expect(r.uhol3).toBe(0.2);
		// rastie s uhlom: 7,2° < 8°
		expect(r.ps!).toBeGreaterThan(0);
		expect(r.ps!).toBeLessThan(0.52);
		expect(r.lv!).toBeGreaterThan(r.ps!); // cc (37,28) > c (29) → lv > ps
	});

	it('POD 7° (6°) → NEPODPOROVANÉ (O5 „prehodenie" bodu dotyku), žiadne offsety, nič sa nehádže', () => {
		const r = krovUlozenie(6);
		expect(r.podporovane).toBe(false);
		expect(r.rezim).toBe('nepodporovane');
		expect(r.uhol2).toBe(0);
		expect(r.uhol3).toBeNull();
		expect(r.ps).toBeNull();
		expect(r.ls).toBeNull();
		expect(r.lv).toBeNull();
		expect(r.pv).toBeNull();
		expect(r.poznamky.join(' | ')).toMatch(/pod 7°|prehodí|O5/i);
	});
});

describe('krovUlozenie — nezadané / neplatné', () => {
	it('null → režim „nezadane", nepodporované, žiadne hodnoty', () => {
		const r = krovUlozenie(null);
		expect(r.rezim).toBe('nezadane');
		expect(r.podporovane).toBe(false);
		expect(r.uhol2).toBeNull();
		expect(r.ps).toBeNull();
	});
	it('undefined / NaN / 0 / záporné → nezadane (obranný fallback, nie NaN v hodnotách)', () => {
		for (const v of [undefined, NaN, 0, -5]) {
			const r = krovUlozenie(v as number);
			expect(r.rezim).toBe('nezadane');
			expect(r.ps).toBeNull();
		}
	});
});

describe('krovUlozenie — čestné poznámky (frézovanie #161 vždy, O5b, nad 9–10°)', () => {
	it('podporovaný výsledok VŽDY vypíše frézovanie ako nepodporované (#161, O5) + O5b jednotku', () => {
		const p = krovUlozenie(8).poznamky.join(' | ');
		expect(p).toMatch(/frézovan/i);
		// #233 — poznámka je plain slovenčina (#161 → „doplní konštruktér")
		expect(p).toMatch(/konštruktér/i);
		expect(p).toMatch(/O5b|jednotk/i);
	});
	it('nad ~9–10° pridá poznámku o zatváraní drážky (frézovací detail O5), offsety ostávajú', () => {
		const r9 = krovUlozenie(9);
		expect(r9.poznamky.join(' | ')).toMatch(/9|zatvár/i);
		// offsety uloženia sú stále počítané z potvrdeného vzorca (nie null)
		expect(r9.ps).not.toBeNull();
		expect(r9.podporovane).toBe(true);
		// pod 9° (8°) poznámku o zatváraní NEMÁ
		expect(krovUlozenie(8).poznamky.join(' | ')).not.toMatch(/zatvár/i);
	});
});

describe('krovUlozenie — čistá funkcia, monotónny rast offsetov s uhlom', () => {
	it('offsety rastú s uhlom (7 < 8 < 9 < 12) — geometria sa „otvára"', () => {
		const uhly = [7, 8, 9, 12];
		const ps = uhly.map((u) => krovUlozenie(u).ps!);
		for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThan(ps[i - 1]!);
	});
	it('lv/pv (odvesna cc) je vždy väčšie než ps/ls (odvesna c) pri > 7°', () => {
		for (const u of [7.2, 8, 10, 12]) {
			const r = krovUlozenie(u);
			expect(r.lv!).toBeGreaterThan(r.ps!);
		}
	});
});
