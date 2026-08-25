// Strešné sklo pergoly — vzorec šírky + počet tabúľ + honest-null dĺžka (#223).
// Konzumuje POTVRDENÚ A1 (Dominik #198, 21.8.): šírka skla = svetlosť medzi krovmi + 30
// (sklo/STADUR) / + 34 (polykarbonát 16 mm); stredová výstuha 140 do šírky NEvstupuje.
// DĹŽKA tabule je honest-null — chatové +30/+40 bolo prehodnotené na prítlačnú lištu
// (#198, 21.8. 09:20), delta HH krovu→sklo nepotvrdená → dĺžka sa NEpočíta.
//
// PURE modul (žiadna DB/server) — priamo unit-testovateľný. Strešné sklo je Money-NEUTRÁLNE
// (display-only), NIKDY nevstupuje do `vypocitane`/Money.
import { describe, it, expect } from 'vitest';
import {
	spocitajStrechaSklo,
	jePolykarbonatSklo,
	strechaSkloSirkaPridavok,
	SKLO_STRECHA_SIRKA_PRIDAVOK_SKLO,
	SKLO_STRECHA_SIRKA_PRIDAVOK_POLYKARBONAT
} from '../src/lib/pergola-sklo';
import type { PergolaNarezVstup } from '../src/lib/pergola-narez';

// Golden vektor OP260282 (Massive, n=8, sklo 4-4-2číre-8-6 = IZO 4.4.2-8-6 číre).
// svetlosť medzi krovmi = (4990 − 50·8 − 2)/7 = 655,43 → šírka skla = 655,43 + 30 = 685,43.
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
	pocetKrovov: 8,
	strechaSkloTyp: 'IZO 4.4.2-8-6 číre'
};

describe('strechaSkloSirkaPridavok / jePolykarbonatSklo — +30 sklo/STADUR, +34 polykarbonát', () => {
	it('konštanty: sklo/STADUR = 30, polykarbonát = 34', () => {
		expect(SKLO_STRECHA_SIRKA_PRIDAVOK_SKLO).toBe(30);
		expect(SKLO_STRECHA_SIRKA_PRIDAVOK_POLYKARBONAT).toBe(34);
	});
	it('lepené/izolačné sklo → +30, nie polykarbonát', () => {
		expect(jePolykarbonatSklo('IZO 4.4.2-8-6 číre')).toBe(false);
		expect(strechaSkloSirkaPridavok('IZO 4.4.2-8-6 číre')).toBe(30);
		expect(strechaSkloSirkaPridavok('4.4.2 číre')).toBe(30);
	});
	it('STADUR 24 mm → +30 (šírka ako sklo, nie polykarbonát)', () => {
		expect(jePolykarbonatSklo('STADUR 24 mm')).toBe(false);
		expect(strechaSkloSirkaPridavok('STADUR 24 mm')).toBe(30);
	});
	it('polykarbonát 16 mm (číry/mliečny/bronz) → +34', () => {
		for (const t of [
			'polykarbonát 16 mm číry',
			'polykarbonát 16 mm mliečny',
			'polykarbonát 16 mm bronz'
		]) {
			expect(jePolykarbonatSklo(t)).toBe(true);
			expect(strechaSkloSirkaPridavok(t)).toBe(34);
		}
	});
});

describe('spocitajStrechaSklo — golden OP260282 (Massive, n=8, IZO 4.4.2-8-6 číre)', () => {
	const r = spocitajStrechaSklo(OP260282);
	it('typ = zvolený katalógový typ', () => {
		expect(r.typ).toBe('IZO 4.4.2-8-6 číre');
		expect(r.jePolykarbonat).toBe(false);
		expect(r.sirkaPridavok).toBe(30);
	});
	it('počet tabúľ = počet polí medzi krovmi = n − 1 = 7', () => {
		expect(r.pocetTabul).toBe(7);
	});
	it('šírka tabule = svetlosť medzi krovmi 655,43 + 30 = 685,43 mm', () => {
		expect(r.sirkaMm).toBe(685.43);
	});
	it('dĺžka tabule = honest-null (vzorec dĺžky nepotvrdený)', () => {
		expect(r.dlzkaMm).toBeNull();
	});
	it('Money kód = TS00014 (potvrdené mapovanie, #274)', () => {
		expect(r.moneyKod).toBe('TS00014');
	});
	it('poznámka o čakajúcej dĺžke je prítomná (plain, bez interných referencií)', () => {
		expect(r.poznamky.some((p) => /dĺžk/i.test(p))).toBe(true);
		expect(r.poznamky.join(' ')).not.toMatch(/#\d|\bO\d/);
	});
});

describe('spocitajStrechaSklo — Robust vetva + polykarbonát +34', () => {
	const base: PergolaNarezVstup = {
		...OP260282,
		system: 'Robust',
		hornyProfilZadnej: 110,
		zosilnenyNosnik: false,
		sirka: 4000,
		pocetKrovov: 6, // svetlosť = (4000 − 302)/5 = 739,6
		strechaSkloTyp: 'polykarbonát 16 mm číry'
	};
	const r = spocitajStrechaSklo(base);
	it('počet tabúľ = 6 − 1 = 5', () => {
		expect(r.pocetTabul).toBe(5);
	});
	it('polykarbonát → šírka = svetlosť 739,6 + 34 = 773,6 mm', () => {
		expect(r.sirkaPridavok).toBe(34);
		expect(r.sirkaMm).toBe(773.6);
	});
	it('polykarbonát 16 mm nemá potvrdený Money kód → honest-null', () => {
		expect(r.moneyKod).toBeNull();
		expect(r.poznamky.some((p) => /karta.*Money|cena nedostupn/i.test(p))).toBe(true);
	});
});

describe('spocitajStrechaSklo — honest-null vetvy', () => {
	it('bez zvoleného typu → všetko null + výzva vybrať typ', () => {
		const r = spocitajStrechaSklo({ ...OP260282, strechaSkloTyp: '' });
		expect(r.typ).toBeNull();
		expect(r.pocetTabul).toBeNull();
		expect(r.sirkaMm).toBeNull();
		expect(r.dlzkaMm).toBeNull();
		expect(r.sirkaPridavok).toBeNull();
		expect(r.poznamky.some((p) => /vyber typ/i.test(p))).toBe(true);
	});
	it('neznámy typ mimo katalógu → honest-null (nič sa nedopočítava)', () => {
		const r = spocitajStrechaSklo({ ...OP260282, strechaSkloTyp: 'nejaké vymyslené sklo' });
		expect(r.typ).toBeNull();
		expect(r.sirkaMm).toBeNull();
	});
	it('typ zvolený, ale bez počtu krovov → počet tabúľ aj šírka null, výzva zadať krovy', () => {
		const r = spocitajStrechaSklo({ ...OP260282, pocetKrovov: null });
		expect(r.typ).toBe('IZO 4.4.2-8-6 číre');
		expect(r.pocetTabul).toBeNull();
		expect(r.sirkaMm).toBeNull();
		expect(r.poznamky.some((p) => /po[čc]et krovov/i.test(p))).toBe(true);
	});
});
