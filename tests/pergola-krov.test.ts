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
	krovDlzkaNominal,
	KROV_C,
	KROV_CC,
	KROV_KONST,
	KROV_PRAH_STUPNE,
	KROV_FREZ_ZMENA_STUPNE,
	KROV_ODPOCET
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
	it('podporovaný výsledok VŽDY vypíše frézovanie ako nepodporované (#161, O5); jednotka 0,01 už NIE JE otvorená', () => {
		const p = krovUlozenie(8).poznamky.join(' | ');
		expect(p).toMatch(/frézovan/i);
		// #233 — poznámka je plain slovenčina (#161 → „doplní konštruktér")
		expect(p).toMatch(/konštruktér/i);
		// 0,01 POTVRDENÉ v mm (Dominik ch207 msg 1724330: „je to v mm je to pomyslený trojuholnik
		// ktorý prehadzuje rovinu bodu uloženia…") → poznámka o neistej jednotke je PREČ
		expect(p).not.toMatch(/jednotk/i);
	});
	it('A7: NAD 9° je uloženie NEPODPOROVANÉ (offsety null + viditeľná poznámka) — pásmo bez vzorca', () => {
		// Dominik (call 13.8.): „nad 9–10° sa drážka zatvára, výška krovu sa zdvíha" = zmena režimu;
		// otázka A7 (súhrn ch207 msg 1724259 bod 5) ostala NEZODPOVEDANÁ → pásmo nad 9° sa
		// NEextrapoluje potvrdeným vzorcom — honest-null (#161).
		for (const s of [9.1, 10, 12]) {
			const r = krovUlozenie(s);
			expect(r.podporovane, `sklon ${s}°`).toBe(false);
			expect(r.rezim).toBe('nepodporovane');
			expect(r.ps).toBeNull();
			expect(r.lv).toBeNull();
			expect(r.poznamky.join(' | ')).toMatch(/zatvár|nepodporovan/i);
		}
		// presne 9° ešte počíta (potvrdený režim „otvára") a nesie varovnú poznámku o pásme
		const r9 = krovUlozenie(9);
		expect(r9.podporovane).toBe(true);
		expect(r9.ps).not.toBeNull();
		expect(r9.poznamky.join(' | ')).toMatch(/zatvár/i);
		// pod 9° (8°) poznámku o zatváraní NEMÁ
		expect(krovUlozenie(8).poznamky.join(' | ')).not.toMatch(/zatvár/i);
	});
});

describe('krovUlozenie — čistá funkcia, monotónny rast offsetov s uhlom', () => {
	it('offsety rastú s uhlom (7 < 8 < 9) — geometria sa „otvára" (nad 9° = A7 nepodporované)', () => {
		const uhly = [7, 8, 9];
		const ps = uhly.map((u) => krovUlozenie(u).ps!);
		for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThan(ps[i - 1]!);
	});
	it('lv/pv (odvesna cc) je vždy väčšie než ps/ls (odvesna c) pri > 7°', () => {
		for (const u of [7.2, 8, 8.5, 9]) {
			const r = krovUlozenie(u);
			expect(r.lv!).toBeGreaterThan(r.ps!);
		}
	});
});

describe('krovDlzkaNominal — NOMINÁLNA dĺžka krovu (#161, derivácia 21.8. overená proti golden)', () => {
	it('konštanta odpočtu = 250 (predný 140 + zadný 110, jediný golden bod OP260282)', () => {
		expect(KROV_ODPOCET).toBe(250);
	});

	it('golden OP260282: hĺbka 3470, sklon 6,1° → 3470/cos(6,1°) − 250 ≈ 3239,76 (±0,01)', () => {
		const v = krovDlzkaNominal(3470, 6.1);
		expect(v).not.toBeNull();
		expect(Math.abs((v as number) - 3239.76)).toBeLessThan(0.01);
	});

	it('funguje POD prahom 7° (golden 6,1° je pod prahom) — dĺžka je oddelená od uloženia', () => {
		// krovUlozenie(6,1) je nepodporované (< 7°), ale dĺžka nominál MUSÍ ísť
		expect(krovUlozenie(6.1).podporovane).toBe(false);
		expect(krovDlzkaNominal(3470, 6.1)).not.toBeNull();
	});

	it('HH krovu (výkres 3240,93) = nominál + ~1,17 mm reálne uloženie (seating, bez vzorca)', () => {
		const nominal = krovDlzkaNominal(3470, 6.1) as number;
		expect(3240.93 - nominal).toBeCloseTo(1.17, 1); // seating gap sa nefituje
		expect(nominal).toBeLessThan(3240.93);
	});

	it('rastie so sklonom (väčší sklon → dlhší krov po spáde) a monotónne', () => {
		const a = krovDlzkaNominal(3470, 6.1) as number;
		const b = krovDlzkaNominal(3470, 8.5) as number; // 15° je už A7 pásmo (null)
		expect(b).toBeGreaterThan(a);
	});

	it('null keď sklon nezadaný / neplatný (bez sklonu sa dĺžka NEDÁ počítať — honest-null)', () => {
		for (const s of [null, undefined, NaN, 0, -3]) {
			expect(krovDlzkaNominal(3470, s as number)).toBeNull();
		}
	});

	it('null keď hĺbka neplatná (0 / záporná / NaN) — nikdy NaN/nezmysel', () => {
		for (const h of [0, -100, NaN]) {
			expect(krovDlzkaNominal(h, 6.1)).toBeNull();
		}
	});

	it('R2 (0,01 mm) — dve desatinné miesta ako výkres, nie R1', () => {
		const v = krovDlzkaNominal(3470, 6.1) as number;
		expect(Math.round(v * 100) / 100).toBe(v); // už zaokrúhlené na 0,01
	});

	it('A7: nad 9° → null (pásmo „drážka sa zatvára / výška krovu sa zdvíha" nemá vzorec)', () => {
		expect(krovDlzkaNominal(3470, 9.1)).toBeNull();
		expect(krovDlzkaNominal(3470, 12)).toBeNull();
		expect(krovDlzkaNominal(3470, 9)).not.toBeNull(); // presne 9° ešte platí
	});

	it('Robust: hĺbka/cos(sklon) − 220 (Dominik ch207 1724329: výsuv −154,94 masív / −124,94 Robust = rozdiel 30)', () => {
		// Kotva = overený masív bod (−250, golden OP260282); Dominikov verbatim rozdiel masív↔Robust
		// je presne 30 mm (predný profil 140 − 110) → Robust = −220. 3470/cos(6,1°) − 220 = 3269,76.
		const r = krovDlzkaNominal(3470, 6.1, 'Robust');
		expect(r).not.toBeNull();
		expect(Math.abs((r as number) - 3269.76)).toBeLessThan(0.01);
		// default (bez parametra) = Massive (spätná kompatibilita callerov)
		expect(krovDlzkaNominal(3470, 6.1)).toBe(krovDlzkaNominal(3470, 6.1, 'Massive'));
	});
});
