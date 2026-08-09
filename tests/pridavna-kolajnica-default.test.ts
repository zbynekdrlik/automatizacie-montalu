// #132 ROZHODNUTÉ — Patrik (Odoo 207, msg #1646652, 2026-08-09): „my vždy dávame
// pri štandardoch IZO spodnú koľaj navyše ale iba spodnú". Checkbox „Prídavná
// koľajnica" (railUpsize v compute.ts) sa doteraz VŽDY predvypĺňal nezaškrtnutý
// (dá sa zabudnúť zaškrtnúť → nesprávny odpis ZASP00104 namiesto ZASP00030).
// `pridavnaKolajnicaDefault` je jeden zdroj pravdy pre nový DEFAULT — rovnaký
// gate ako viditeľnosť checkboxu v +page.svelte (Štandard +, mimo 6K) plus
// „a sklo je izolačné" (`jeIzoSklo`, ten istý zdroj, ktorý používa `sysStylPre`
// na výber basic/IZO nárezáku). Čisto UI default — `railUpsize` sám je a ostáva
// nezávislý od skla (Dominik), takže žiadny server-side kód sa nemení.
import { describe, it, expect } from 'vitest';
import { pridavnaKolajnicaDefault } from '../src/lib/styl';

describe('pridavnaKolajnicaDefault — #132', () => {
	it('true na Štandard + s izolačným sklom (2K aj 3K)', () => {
		expect(pridavnaKolajnicaDefault('Štandard +', '2K', 'Izolačné sklo 4.8.4')).toBe(true);
		expect(pridavnaKolajnicaDefault('Štandard +', '3K', 'Izolačné sklo 4.8.4')).toBe(true);
	});

	it('false na Štandard + s NEizolačným sklom — obsluha si ju musí zapnúť sama', () => {
		expect(pridavnaKolajnicaDefault('Štandard +', '2K', 'Float sklo 4 mm')).toBe(false);
		expect(pridavnaKolajnicaDefault('Štandard +', '2K', 'Float sklo 6 mm')).toBe(false);
		expect(pridavnaKolajnicaDefault('Štandard +', '2K', '')).toBe(false);
	});

	it('false na 6K — checkbox tam v UI vôbec nie je (7K koľajnica neexistuje)', () => {
		expect(pridavnaKolajnicaDefault('Štandard +', '6K', 'Izolačné sklo 4.8.4')).toBe(false);
		expect(pridavnaKolajnicaDefault('Štandard +', '2x6K', 'Izolačné sklo 4.8.4')).toBe(false);
	});

	it('false mimo Štandard + — checkbox sa tam v UI vôbec nezobrazuje', () => {
		expect(pridavnaKolajnicaDefault('Štandard', '2K', 'Izolačné sklo 4.8.4')).toBe(false);
		expect(pridavnaKolajnicaDefault('Robust', '2K', 'Izolačné sklo 4/16/4 číre')).toBe(false);
		expect(pridavnaKolajnicaDefault('Deluxe', '2K', '')).toBe(false);
		expect(pridavnaKolajnicaDefault('Slide', '2K', 'Izolačné sklo 4/8/4 číre')).toBe(false);
	});
});
