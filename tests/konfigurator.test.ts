// Verejný konfigurátor pergoly (#275) — čistý výpočtový engine (súhrn z rozmerov).
// Display-only, žiadny Money/nárez. Overuje dopočet výšky pri stene, sklon (round-trip
// cez engine `pergola-navrh`), svetlú výšku a zastrešenú plochu.
import { describe, it, expect } from 'vitest';
import {
	konfiguruj,
	vyskaPriStene,
	zastresenaPlocha,
	typSkla3D,
	KONF_RANGES,
	type KonfiguratorVstup
} from '../src/lib/konfigurator';
import { NOSNIK_HRUBKA_MM } from '../src/lib/pergola-navrh';
import { SKLO_STRECHA_TYPY } from '../src/lib/sklo-strecha';
import { PERGOLA_SKLA_NAZVY } from '../src/lib/vizual/pergola-sklo';

const vstup = (o: Partial<KonfiguratorVstup> = {}): KonfiguratorVstup => ({
	sirka: 4000,
	hlbka: 3500,
	vyskaVpredu: 2500,
	sklonDeg: 6,
	sklo: '4.4.2 číre',
	farba: 'RAL 7016 ANTRACIT',
	...o
});

describe('konfigurátor — dopočet geometrie', () => {
	it('vyskaPriStene stúpa k stene o tan(sklon)·hĺbka (pultová strecha)', () => {
		// 2500 + tan(6°)*3500 = 2500 + 367.86 = 2867.86 → 2867.9
		expect(vyskaPriStene(2500, 6, 3500)).toBe(2867.9);
		// rovná strecha (0°) → výška pri stene = výška vpredu
		expect(vyskaPriStene(2500, 0, 3500)).toBe(2500);
	});

	it('zastresenaPlocha = šírka·hĺbka v m² (1 desatinné)', () => {
		expect(zastresenaPlocha(4000, 3500)).toBe(14);
		expect(zastresenaPlocha(3000, 2500)).toBe(7.5);
	});

	it('konfiguruj vráti kompletný súhrn s dopočítanými hodnotami', () => {
		const s = konfiguruj(vstup());
		expect(s).toEqual({
			sirka: 4000,
			hlbka: 3500,
			vyskaVpredu: 2500,
			vyskaPriStene: 2867.9,
			sklonDeg: 6, // round-trip cez vypocitajSklon → zadaný sklon (v rámci zaokrúhlenia)
			svetlaVyska: 2310, // 2500 − NOSNIK_HRUBKA_MM (190)
			zastresenaPlochaM2: 14,
			sklo: '4.4.2 číre',
			farba: 'RAL 7016 ANTRACIT'
		});
	});

	it('svetlá výška = výška vpredu − hrúbka nosníka (engine konštanta)', () => {
		const s = konfiguruj(vstup({ vyskaVpredu: 3000 }));
		expect(s.svetlaVyska).toBe(3000 - NOSNIK_HRUBKA_MM);
	});

	it('sklon 0° → výška pri stene = výška vpredu, sklon 0', () => {
		const s = konfiguruj(vstup({ sklonDeg: 0 }));
		expect(s.vyskaPriStene).toBe(s.vyskaVpredu);
		expect(s.sklonDeg).toBe(0);
	});

	it('súhrn NEOBSAHUJE žiadnu cenu ani Money kód ani nárezové polia', () => {
		const s = konfiguruj(vstup());
		const kluce = Object.keys(s);
		expect(kluce).not.toContain('cena');
		expect(kluce).not.toContain('moneyKod');
		expect(kluce).not.toContain('panelSirka');
		expect(kluce).not.toContain('panelDlzka');
		expect(kluce).not.toContain('krovy');
		expect(JSON.stringify(s)).not.toMatch(/€|TS\d{3}/);
	});

	it('KONF_RANGES sú zmysluplné rozmedzia (min < max) — pre klienta', () => {
		for (const r of Object.values(KONF_RANGES)) expect(r.min).toBeLessThan(r.max);
	});
});

describe('konfigurátor — typSkla3D (názov skla → vizuálny odtieň 3D náhľadu, #276)', () => {
	it('číre názvy → cire', () => {
		expect(typSkla3D('4.4.2 číre')).toBe('cire');
		expect(typSkla3D('5.5.2 číre')).toBe('cire');
		expect(typSkla3D('IZO 4.4.2-8-6 číre')).toBe('cire');
		expect(typSkla3D('polykarbonát 16 mm číry')).toBe('cire');
	});

	it('mliečne / matné / STADUR (opálový mliečny vzhľad) → matne', () => {
		expect(typSkla3D('4.4.2 mliečne')).toBe('matne');
		expect(typSkla3D('polykarbonát 16 mm mliečny')).toBe('matne');
		expect(typSkla3D('4.4.2 mliečne/8/6 mliečne')).toBe('matne');
		expect(typSkla3D('STADUR 24 mm')).toBe('matne');
	});

	it('bronz → bronzove', () => {
		expect(typSkla3D('polykarbonát 16 mm bronz')).toBe('bronzove');
	});

	it('dymové (rezerva pre budúci katalóg) → dymove', () => {
		expect(typSkla3D('dymové sklo')).toBe('dymove');
	});

	it('IZO bez prípony číre/mliečne → cire (default transparentné)', () => {
		expect(typSkla3D('IZO 4.4.2-10-6')).toBe('cire');
		expect(typSkla3D('IZO 5.5.2-8-6')).toBe('cire');
	});

	it('neznámy / prázdny názov → cire (nikdy nespadne, vždy platný odtieň)', () => {
		expect(typSkla3D('')).toBe('cire');
		expect(typSkla3D('xyz nič')).toBe('cire');
	});

	it('KAŽDÝ reálny katalógový názov sa mapuje na platný odtieň (kontrakt úplnosti)', () => {
		const platneOdtiene = Object.keys(PERGOLA_SKLA_NAZVY);
		for (const t of SKLO_STRECHA_TYPY) {
			expect(platneOdtiene).toContain(typSkla3D(t.nazov));
		}
	});
});
