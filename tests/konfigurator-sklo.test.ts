// #329 časť 4: zákaznícka vrstva strešného skla (6 kategórií) → mapovanie na KONKRÉTNY katalógový
// názov. Tento test SMIE importovať `sklo-strecha` (nie je klientsky bundle) a overuje, že každý
// `katalogNazov` reálne existuje v `SKLO_STRECHA_TYPY` — inak by verejný konfigurátor POSTol názov,
// ktorý parser (PLATNE_SKLA) odmietne a cena/PDF/Odoo by dostali neplatný typ.
import { describe, expect, it } from 'vitest';
import {
	KONF_SKLO_KATEGORIE,
	KONF_SKLO_KATALOG_NAZVY,
	konfSkloKategoriaPreNazov
} from '../src/lib/konfigurator-sklo';
import { SKLO_STRECHA_TYPY } from '../src/lib/sklo-strecha';
import { typSkla3D } from '../src/lib/konfigurator';

const KATALOG = new Set(SKLO_STRECHA_TYPY.map((t) => t.nazov));

describe('KONF_SKLO_KATEGORIE — zákaznícke kategórie skla (#329 časť 4)', () => {
	it('presne 6 kategórií podľa tabuľky v tikete', () => {
		expect(KONF_SKLO_KATEGORIE).toHaveLength(6);
		expect(KONF_SKLO_KATEGORIE.map((k) => k.katalogNazov)).toEqual([
			'4.4.2 číre',
			'4.4.2 mliečne',
			'IZO 4.4.2-8-6 číre',
			'IZO 4.4.2-8-6 mliečne',
			'polykarbonát 16 mm číry',
			'STADUR 24 mm'
		]);
	});

	it('KAŽDÝ katalogNazov reálne existuje v katalógu SKLO_STRECHA_TYPY', () => {
		for (const k of KONF_SKLO_KATEGORIE) {
			expect(
				KATALOG.has(k.katalogNazov),
				`${k.label} → '${k.katalogNazov}' nie je v katalógu`
			).toBe(true);
		}
	});

	it('kľúče kategórií sú unikátne a labely bez hrúbky (žiadny 4.4.2/-8-6/mm)', () => {
		const kluce = KONF_SKLO_KATEGORIE.map((k) => k.kluc);
		expect(new Set(kluce).size).toBe(kluce.length);
		for (const k of KONF_SKLO_KATEGORIE) {
			expect(k.label, `label '${k.label}' odhaľuje hrúbku`).not.toMatch(/\d\.\d\.\d|-\d+-\d+|mm/);
		}
	});

	it('žiadna kategória nenesie Money kód (client-safe: len katalógový nazov + text/ikona)', () => {
		const json = JSON.stringify(KONF_SKLO_KATEGORIE);
		expect(json).not.toMatch(/TS\d{3}/);
		expect(json).not.toMatch(/moneyKod/);
	});

	it('typSkla3D mapuje každý katalogNazov na platnú vizuálnu rodinu (číre→cire, mliečne→matne)', () => {
		expect(typSkla3D('4.4.2 číre')).toBe('cire');
		expect(typSkla3D('4.4.2 mliečne')).toBe('matne');
		expect(typSkla3D('IZO 4.4.2-8-6 číre')).toBe('cire');
		expect(typSkla3D('IZO 4.4.2-8-6 mliečne')).toBe('matne');
		expect(typSkla3D('polykarbonát 16 mm číry')).toBe('cire');
		expect(typSkla3D('STADUR 24 mm')).toBe('matne');
	});

	it('KONF_SKLO_KATALOG_NAZVY + konfSkloKategoriaPreNazov sú konzistentné', () => {
		expect(KONF_SKLO_KATALOG_NAZVY).toEqual(KONF_SKLO_KATEGORIE.map((k) => k.katalogNazov));
		expect(konfSkloKategoriaPreNazov('4.4.2 mliečne')?.label).toBe('Bezpečnostné sklo — mliečne');
		expect(konfSkloKategoriaPreNazov('neexistuje')).toBeUndefined();
	});
});
