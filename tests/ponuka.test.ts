// #277 — zdieľané ponuka helpery: sanitizácia konfigurácie + súhrn + firma. Pure, žiadny
// DB/PDF. Overuje REÁLNE hodnoty v súhrne (nie tautológie) a Money-neutralitu tvaru.
import { describe, it, expect } from 'vitest';
import {
	sanitizePonukaConfig,
	zhrnutieRiadky,
	firmaRiadky,
	FIRMA,
	DISCLAIMER,
	type PonukaConfig
} from '../src/lib/ponuka';

describe('sanitizePonukaConfig', () => {
	it('parsuje JSON string a coercuje typy (čiarka→bodka, zaokrúhlenie počtu)', () => {
		const cfg = sanitizePonukaConfig(
			JSON.stringify({
				system: '  Robust  ',
				typStrechy: 'bioklimatická lamelová',
				sirka: '3000',
				hlbka: '4000,5',
				vyskaVpredu: 2500,
				vyskaPriStene: 2800,
				farba: 'RAL 7016',
				sklo: 'Deluxe Float',
				pocetPoli: '3',
				popis: 'x'
			})
		);
		expect(cfg).toEqual({
			system: 'Robust',
			typStrechy: 'bioklimatická lamelová',
			sirka: 3000,
			hlbka: 4000.5,
			vyskaVpredu: 2500,
			vyskaPriStene: 2800,
			farba: 'RAL 7016',
			sklo: 'Deluxe Float',
			pocetPoli: 3,
			popis: 'x'
		});
	});

	it('prijme priamo objekt (nie len string)', () => {
		expect(sanitizePonukaConfig({ system: 'Slide' })).toEqual({ system: 'Slide' });
	});

	it('nevalidný JSON string → prázdna konfigurácia (nehádže)', () => {
		expect(sanitizePonukaConfig('{ nie json')).toEqual({});
	});

	it('JSON, ktorý nie je objekt (číslo) → prázdna konfigurácia', () => {
		expect(sanitizePonukaConfig('123')).toEqual({});
	});

	it('null/undefined/číslo vstup → prázdna konfigurácia', () => {
		expect(sanitizePonukaConfig(null)).toEqual({});
		expect(sanitizePonukaConfig(undefined)).toEqual({});
		expect(sanitizePonukaConfig(42)).toEqual({});
	});

	it('nekladné / neplatné rozmery sa zahodia (0, záporné, NaN)', () => {
		expect(sanitizePonukaConfig({ sirka: 0, hlbka: -5, vyskaVpredu: 'x', pocetPoli: 0 })).toEqual(
			{}
		);
	});

	it('capuje dlhé stringy a popis na 400', () => {
		const cfg = sanitizePonukaConfig({ farba: 'A'.repeat(200), popis: 'B'.repeat(500) });
		expect(cfg.farba?.length).toBe(120);
		expect(cfg.popis?.length).toBe(400);
	});

	it('prázdny string vo farbe → pole sa vynechá', () => {
		expect(sanitizePonukaConfig({ farba: '   ' })).toEqual({});
	});
});

describe('zhrnutieRiadky — reálne hodnoty, žiadna cena', () => {
	it('plná konfigurácia dá očakávané riadky s hodnotami', () => {
		const cfg: PonukaConfig = {
			system: 'Robust',
			typStrechy: 'lamelová',
			sirka: 3000,
			hlbka: 4000,
			vyskaVpredu: 2500,
			vyskaPriStene: 2800,
			pocetPoli: 3,
			farba: 'RAL 7016',
			sklo: 'Deluxe',
			popis: 'poznámka'
		};
		const rows = zhrnutieRiadky(cfg);
		const map = Object.fromEntries(rows.map((r) => [r.label, r.value]));
		expect(map['Systém']).toBe('Robust');
		expect(map['Rozmery (š × h)']).toBe('3000 × 4000 mm');
		expect(map['Výška']).toBe('vpredu 2500 mm / pri stene 2800 mm');
		expect(map['Počet polí']).toBe('3');
		expect(map['Farba konštrukcie']).toBe('RAL 7016');
		expect(map['Sklo / výplň']).toBe('Deluxe');
		// NULA cien nikde
		const all = rows.map((r) => `${r.label} ${r.value}`).join(' ');
		expect(all).not.toMatch(/€|EUR|cena|price/i);
	});

	it('len šírka / len hĺbka → samostatný riadok', () => {
		expect(
			zhrnutieRiadky({ sirka: 3000 }).some((r) => r.label === 'Šírka' && r.value === '3000 mm')
		).toBe(true);
		expect(
			zhrnutieRiadky({ hlbka: 4000 }).some((r) => r.label === 'Hĺbka' && r.value === '4000 mm')
		).toBe(true);
	});

	it('len jedna výška → samostatný riadok', () => {
		expect(zhrnutieRiadky({ vyskaVpredu: 2500 }).some((r) => r.label === 'Výška vpredu')).toBe(
			true
		);
		expect(zhrnutieRiadky({ vyskaPriStene: 2800 }).some((r) => r.label === 'Výška pri stene')).toBe(
			true
		);
	});

	it('prázdna konfigurácia → žiadne riadky', () => {
		expect(zhrnutieRiadky({})).toEqual([]);
	});
});

describe('firmaRiadky + konštanty', () => {
	it('default FIRMA (bez kontaktu) → len web', () => {
		expect(firmaRiadky()).toEqual(['app.montalu.cloud']);
	});

	it('vyplnená firma → všetky riadky v poradí', () => {
		expect(
			firmaRiadky({ adresa: 'Ulica 1', telefon: '+421 900 000 000', email: 'a@b.sk', web: 'x.sk' })
		).toEqual(['Ulica 1', 'Tel.: +421 900 000 000', 'a@b.sk', 'x.sk']);
	});

	it('DISCLAIMER hovorí, že to NIE je cenová ponuka', () => {
		expect(DISCLAIMER).toMatch(/nezáväzná špecifikácia/i);
		expect(DISCLAIMER).toMatch(/nie cenová ponuka/i);
		expect(FIRMA.nazov).toBe('Montalu');
	});
});
