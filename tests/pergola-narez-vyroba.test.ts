// Pergola — VÝROBNÁ varianta hárku (#381, podmnožina 1+3+4). Čistá geometria pozičného
// číslovania dielov + montážne tolerancie. Časti 2 (Detail C/D) a 5 (rezný náčrt krovu)
// NIE SÚ v scope — viazané na #161. Reťazové kóty (generická `retazoveKoty`) sú testované
// v tests/kota.test.ts (zdieľaný helper).
//
// Display-only — do Money NIČ nezapisuje.
import { describe, it, expect } from 'vitest';
import {
	spocitajNarez,
	pozicujDiely,
	pozicieVoVykrese,
	MONTAZNE_TOLERANCIE_HLBKA_MM,
	KOD_PRIECKA_NORMAL,
	type PergolaNarezVstup
} from '../src/lib/pergola-narez';

// Golden vstup zákazky OP260282 (Massive SS, výstuha 140×140, zasklená) — ten istý ako
// tests/pergola-narez-op260282.test.ts. Poradie Plánu rezov: predná noha (1), zadná noha
// (2), priečka (3), žľab (4), kotviaci (5), zadná konštr. horná (6), žľabová výstuha (7),
// pod fixom (8), lišty (9+).
const OP260282: PergolaNarezVstup = {
	system: 'Massive',
	sirka: 4990,
	hlbka: 3470,
	prednaSvetlost: 2200,
	vyskaZadna: 2790,
	pocetPrednychNoh: 4,
	uchytenie: 'samostatne',
	pocetZadnychNoh: 4,
	hornyProfilZadnej: 110,
	prieckaLight: false,
	zosilnenyNosnik: true,
	sklonStrechy: 6.1,
	pocetKrovov: 8
};

// Vstup na stenu (bez zadných nôh) — zadná noha musí byť honest-null vo výkresových pozíciách.
const NA_STENU: PergolaNarezVstup = {
	system: 'Robust',
	sirka: 4000,
	hlbka: 3000,
	prednaSvetlost: 2500,
	vyskaZadna: 2800,
	pocetPrednychNoh: 3,
	uchytenie: 'stena',
	pocetZadnychNoh: 0,
	hornyProfilZadnej: 110,
	prieckaLight: false,
	zosilnenyNosnik: false,
	sklonStrechy: null,
	pocetKrovov: null,
	jednoduchaBezZasklenia: false
};

describe('pozicujDiely — stabilné pozičné čísla (Plán rezov, #381 časť 1)', () => {
	const r = spocitajNarez(OP260282);
	const diely = pozicujDiely(r.vypocitane);

	it('každý riadok dostane číslo = index + 1, v poradí kusovníka', () => {
		expect(diely.length).toBe(r.vypocitane.length);
		diely.forEach((d, i) => expect(d.cislo).toBe(i + 1));
	});

	it('zachová všetky pôvodné polia riadku (kód, názov, dĺžka, počet)', () => {
		diely.forEach((d, i) => {
			expect(d.kod).toBe(r.vypocitane[i]!.kod);
			expect(d.nazov).toBe(r.vypocitane[i]!.nazov);
			expect(d.dlzkaRezuMm).toBe(r.vypocitane[i]!.dlzkaRezuMm);
			expect(d.pocetKs).toBe(r.vypocitane[i]!.pocetKs);
		});
	});

	it('prvý diel má pozíciu 1, čísla sú súvislé bez preskakovania', () => {
		expect(diely[0]!.cislo).toBe(1);
		const cisla = diely.map((d) => d.cislo);
		expect(cisla).toEqual(Array.from({ length: diely.length }, (_, i) => i + 1));
	});

	it('prázdny kusovník → prázdne pole (žiadny pád)', () => {
		expect(pozicujDiely([])).toEqual([]);
	});
});

describe('pozicieVoVykrese — roly → pozičné číslo pre balóniky (#381 časť 1)', () => {
	it('OP260282: predná noha=1, zadná noha=2, priečka=3, žľab=4', () => {
		const r = spocitajNarez(OP260282);
		const p = pozicieVoVykrese(r.vypocitane);
		expect(p.prednaNoha).toBe(1);
		expect(p.zadnaNoha).toBe(2);
		expect(p.priecka).toBe(3);
		expect(p.zlab).toBe(4);
	});

	it('pozícia priečky ukazuje na kód priečkového profilu (18004)', () => {
		const r = spocitajNarez(OP260282);
		const p = pozicieVoVykrese(r.vypocitane);
		expect(r.vypocitane[p.priecka! - 1]!.kod).toBe(KOD_PRIECKA_NORMAL);
	});

	it('na stenu: zadná noha = null (honest-null, balónik sa nekreslí), predná noha ostáva', () => {
		const r = spocitajNarez(NA_STENU);
		const p = pozicieVoVykrese(r.vypocitane);
		expect(p.zadnaNoha).toBeNull();
		expect(p.prednaNoha).toBe(1);
		// žľab a priečka sú prítomné aj na stenu
		expect(p.zlab).not.toBeNull();
		expect(p.priecka).not.toBeNull();
	});

	it('rola sa mapuje na SPRÁVNY riadok (názov obsahuje očakávanú rolu)', () => {
		const r = spocitajNarez(OP260282);
		const p = pozicieVoVykrese(r.vypocitane);
		expect(r.vypocitane[p.prednaNoha! - 1]!.nazov).toMatch(/predná noha/);
		expect(r.vypocitane[p.zadnaNoha! - 1]!.nazov).toMatch(/zadná noha/);
		expect(r.vypocitane[p.zlab! - 1]!.nazov.endsWith('žľab')).toBe(true);
	});
});

describe('MONTAZNE_TOLERANCIE_HLBKA_MM — CAD konštanty (#381 časť 4)', () => {
	it('presne overené hodnoty z groundingu #377 — nič sa nehádže', () => {
		expect([...MONTAZNE_TOLERANCIE_HLBKA_MM]).toEqual([2, 3, 12]);
	});
});
