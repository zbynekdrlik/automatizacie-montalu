// Pergola — materiál/nárez z rozmerov (#155): parser formulárového vstupu. Rovnaká
// disciplína ako pergola-navrh-vstup / bazen-navrh-vstup — testuje parsovanie a že
// validácia je zapojená.
import { describe, it, expect } from 'vitest';
import { parsePergolaNarezVstup } from '../src/lib/server/pergola-narez-vstup';

function fd(entries: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(entries)) f.set(k, v);
	return f;
}

const PLATNY = {
	system: 'Massive',
	sirka: '5760',
	hlbka: '3690',
	prednaSvetlost: '2200',
	vyskaZadna: '2900',
	pocetPrednychNoh: '4',
	uchytenie: 'stena',
	pocetZadnychNoh: '4',
	hornyProfilZadnej: '140'
};

describe('parsePergolaNarezVstup', () => {
	it('platný vstup → žiadna chyba, hodnoty sparsované', () => {
		const { vstup, error } = parsePergolaNarezVstup(fd(PLATNY));
		expect(error).toBeNull();
		expect(vstup.system).toBe('Massive');
		expect(vstup.sirka).toBe(5760);
		expect(vstup.pocetPrednychNoh).toBe(4);
		expect(vstup.hornyProfilZadnej).toBe(140);
		expect(vstup.uchytenie).toBe('stena');
	});

	it('desatinná čiarka sa parsuje ako bodka (5,76 → 5.76)', () => {
		const { vstup } = parsePergolaNarezVstup(fd({ ...PLATNY, prednaSvetlost: '2200,5' }));
		expect(vstup.prednaSvetlost).toBe(2200.5);
	});

	it('prázdna predná svetlosť → štandard 2200', () => {
		const { vstup } = parsePergolaNarezVstup(fd({ ...PLATNY, prednaSvetlost: '' }));
		expect(vstup.prednaSvetlost).toBe(2200);
	});

	it('neznámy systém → fallback Robust', () => {
		const { vstup } = parsePergolaNarezVstup(fd({ ...PLATNY, system: 'XXX' }));
		expect(vstup.system).toBe('Robust');
	});

	it('horný profil zadnej: iné než 140 → fallback 110', () => {
		expect(
			parsePergolaNarezVstup(fd({ ...PLATNY, hornyProfilZadnej: '999' })).vstup.hornyProfilZadnej
		).toBe(110);
		expect(
			parsePergolaNarezVstup(fd({ ...PLATNY, hornyProfilZadnej: '140' })).vstup.hornyProfilZadnej
		).toBe(140);
	});

	it('checkboxy prieckaLight/zosilnenyNosnik (hodnota "1" alebo "on")', () => {
		const { vstup } = parsePergolaNarezVstup(
			fd({ ...PLATNY, prieckaLight: '1', zosilnenyNosnik: 'on' })
		);
		expect(vstup.prieckaLight).toBe(true);
		expect(vstup.zosilnenyNosnik).toBe(true);
		const { vstup: v2 } = parsePergolaNarezVstup(fd(PLATNY));
		expect(v2.prieckaLight).toBe(false);
		expect(v2.zosilnenyNosnik).toBe(false);
	});

	it('validácia je zapojená — neplatná šírka vráti chybu, nie tichý prechod', () => {
		const { error } = parsePergolaNarezVstup(fd({ ...PLATNY, sirka: '10' }));
		expect(error).toMatch(/šírka/i);
	});

	it('samostatne stojaca s neplatnou zadnou výškou = chyba', () => {
		const { error } = parsePergolaNarezVstup(
			fd({ ...PLATNY, uchytenie: 'samostatne', vyskaZadna: '10' })
		);
		expect(error).toMatch(/zadná|výšk/i);
	});

	it('#161 sklon strechy: prázdny → null (voliteľný, žiadna chyba)', () => {
		const { vstup, error } = parsePergolaNarezVstup(fd({ ...PLATNY }));
		expect(error).toBeNull();
		expect(vstup.sklonStrechy).toBeNull();
	});

	it('#161 sklon strechy: zadaný 8 → 8; čiarka 7,2 → 7.2', () => {
		expect(parsePergolaNarezVstup(fd({ ...PLATNY, sklonStrechy: '8' })).vstup.sklonStrechy).toBe(8);
		expect(parsePergolaNarezVstup(fd({ ...PLATNY, sklonStrechy: '7,2' })).vstup.sklonStrechy).toBe(
			7.2
		);
	});

	it('#161 sklon strechy pod 7° je PLATNÝ vstup (engine ho hlási ako nepodporované, nie chybou)', () => {
		const { vstup, error } = parsePergolaNarezVstup(fd({ ...PLATNY, sklonStrechy: '5' }));
		expect(error).toBeNull();
		expect(vstup.sklonStrechy).toBe(5);
	});

	it('#161 sklon strechy mimo obranného rozsahu (200°) = chyba', () => {
		const { error } = parsePergolaNarezVstup(fd({ ...PLATNY, sklonStrechy: '200' }));
		expect(error).toMatch(/sklon/i);
	});

	it('#161 počet krovov: prázdny → null (voliteľný, auto fallback, žiadna chyba)', () => {
		const { vstup, error } = parsePergolaNarezVstup(fd({ ...PLATNY }));
		expect(error).toBeNull();
		expect(vstup.pocetKrovov).toBeNull();
	});

	it('#161 počet krovov: zadané 8 → 8', () => {
		const { vstup, error } = parsePergolaNarezVstup(fd({ ...PLATNY, pocetKrovov: '8' }));
		expect(error).toBeNull();
		expect(vstup.pocetKrovov).toBe(8);
	});

	it('#161 počet krovov mimo rozsahu (1) = chyba', () => {
		const { error } = parsePergolaNarezVstup(fd({ ...PLATNY, pocetKrovov: '1' }));
		expect(error).toMatch(/počet krovov/i);
	});

	it('#161 počet krovov necelé číslo (8,5) = chyba (celé číslo)', () => {
		const { error } = parsePergolaNarezVstup(fd({ ...PLATNY, pocetKrovov: '8,5' }));
		expect(error).toMatch(/počet krovov|celé/i);
	});

	// --- #206 nové polia (a/c/d/e) ---------------------------------------------------
	it('#206 (a) jednoduchá bez zasklenia: checkbox "1"/"on" → true, inak false', () => {
		expect(
			parsePergolaNarezVstup(fd({ ...PLATNY, jednoduchaBezZasklenia: '1' })).vstup
				.jednoduchaBezZasklenia
		).toBe(true);
		expect(parsePergolaNarezVstup(fd(PLATNY)).vstup.jednoduchaBezZasklenia).toBe(false);
	});

	it('#206 (c) profil výstuhy: známa hodnota prejde, neznáma → null', () => {
		expect(
			parsePergolaNarezVstup(fd({ ...PLATNY, vystuhaProfil: '200x140' })).vstup.vystuhaProfil
		).toBe('200x140');
		expect(
			parsePergolaNarezVstup(fd({ ...PLATNY, vystuhaProfil: '110x250' })).vstup.vystuhaProfil
		).toBe('110x250');
		expect(
			parsePergolaNarezVstup(fd({ ...PLATNY, vystuhaProfil: 'XxY' })).vstup.vystuhaProfil
		).toBe(null);
		expect(parsePergolaNarezVstup(fd(PLATNY)).vstup.vystuhaProfil).toBe(null);
	});

	it('#206 (d) zvod frézovanie: toggle + výška; zapnuté bez výšky = chyba', () => {
		const { vstup, error } = parsePergolaNarezVstup(
			fd({ ...PLATNY, zvodFrezovat: '1', zvodFrezovanieSHmm: '120' })
		);
		expect(error).toBeNull();
		expect(vstup.zvodFrezovat).toBe(true);
		expect(vstup.zvodFrezovanieSHmm).toBe(120);
		// zapnuté bez výšky → validácia chytí
		expect(parsePergolaNarezVstup(fd({ ...PLATNY, zvodFrezovat: '1' })).error).toMatch(
			/frézovani|SH/i
		);
	});

	it('#206 (e) sklá: voľný text sa orezáva a prenáša (žiadny Money výpočet)', () => {
		const { vstup } = parsePergolaNarezVstup(
			fd({
				...PLATNY,
				strechaSklo: '  4-4-2číre-8-6stopsol classic grey  ',
				obvodoveZasklenie: 'RS STANDARD PLUS 4-8-4číre'
			})
		);
		expect(vstup.strechaSklo).toBe('4-4-2číre-8-6stopsol classic grey');
		expect(vstup.obvodoveZasklenie).toBe('RS STANDARD PLUS 4-8-4číre');
	});
});
