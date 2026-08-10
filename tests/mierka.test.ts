// Čestná tlačová mierka (#137, bod 4) — nikdy natvrdo "1:20", vždy vypočítaná alebo "—".
import { describe, it, expect } from 'vitest';
import { vypocitajMierku } from '../src/lib/vykres/mierka';

describe('vypocitajMierku', () => {
	it('bežný prípad — 6000×3000mm objekt na A4 landscape kresliacej ploche', () => {
		// A4 landscape ~277×190mm po odčítaní okrajov/pečiatky (orientačné hodnoty)
		const m = vypocitajMierku(6000, 3000, 277, 190);
		// limituje šírka: 6000/277 ≈ 21,66 → zaokrúhlené na 22
		expect(m).toBe('≈1:22');
	});

	it('limitujúci rozmer je výška, keď je pomerovo väčšia', () => {
		// 1000×4000mm do 277×190mm: šírka 1000/277≈3,6, výška 4000/190≈21,05 → limituje výška
		expect(vypocitajMierku(1000, 4000, 277, 190)).toBe('≈1:21');
	});

	it('presné 1:20 sa NEVRACIA ako natvrdo zadaná hodnota — je to výsledok výpočtu', () => {
		// keď obsah presne zodpovedá pomeru 20, výsledok JE ≈1:20 — ale preto, lebo to
		// vyšlo z výpočtu, nie preto, že je to hardcoded literal (viď zdroj funkcie)
		expect(vypocitajMierku(20 * 277, 20 * 190, 277, 190)).toBe('≈1:20');
	});

	it('nulová/záporná šírka obsahu → "—"', () => {
		expect(vypocitajMierku(0, 3000, 277, 190)).toBe('—');
		expect(vypocitajMierku(-100, 3000, 277, 190)).toBe('—');
	});

	it('nulová/záporná výška obsahu → "—"', () => {
		expect(vypocitajMierku(6000, 0, 277, 190)).toBe('—');
	});

	it('neplatný rozmer papiera → "—" (napr. demo bez známej plochy)', () => {
		expect(vypocitajMierku(6000, 3000, 0, 190)).toBe('—');
		expect(vypocitajMierku(6000, 3000, 277, 0)).toBe('—');
	});

	it('NaN vstup → "—", nikdy NaN v texte', () => {
		expect(vypocitajMierku(NaN, 3000, 277, 190)).toBe('—');
	});

	it('veľmi malý objekt (mierka pod 1) sa zaokrúhli nahor na minimálne 1:1', () => {
		expect(vypocitajMierku(10, 10, 277, 190)).toBe('≈1:1');
	});
});
