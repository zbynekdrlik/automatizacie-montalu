// Pergola — GOLDEN / verifikačný test proti reálnemu CAD Plánu rezov zákazky OP260282
// (#207). Výkres „PERGOLA MASSIVE 140 SAMOSTOJACA" od Dominika (Odoo správa #1691126,
// 14.8.2026) je prvá skutočná zákazka s presnými vstupmi AJ zdrojovým Plánom rezov 1:1 —
// ideálny vektor na overenie vzorcov doplnených v #205.
//
// DISCIPLÍNA (#155 HARD boundary, #207 §3): engine počíta LEN POTVRDENÉ vzorce. Riadok,
// ktorý sa z potvrdených vzorcov NEDÁ reprodukovať (dĺžka viazaná na HH krovu, alebo
// poznámka výkresu si protirečí s hodnotou), sa NEFITUJE nasilu — test asertuje engine
// čestný null / divergenciu a GAP je nižšie explicitne vypísaný (aj v PR/komentári #205).
//
// RED-first: proti súčasnému enginu (pred #205) tento test PADNE — žľab/kotviaci/back-top/
// výstuha ešte nie sú vo `vypocitane`. Po #205 PREJDE → dôkaz, že testuje nové vzorce.
//
// Display-only — do Money NIČ nezapisuje (statický guard: pergola-narez-money-safety.test.ts).
import { describe, it, expect } from 'vitest';
import {
	spocitajNarez,
	pocetTyci,
	VYSTUHA_ODPOCET,
	TYC_STANDARD_MM,
	TYC_ZLAB_KOTVIACI_MM,
	type PergolaNarezVstup,
	type PolozkaNarezu
} from '../src/lib/pergola-narez';

// Vstupy zákazky OP260282 (z tela #207 aj z výkresu, prečítaného ako dokument). Počet
// nôh nie je v 12-riadkovom Pláne rezov (stĺpy 18017 nie sú v cut-liste) a NEOVPLYVŇUJE
// žiaden z asertovaných riadkov — volíme platné hodnoty.
const OP260282: PergolaNarezVstup = {
	system: 'Massive',
	sirka: 4990,
	hlbka: 3470,
	prednaSvetlost: 2200,
	vyskaZadna: 2790,
	pocetPrednychNoh: 4,
	uchytenie: 'samostatne',
	pocetZadnychNoh: 4,
	hornyProfilZadnej: 140,
	prieckaLight: false,
	zosilnenyNosnik: true, // výstuha 140×140 prítomná
	sklonStrechy: 6.1
};

function riadok(
	v: PolozkaNarezu[],
	pred: (p: PolozkaNarezu) => boolean
): PolozkaNarezu | undefined {
	return v.find(pred);
}

describe('OP260282 golden — ODVODITEĽNÉ riadky (presne na výkres)', () => {
	const r = spocitajNarez(OP260282);

	it('r.4 žľabový profil 18018 = šírka 4990, 1 ks, výdaj 1×(6 m)', () => {
		const zlab = riadok(r.vypocitane, (p) => p.kod === '18018' && /žľab|žlab/i.test(p.nazov));
		expect(zlab, 'žľab (18018) musí byť vo vypocitane').toBeTruthy();
		expect(zlab!.dlzkaRezuMm).toBe(4990);
		expect(zlab!.pocetKs).toBe(1);
		expect(zlab!.vydajTyce).toEqual({ tycMm: TYC_ZLAB_KOTVIACI_MM, pocet: 1 }); // 6 m
	});

	it('r.2 kotviaci profil horný 18019 = šírka 4990, 1 ks, výdaj 1×(6 m)', () => {
		const kot = riadok(r.vypocitane, (p) => p.kod === '18019');
		expect(kot, 'kotviaci (18019) musí byť vo vypocitane').toBeTruthy();
		expect(kot!.dlzkaRezuMm).toBe(4990);
		expect(kot!.pocetKs).toBe(1);
		expect(kot!.vydajTyce).toEqual({ tycMm: TYC_ZLAB_KOTVIACI_MM, pocet: 1 }); // 6 m
	});

	it('r.1 zadná konštrukcia horná 18013 = šírka 4990, 1 ks (len samostatne stojaca)', () => {
		const bt = riadok(r.vypocitane, (p) => p.kod === '18013' && /zadná konštr/i.test(p.nazov));
		expect(bt, 'zadná konštrukcia horná (18013) musí byť vo vypocitane pri SS').toBeTruthy();
		expect(bt!.dlzkaRezuMm).toBe(4990);
		expect(bt!.pocetKs).toBe(1);
		// vlastný výdaj = 1×(7,5 m); výkres zdieľa tyče so zadnými nohami (r.3) → 2×(7,5 m)
		expect(bt!.vydajTyce).toEqual({ tycMm: TYC_STANDARD_MM, pocet: 1 });
	});

	it('r.5 výstuha horná 18017 = šírka − 280 = 4710, 1 ks (massive + zosilnený nosník)', () => {
		const vy = riadok(r.vypocitane, (p) => p.kod === '18017' && /výstuha/i.test(p.nazov));
		expect(vy, 'výstuha horná (18017) musí byť vo vypocitane pri massive+zosilnení').toBeTruthy();
		expect(vy!.dlzkaRezuMm).toBe(4990 - VYSTUHA_ODPOCET); // 4710
		expect(vy!.pocetKs).toBe(1);
		expect(vy!.vydajTyce).toEqual({ tycMm: TYC_STANDARD_MM, pocet: 1 });
	});
});

