// #548: „iné sklo" na objednávke skla — vlastný typ + cena €/m² (XOR s katalógom). Money-NEUTRÁLNE.
import { describe, it, expect } from 'vitest';
import {
	pridajSkloManual,
	nastavTypManual,
	nastavTypSkla,
	rozriesTypSkla,
	listSklaPreZakazku,
	getSkloPolozka
} from '../src/lib/server/objednavka-skla';

describe('#548 rozriesTypSkla — XOR katalóg vs „iné sklo"', () => {
	it('katalóg → uloží typ_skla, manuálne NULL', () => {
		expect(rozriesTypSkla({ typSkla: '4.4.2 číre' })).toEqual({
			typSkla: '4.4.2 číre',
			typSklaManual: null,
			cenaM2Manual: null
		});
	});
	it('iné sklo → typ_skla prázdny, manuálne vyplnené (cena zaokrúhlená na 2 des.)', () => {
		expect(rozriesTypSkla({ typSklaManual: 'lepené 33.1', cenaM2Manual: 42.567 })).toEqual({
			typSkla: '',
			typSklaManual: 'lepené 33.1',
			cenaM2Manual: 42.57
		});
	});
	it('oboje (katalóg + manuál) → throw', () => {
		expect(() =>
			rozriesTypSkla({ typSkla: '4.4.2 číre', typSklaManual: 'x', cenaM2Manual: 10 })
		).toThrow();
	});
	it('nič → throw', () => {
		expect(() => rozriesTypSkla({})).toThrow();
	});
	it('manuál bez ceny / cena <= 0 → throw', () => {
		expect(() => rozriesTypSkla({ typSklaManual: 'x' })).toThrow();
		expect(() => rozriesTypSkla({ typSklaManual: 'x', cenaM2Manual: 0 })).toThrow();
		expect(() => rozriesTypSkla({ typSklaManual: 'x', cenaM2Manual: -5 })).toThrow();
	});
	it('manuál prázdny typ ale cena zadaná → throw (vlastný typ povinný)', () => {
		expect(() => rozriesTypSkla({ typSklaManual: '   ', cenaM2Manual: 10 })).toThrow();
	});
});

describe('#548 pridajSkloManual — „iné sklo" riadok', () => {
	it('uloží typ_skla_manual + cena_m2_manual, typ_skla prázdny', () => {
		const zak = 'ZAK-548-INE-A';
		const id = pridajSkloManual({
			zak,
			popis: 'ATYP bronz',
			typSklaManual: 'lepené 33.1 bronz',
			cenaM2Manual: 55.5,
			sirkaMm: 1000,
			vyskaMm: 500,
			pocet: 2,
			rezim: 'atyp',
			createdBy: 'test'
		});
		const r = getSkloPolozka(id)!;
		expect(r.typSkla).toBe('');
		expect(r.typSklaManual).toBe('lepené 33.1 bronz');
		expect(r.cenaM2Manual).toBe(55.5);
		expect(r.rezim).toBe('atyp');
	});

	it('katalógový riadok → manuálne stĺpce NULL', () => {
		const zak = 'ZAK-548-INE-CAT';
		pridajSkloManual({
			zak,
			popis: 'x',
			typSkla: '4.4.2 číre',
			sirkaMm: 1000,
			vyskaMm: 1000,
			pocet: 1,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		const r = listSklaPreZakazku(zak)[0]!;
		expect(r.typSkla).toBe('4.4.2 číre');
		expect(r.typSklaManual).toBeNull();
		expect(r.cenaM2Manual).toBeNull();
	});

	it('ani katalóg ani manuál → throw, nič sa neuloží', () => {
		const zak = 'ZAK-548-INE-NIC';
		expect(() =>
			pridajSkloManual({
				zak,
				popis: 'x',
				sirkaMm: 1000,
				vyskaMm: 1000,
				pocet: 1,
				rezim: 'rozmery',
				createdBy: 'test'
			})
		).toThrow();
		expect(listSklaPreZakazku(zak)).toHaveLength(0);
	});
});

describe('#548 nastavTypManual — „iné sklo" na existujúcom riadku', () => {
	it('prepne katalógový riadok na „iné sklo" (typ_skla vynulovaný)', () => {
		const zak = 'ZAK-548-INE-SWITCH';
		const id = pridajSkloManual({
			zak,
			popis: 'x',
			typSkla: '4.4.2 číre',
			sirkaMm: 1000,
			vyskaMm: 1000,
			pocet: 1,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		nastavTypManual(id, 'kalené 8 mm sklo', 78.9);
		const r = getSkloPolozka(id)!;
		expect(r.typSkla).toBe('');
		expect(r.typSklaManual).toBe('kalené 8 mm sklo');
		expect(r.cenaM2Manual).toBe(78.9);
	});

	it('neplatná cena → throw', () => {
		const zak = 'ZAK-548-INE-BADCENA';
		const id = pridajSkloManual({
			zak,
			popis: 'x',
			typSkla: '4.4.2 číre',
			sirkaMm: 1000,
			vyskaMm: 1000,
			pocet: 1,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		expect(() => nastavTypManual(id, 'x', 0)).toThrow();
		expect(() => nastavTypManual(id, '', 10)).toThrow();
	});

	// GK review (#548): prepnutie „iné sklo" → SPÄŤ na katalóg MUSÍ vynulovať manuálne stĺpce,
	// inak riadok ostane v XOR-zakázanom stave (typ_skla AJ typ_skla_manual) a builder pošle staré
	// „iné sklo". `nastavTypSkla` je symetrické k `nastavTypManual`.
	it('manuál → katalóg cez nastavTypSkla vynuluje typ_skla_manual + cena_m2_manual', () => {
		const zak = 'ZAK-548-INE-BACK';
		const id = pridajSkloManual({
			zak,
			popis: 'x',
			typSklaManual: 'lepené 33.1 bronz',
			cenaM2Manual: 55.5,
			sirkaMm: 1000,
			vyskaMm: 1000,
			pocet: 1,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		// medzistav: manuálny riadok
		expect(getSkloPolozka(id)!.typSklaManual).toBe('lepené 33.1 bronz');
		// prepni na katalóg
		nastavTypSkla(id, '4.4.2 číre');
		const r = getSkloPolozka(id)!;
		expect(r.typSkla).toBe('4.4.2 číre');
		expect(r.typSklaManual).toBeNull();
		expect(r.cenaM2Manual).toBeNull();
	});
});
