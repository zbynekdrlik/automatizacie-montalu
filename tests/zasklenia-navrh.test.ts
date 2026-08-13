// Zasklenia návrhový výkres (#162) — čistá geometria. Rovnaká disciplína ako
// tests/pergola-navrh.test.ts (jeden describe per exportovanú funkciu).
import { describe, it, expect } from 'vitest';
import {
	sirkaKridla,
	deliaceStlpiky,
	smerZOtvarania,
	pohyblivePanely,
	chybaZaskleniaNavrhVstupu,
	S_MIN,
	S_MAX,
	V_MIN,
	V_MAX,
	N_MIN,
	N_MAX,
	VYKRES_REZIM_DEFAULT,
	type ZaskleniaNavrhVstup
} from '../src/lib/zasklenia-navrh';

const zaklad: ZaskleniaNavrhVstup = {
	system: 'Robust',
	styl: '2K',
	sysStyl: 'Robust|2K',
	n: 2,
	s: 3000,
	v: 2000,
	otvaranie: 'P - L',
	klin: null,
	kolajnica: null,
	nazov: '',
	ral: '',
	ralKod: '',
	rezimVykresu: VYKRES_REZIM_DEFAULT
};

describe('sirkaKridla', () => {
	it('rovnomerné delenie — 3000/2 = 1500', () => {
		expect(sirkaKridla(3000, 2)).toBe(1500);
	});
	it('neplatný vstup vráti 0', () => {
		expect(sirkaKridla(0, 2)).toBe(0);
		expect(sirkaKridla(3000, 0)).toBe(0);
		expect(sirkaKridla(-100, 2)).toBe(0);
	});
});

describe('deliaceStlpiky', () => {
	it('n+1 hraníc, od 0 po celkovú šírku', () => {
		expect(deliaceStlpiky(3000, 3)).toEqual([0, 1000, 2000, 3000]);
	});
	it('n=1 (jedno krídlo) — dve hranice, 0 a s', () => {
		expect(deliaceStlpiky(1500, 1)).toEqual([0, 1500]);
	});
	it('desatinný výsledok sa zaokrúhli na 1 desatinné miesto', () => {
		expect(deliaceStlpiky(1000, 3)).toEqual([0, 333.3, 666.7, 1000]);
	});
});

describe('smerZOtvarania', () => {
	it('"P - L" (medzery odstránené) -> PL', () => {
		expect(smerZOtvarania('P - L')).toBe('PL');
	});
	it('"L - P" -> LP', () => {
		expect(smerZOtvarania('L - P')).toBe('LP');
	});
	it('"Opona" (čokoľvek iné neprázdne) -> OP', () => {
		expect(smerZOtvarania('Opona')).toBe('OP');
	});
	it('prázdny reťazec -> prázdny smer', () => {
		expect(smerZOtvarania('')).toBe('');
	});
});

describe('pohyblivePanely (#168 — označenie pohyblivých polí)', () => {
	it('P-L (PL): jedno krídlo VĽAVO (idx 0) ide doľava', () => {
		expect(pohyblivePanely(3, 'PL')).toEqual([{ index: 0, znamienko: -1 }]);
	});
	it('L-P (LP): jedno krídlo VPRAVO (idx n-1) ide doprava', () => {
		expect(pohyblivePanely(3, 'LP')).toEqual([{ index: 2, znamienko: 1 }]);
	});
	it('Opona (OP): OBE krajné krídlá sa rozchádzajú od stredu', () => {
		expect(pohyblivePanely(4, 'OP')).toEqual([
			{ index: 0, znamienko: -1 },
			{ index: 3, znamienko: 1 }
		]);
	});
	it('jediné krídlo (n=1) — nikdy pohyblivé, žiadna dráha', () => {
		expect(pohyblivePanely(1, 'PL')).toEqual([]);
		expect(pohyblivePanely(1, 'OP')).toEqual([]);
	});
	it('prázdny smer (appka otvaranie nezadala) — nič neoznačíme, nikdy hádanie', () => {
		expect(pohyblivePanely(3, '')).toEqual([]);
	});
	it('n=0 alebo záporné — obranne prázdne pole', () => {
		expect(pohyblivePanely(0, 'PL')).toEqual([]);
	});
});

describe('chybaZaskleniaNavrhVstupu', () => {
	it('platný vzorový vstup prejde bez chyby', () => {
		expect(chybaZaskleniaNavrhVstupu(zaklad)).toBeNull();
	});
	it('chýbajúci systém/štýl', () => {
		expect(chybaZaskleniaNavrhVstupu({ ...zaklad, system: '' })).toMatch(/systém/i);
		expect(chybaZaskleniaNavrhVstupu({ ...zaklad, styl: '' })).toMatch(/systém/i);
	});
	it(`n mimo rozsahu ${N_MIN}–${N_MAX}`, () => {
		expect(chybaZaskleniaNavrhVstupu({ ...zaklad, n: 0 })).toMatch(/počet krídel/i);
		expect(chybaZaskleniaNavrhVstupu({ ...zaklad, n: N_MAX + 1 })).toMatch(/počet krídel/i);
	});
	it(`s mimo rozsahu ${S_MIN}–${S_MAX}`, () => {
		expect(chybaZaskleniaNavrhVstupu({ ...zaklad, s: S_MIN - 1 })).toMatch(/šírka/i);
		expect(chybaZaskleniaNavrhVstupu({ ...zaklad, s: S_MAX + 1 })).toMatch(/šírka/i);
	});
	it(`v mimo rozsahu ${V_MIN}–${V_MAX}`, () => {
		expect(chybaZaskleniaNavrhVstupu({ ...zaklad, v: V_MIN - 1 })).toMatch(/výška/i);
		expect(chybaZaskleniaNavrhVstupu({ ...zaklad, v: V_MAX + 1 })).toMatch(/výška/i);
	});
	it('klín s nekladnou dĺžkou/šírkou je chyba', () => {
		expect(
			chybaZaskleniaNavrhVstupu({
				...zaklad,
				klin: { dlzka: 0, sirka: 500, v1: 100, v2: 50, ks: 1 }
			})
		).toMatch(/klín/i);
	});
	it('klín s platnými rozmermi neprodukuje chybu', () => {
		expect(
			chybaZaskleniaNavrhVstupu({
				...zaklad,
				klin: { dlzka: 1000, sirka: 500, v1: 100, v2: 50, ks: 1 }
			})
		).toBeNull();
	});
});
