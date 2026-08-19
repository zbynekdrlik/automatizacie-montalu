// Pergola — RUČNÉ POLOŽKY do rezervačného odpisu (#234): parse + validácia.
// Overuje, že:
//  1. parse vyhodí prázdne/nulové riadky, chytí neplatné množstvo/MJ (nie tiché zlé číslo),
//  2. validácia proti katalógu: neznámy kód = VAROVANIE (nie odmietnutie), známy = OK,
//  3. round-trip JSON tvar (serializácia z formulára).
import { describe, it, expect } from 'vitest';
import { parseRucnePolozky, rucnaValidacia, RUCNE_MNOZSTVO_MAX } from '../src/lib/pergola-rucne';

const KATALOG = new Set(['PRP20259', 'PRP202410', 'PRP00044']);

describe('rucnaValidacia — katalóg, neznámy kód = varovanie', () => {
	it('známy kód → žiadne varovanie, znamy=true', () => {
		const v = rucnaValidacia('PRP20259', KATALOG);
		expect(v.znamy).toBe(true);
		expect(v.warning).toBeNull();
	});
	it('neznámy kód → VAROVANIE (nie odmietnutie), znamy=false', () => {
		const v = rucnaValidacia('PRP99999', KATALOG);
		expect(v.znamy).toBe(false);
		expect(v.warning).toBeTruthy();
		expect(v.warning).toMatch(/PRP99999/);
	});
	it('prázdny kód → žiadne varovanie (rieši parse ako chýbajúci)', () => {
		expect(rucnaValidacia('', KATALOG).warning).toBeNull();
		expect(rucnaValidacia('   ', KATALOG).warning).toBeNull();
	});
});

describe('parseRucnePolozky — prázdny/chybný vstup', () => {
	it('prázdny / null / whitespace → prázdne pole, žiadna chyba', () => {
		expect(parseRucnePolozky(null)).toEqual({ rows: [], error: null });
		expect(parseRucnePolozky('')).toEqual({ rows: [], error: null });
		expect(parseRucnePolozky('   ')).toEqual({ rows: [], error: null });
	});
	it('poškodený JSON → chyba (nie tiché prázdno)', () => {
		expect(parseRucnePolozky('{ nie json').error).toMatch(/prečítať|formát/i);
	});
	it('nie pole → chyba', () => {
		expect(parseRucnePolozky('{"kod":"x"}').error).toMatch(/formát/i);
	});
});

describe('parseRucnePolozky — vylúčenie prázdnych a chytenie chýb', () => {
	it('úplne prázdny riadok (bez kódu aj množstva) sa ignoruje, nie chyba', () => {
		const r = parseRucnePolozky(JSON.stringify([{ kod: '', nazov: '', mnozstvo: '', mj: 'm' }]));
		expect(r.error).toBeNull();
		expect(r.rows).toEqual([]);
	});
	it('nulové / záporné množstvo: 0 → vylúč, záporné → chyba (nikdy do Money)', () => {
		expect(
			parseRucnePolozky(JSON.stringify([{ kod: 'PRP20259', mnozstvo: 0, mj: 'm' }])).rows
		).toEqual([]);
		expect(
			parseRucnePolozky(JSON.stringify([{ kod: 'PRP20259', mnozstvo: -3, mj: 'm' }])).error
		).toMatch(/[Zz]áporn/);
	});
	it('kód bez množstva → chyba; množstvo bez kódu → chyba', () => {
		expect(
			parseRucnePolozky(JSON.stringify([{ kod: 'PRP20259', mnozstvo: '', mj: 'm' }])).error
		).toMatch(/bez množstva/i);
		expect(parseRucnePolozky(JSON.stringify([{ kod: '', mnozstvo: 5, mj: 'm' }])).error).toMatch(
			/bez Money kódu/i
		);
	});
	it('neplatná MJ → chyba (žiadne hádanie MJ)', () => {
		expect(
			parseRucnePolozky(JSON.stringify([{ kod: 'PRP20259', mnozstvo: 5, mj: 'kg' }])).error
		).toMatch(/MJ/);
	});
	it('nečíselné a absurdne veľké množstvo → chyba', () => {
		expect(
			parseRucnePolozky(JSON.stringify([{ kod: 'X', mnozstvo: 'abc', mj: 'm' }])).error
		).toMatch(/[Nn]eplatné množstvo/);
		expect(
			parseRucnePolozky(JSON.stringify([{ kod: 'X', mnozstvo: RUCNE_MNOZSTVO_MAX + 1, mj: 'm' }]))
				.error
		).toMatch(/veľké/i);
	});
});

describe('parseRucnePolozky — platné riadky (merge, MJ, čiarka)', () => {
	it('m aj ks riadok prejdú so správnou MJ; čiarka → bodka', () => {
		const raw = JSON.stringify([
			{ kod: 'PRP20259', nazov: 'Kotviaci profil', mnozstvo: '12,5', mj: 'm' },
			{ kod: 'ZASK1', nazov: 'Kľučka', mnozstvo: 4, mj: 'ks' }
		]);
		const { rows, error } = parseRucnePolozky(raw);
		expect(error).toBeNull();
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({ kod: 'PRP20259', nazov: 'Kotviaci profil', mnozstvo: 12.5, mj: 'm' });
		expect(rows[1]).toEqual({ kod: 'ZASK1', nazov: 'Kľučka', mnozstvo: 4, mj: 'ks' });
	});
	it('chýbajúci názov → fallback na kód (nikdy prázdny názov do Money)', () => {
		const { rows } = parseRucnePolozky(JSON.stringify([{ kod: 'PRP20259', mnozstvo: 3, mj: 'm' }]));
		expect(rows[0].nazov).toBe('PRP20259');
	});
	it('množstvo sa zaokrúhli na 0,001 (ako applyEdits)', () => {
		const { rows } = parseRucnePolozky(JSON.stringify([{ kod: 'X', mnozstvo: 1.23456, mj: 'm' }]));
		expect(rows[0].mnozstvo).toBe(1.235);
	});
});