describe('OP260282 golden — bin-packing pocetTyci (výdaj materiálu)', () => {
	it('žľab 1×4990 na 6 m tyč → 1 tyč; kotviaci rovnako', () => {
		expect(pocetTyci(4990, 1, 6000)).toBe(1);
	});
	it('priečka: 8 ks × 3240.93 na 7,5 m → 2 kusy/tyč → 4 tyče (výkres 4×(7,5 m))', () => {
		// nezávisle od HH-null: overenie samotného bin-pack vzorca proti stĺpcu Výdaj výkresu
		expect(pocetTyci(3240.93, 8, 7500)).toBe(4);
	});
	it('zaklapávacia: 14 ks × 655.40 na 7,5 m → 11 kusov/tyč → 2 tyče (výkres 2×(7,5 m))', () => {
		expect(pocetTyci(655.4, 14, 7500)).toBe(2);
	});
	it('kus dlhší než tyč → null (nevyrobiteľné z tejto tyče), nie NaN/0', () => {
		expect(pocetTyci(8000, 1, 7500)).toBeNull();
	});
});

describe('OP260282 golden — ČESTNÝ NULL / GAP (nefitujeme nasilu, #207 §3)', () => {
	const r = spocitajNarez(OP260282);

	it('r.7 priečka 18004: dĺžka rezu = null (HH krovu 3240.9 nie je vzorec zo vstupov)', () => {
		const pr = riadok(r.vypocitane, (p) => p.kod === '18004');
		expect(pr).toBeTruthy();
		expect(pr!.dlzkaRezuMm).toBeNull(); // GAP: výkres 3240.93 = HH krovu (#161/#198)
		// GAP počtu: engine ceil(4990/700)+1 = 9, výkres uvádza 8 (rám < žľab, O1/#196)
		expect(pr!.pocetKs).toBe(9);
	});

	it('r.11/13/12 prítlačná+maskovacie = HH krovu+40 → v nepodporované (čestný null)', () => {
		const n = r.nepodporovane.join(' | ');
		expect(n).toMatch(/prítlačn/i);
		expect(n).toMatch(/maskovac/i);
		expect(n).toMatch(/HH krovu/i);
		expect(n).toMatch(/#161|#198/);
		// engine NEemituje pre ne dĺžku (3279.77) — žiadny vypocitane riadok 18006/18007/18008
		expect(r.vypocitane.some((p) => ['18006', '18007', '18008'].includes(p.kod))).toBe(false);
	});

	it('r.9 zaklapávacia (18005) = (šírka−402)/7 → v nepodporované (počet krovov O1-blokovaný)', () => {
		const n = r.nepodporovane.join(' | ');
		expect(n).toMatch(/zaklapávac/i);
		expect(r.vypocitane.some((p) => p.kod === '18005')).toBe(false);
	});

	it('r.8 profil 110×43 (18016) = 3220 → v nepodporované (poznámka výkresu nesedí s hodnotou)', () => {
		const n = r.nepodporovane.join(' | ');
		expect(n).toMatch(/110×43|110x43|18016/i);
		expect(r.vypocitane.some((p) => p.kod === '18016')).toBe(false);
	});

	it('r.6 zadná výstuha (18017 zvislá, 2340) → v nepodporované (poznámka „ZV−140" dáva 2650)', () => {
		const n = r.nepodporovane.join(' | ');
		expect(n).toMatch(/zadná výstuha/i);
	});

	it('r.3 zadné nohy: engine ZV−140 = 2650 (potvrdený vzorec) — výkres 2790/18013 = divergencia', () => {
		const zadna = riadok(r.vypocitane, (p) => /zadná noha/i.test(p.nazov));
		expect(zadna).toBeTruthy();
		expect(zadna!.dlzkaRezuMm).toBe(2650); // 2790 − 140, POTVRDENÝ vzorec sa NEMENÍ
		// GAP: výkres uvádza 2790 mm profil 18013 (SS+výstuha bez hist. vzoru #196) →
		// zdokumentované v nepodporované, na potvrdenie Dominikovi
		const n = r.nepodporovane.join(' | ');
		expect(n).toMatch(/zadné nohy/i);
		expect(n).toMatch(/2790/);
	});
});
