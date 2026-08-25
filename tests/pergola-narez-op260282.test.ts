// Pergola — GOLDEN / verifikačný test proti reálnemu CAD Plánu rezov zákazky OP260282
// (#207). Výkres „PERGOLA MASSIVE 140 SAMOSTOJACA" od Dominika (Odoo správa #1691126,
// 14.8.2026) je prvá skutočná zákazka s presnými vstupmi AJ zdrojovým Plánom rezov 1:1 —
// ideálny vektor na overenie vzorcov doplnených v #205 a KROVOVÉHO cut-listu (#161).
//
// DISCIPLÍNA (#155 HARD boundary, #207 §3): engine počíta LEN POTVRDENÉ vzorce. Riadok,
// ktorý sa z potvrdených vzorcov NEDÁ reprodukovať (seating +1,17 mm HH krovu, zvislá
// zadná výstuha 2340, Robust lišta), sa NEFITUJE nasilu — test asertuje engine čestný
// null a GAP je nižšie explicitne vypísaný (aj v PR/komentári #161).
//
// KROV cut-list (#161, derivácia 21.8. overená proti tomuto výkresu): nominálna dĺžka
// krovu = hĺbka/cos(sklon) − 250 = 3239,76 (HH krovu 3240,93 = nominál + ~1,17 mm reálne
// uloženie, bez čistého vzorca → emituje sa NOMINÁL); prítlačná/maskovacie = nominál + 40
// = 3279,76 ≈ výkres 3279,77 (Δ 0,01); počet krovov = MANUÁLNY vstup (Dominik 21.8.), appka
// ukáže svetlosť = (šírka − 50n − 2)/(n−1) = 655,43 (výkres 655,40); zaklapávacia = 2(n−1) ks.
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
// krovov = 8 (Dominik zadá manuálne; výkres OP260282 má 8 krovov). Sklon 6,1° je POD prahom
// 7° (uloženie sa nepočíta), ale NOMINÁLNA dĺžka krovu funguje pre každý sklon > 0.
const OP260282: PergolaNarezVstup = {
	system: 'Massive',
	sirka: 4990,
	hlbka: 3470,
	prednaSvetlost: 2200,
	vyskaZadna: 2790,
	pocetPrednychNoh: 4,
	uchytenie: 'samostatne',
	pocetZadnychNoh: 4,
	// Výkres OP260282: zadná konštrukcia = 110×110 (hornyProfilZadnej=110) → kód 18013, dĺžka
	// zadnej nohy = ZV − 110 = 2680 (#316, Dominik 24.8. kanál 207 msg 1731730). 110/140 určuje
	// AJ kaskádu bočného 110×43 „pod fixom" — massive SS so 110 zadnou = −250.
	hornyProfilZadnej: 110,
	prieckaLight: false,
	zosilnenyNosnik: true, // výstuha 140×140 prítomná
	sklonStrechy: 6.1,
	pocetKrovov: 8 // #161 — manuálny vstup počtu krovov (výkres OP260282 = 8)
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

	it('r.5 žľabová výstuha 18017 = šírka − 280 = 4710, 1 ks (massive + zosilnený nosník)', () => {
		const vy = riadok(r.vypocitane, (p) => p.kod === '18017' && /výstuha/i.test(p.nazov));
		expect(vy, 'žľabová výstuha (18017) musí byť vo vypocitane pri massive+zosilnení').toBeTruthy();
		expect(vy!.dlzkaRezuMm).toBe(4990 - VYSTUHA_ODPOCET); // 4710
		expect(vy!.pocetKs).toBe(1);
		expect(vy!.vydajTyce).toEqual({ tycMm: TYC_STANDARD_MM, pocet: 1 });
	});

	it('r.8 profil 110×43 „pod fixom" 18016 = hĺbka − (140+110) = 3220, 2 ks (massive SS so 110 zadnou)', () => {
		// #205: kaskáda z poznámky výkresu = predná noha profil (140) + zadný prvok (110) = 250;
		// hĺbka 3470 − 250 = 3220 = presný rez z Plánu rezov (dôkaz základu = HĹBKA, nie šírka).
		const pf = riadok(r.vypocitane, (p) => p.kod === '18016' && /pod fixom/i.test(p.nazov));
		expect(pf, '110×43 „pod fixom" (18016) musí byť vo vypocitane').toBeTruthy();
		expect(pf!.dlzkaRezuMm).toBe(3220);
		expect(pf!.pocetKs).toBe(2);
		expect(pf!.vydajTyce).toEqual({ tycMm: TYC_STANDARD_MM, pocet: 1 }); // 2×3220 na 7,5 m → 1 tyč
	});

	it('r.3 zadné nohy 18013 = ZV − profil 110 = 2680, 4 ks (SS; Dominik 24.8. rozriešil ZV−profil)', () => {
		// #316: ZV-protirečenie výkresu (plná ZV 2790) vs call (ZV−profil) rozriešené Dominikom 24.8.
		// (kanál 207 msg 1731730) v prospech callu: horizontálny profil sedí NA nohách → zadná noha =
		// ZV − horný profil. OP260282 má hornyProfilZadnej=110 → 2790 − 110 = 2680; kód sleduje horný
		// profil zadnej (110 → 18013/110×110), nie systém (predtým latentne Massive 18017).
		const zadna = riadok(r.vypocitane, (p) => /zadná noha/i.test(p.nazov));
		expect(zadna, 'zadná noha musí byť vo vypocitane pri SS').toBeTruthy();
		expect(zadna!.kod).toBe('18013'); // sleduje hornyProfilZadnej=110 (predtým systémový 18017)
		expect(zadna!.nazov).toMatch(/110x110/);
		expect(zadna!.dlzkaRezuMm).toBe(2680); // 2790 − 110
		expect(zadna!.pocetKs).toBe(4);
	});

	it('r.0 predná noha 18017 = svetlosť + výstuha 140 = 2340, 4 ks (A9 Dominik: noha = svetlosť + rozmer výstuhy)', () => {
		// A9 (Odoo správa 1724498, na #198): pri výstuhe je predná noha = svetlosť + ROZMER VÝSTUHY
		// (110×110 → +110, 140×140 → +140, 110×250 → +250), NIE +15. OP260282 má zosilnenyNosnik=true a
		// vystuhaProfil PRÁZDNY → Massive systémový default 140×140 → prídavok 140. 2200 + 140 = 2340.
		// Výkres: „2340×2 pod kódom 18017" = PREDNÁ NOHA (Massive stĺp 18017), nie samostatná „zvislá
		// zadná výstuha" (tá bola misatribúcia — A9 to reklasifikuje: „nerozumiem 2340; noha = svetlosť+140").
		const noha = riadok(r.vypocitane, (p) => /predná noha/i.test(p.nazov));
		expect(noha, 'predná noha musí byť vo vypocitane').toBeTruthy();
		expect(noha!.kod).toBe('18017'); // Massive stĺp
		expect(noha!.dlzkaRezuMm).toBe(2340); // 2200 + 140 (A9), NIE 2215 (starý „vždy +15" bug)
		expect(noha!.pocetKs).toBe(4); // počet podľa vstupu (pocetPrednychNoh)
	});

	it('svetlosť bez výstuhy (informatívne) = 2200 + trčanie 125 = 2325 (kóta výkresu, ch207 1731729)', () => {
		// Výkres OP260282: „svetlosť s výstuhou 2200" (zadávaná) vs „bez výstuhy 2325" — rozdiel
		// presne 125 = trčanie výstuhy 140×140 (skovaná 15 mm v žľabe, trčí 140 − 15).
		expect(r.informativne.vystuhaTrcanieMm).toBe(125);
		expect(r.informativne.svetlostBezVystuhy).toBe(2325);
	});
});

describe('OP260282 golden — KROV cut-list (#161, derivácia 21.8. overená proti výkresu)', () => {
	const r = spocitajNarez(OP260282);

	it('r.7 priečka 18004 = NOMINÁL krovu = hĺbka/cos(6,1°) − 250 ≈ 3239,76 (±0,5), 8 ks', () => {
		// NOMINÁL (spodná hrana/uloženie), NIE HH krovu. HH krovu (výkres 3240,93) = nominál +
		// ~1,17 mm reálne uloženie („nesedí o ~2 mm, nerieš" — Dominik na výkres); +1,17 nemá
		// čistý vzorec, preto sa emituje nominál. Počet = manuálny vstup n = 8 (RUŠÍ auto ceil(š/700)+1 = 9).
		const pr = riadok(r.vypocitane, (p) => p.kod === '18004');
		expect(pr, 'priečka (18004) musí byť vo vypocitane').toBeTruthy();
		expect(pr!.dlzkaRezuMm).not.toBeNull();
		expect(Math.abs((pr!.dlzkaRezuMm as number) - 3239.76)).toBeLessThan(0.5);
		expect(pr!.pocetKs).toBe(8); // manuálny počet krovov (výkres 8, nie auto 9)
		expect(pr!.vydajTyce).toEqual({ tycMm: TYC_STANDARD_MM, pocet: 4 }); // 8×3239,76 na 7,5 m → 2/tyč → 4
	});

	it('r.11 prítlačná lišta 18006 = nominál + 40 ≈ 3279,77 (±0,1), 8 ks (= n)', () => {
		const p = riadok(r.vypocitane, (x) => x.kod === '18006');
		expect(p, 'prítlačná (18006) musí byť vo vypocitane pri massive+sklon+n').toBeTruthy();
		expect(Math.abs((p!.dlzkaRezuMm as number) - 3279.77)).toBeLessThan(0.1); // výkres 3279,77
		expect(p!.pocetKs).toBe(8); // = počet krovov
		expect(p!.vydajTyce).toEqual({ tycMm: TYC_STANDARD_MM, pocet: 4 });
	});

	it('r.13 maskovacia lišta 18007 = nominál + 40 ≈ 3279,77, 6 ks (= n − 2)', () => {
		const p = riadok(r.vypocitane, (x) => x.kod === '18007');
		expect(p, 'maskovacia (18007) musí byť vo vypocitane').toBeTruthy();
		expect(Math.abs((p!.dlzkaRezuMm as number) - 3279.77)).toBeLessThan(0.1);
		expect(p!.pocetKs).toBe(6); // n − 2 (stredné krovy)
		expect(p!.vydajTyce).toEqual({ tycMm: TYC_STANDARD_MM, pocet: 3 });
	});

	it('r.12 maskovacia lišta krajová 18008 = nominál + 40 ≈ 3279,77, 2 ks (kraje)', () => {
		const p = riadok(r.vypocitane, (x) => x.kod === '18008');
		expect(p, 'maskovacia krajová (18008) musí byť vo vypocitane').toBeTruthy();
		expect(Math.abs((p!.dlzkaRezuMm as number) - 3279.77)).toBeLessThan(0.1);
		expect(p!.pocetKs).toBe(2); // 2 kraje
		expect(p!.vydajTyce).toEqual({ tycMm: TYC_STANDARD_MM, pocet: 1 });
	});

	it('r.9 zaklapávacia čelná lišta 18005 = svetlosť medzi krovmi 655,43, 2(n−1) = 14 ks', () => {
		const z = riadok(r.vypocitane, (x) => x.kod === '18005');
		expect(z, 'zaklapávacia (18005) musí byť vo vypocitane pri zadanom počte krovov').toBeTruthy();
		expect(z!.dlzkaRezuMm).toBe(655.43); // (4990 − 402)/7 = 655,43 (výkres 655,40)
		expect(z!.pocetKs).toBe(14); // 2×(8−1)
		expect(z!.vydajTyce).toEqual({ tycMm: TYC_STANDARD_MM, pocet: 2 });
	});

	it('svetlosť medzi krovmi (informatívne) = (šírka − 50·n − 2)/(n−1) = 655,43; počet krovov = 8', () => {
		expect(r.informativne.pocetKrovov).toBe(8);
		expect(r.informativne.svetlostMedziKrovmi).toBe(655.43);
	});
});

describe('OP260282 golden — bin-packing pocetTyci (výdaj materiálu)', () => {
	it('žľab 1×4990 na 6 m tyč → 1 tyč; kotviaci rovnako', () => {
		expect(pocetTyci(4990, 1, 6000)).toBe(1);
	});
	it('priečka: 8 ks × 3239,76 na 7,5 m → 2 kusy/tyč → 4 tyče (výkres 4×(7,5 m))', () => {
		expect(pocetTyci(3239.76, 8, 7500)).toBe(4);
	});
	it('zaklapávacia: 14 ks × 655,43 na 7,5 m → 11 kusov/tyč → 2 tyče (výkres 2×(7,5 m))', () => {
		expect(pocetTyci(655.43, 14, 7500)).toBe(2);
	});
	it('kus dlhší než tyč → null (nevyrobiteľné z tejto tyče), nie NaN/0', () => {
		expect(pocetTyci(8000, 1, 7500)).toBeNull();
	});
});

describe('OP260282 golden — ČESTNÝ NULL / GAP (nefitujeme nasilu, #207 §3 / #161)', () => {
	const r = spocitajNarez(OP260282);
	const nepodpText = r.nepodporovane.map((x) => x.kratky + ' ' + x.detail).join(' | ');

	it('HH krovu 3240,93 sa NEFITUJE — emituje sa NOMINÁL 3239,76 (seating +1,17 mm ostáva bez vzorca)', () => {
		// Δ HH − nominál = 3240,93 − 3239,76 = 1,17 mm = reálne uloženie (Dominik: nesedí o ~2 mm,
		// nerieš). Engine NEEMITUJE 3240,93 (to by bol nasilu fitnutý CAD výsledok geometrie).
		const pr = riadok(r.vypocitane, (p) => p.kod === '18004');
		expect(pr!.dlzkaRezuMm as number).toBeLessThan(3240.93); // nominál < HH (seating gap)
		expect(3240.93 - (pr!.dlzkaRezuMm as number)).toBeCloseTo(1.17, 1);
	});

	it('r.6 „zvislá zadná výstuha 2340" REKONCILIOVANÁ na prednú nohu (A9) — už NIE je čestný null', () => {
		// A9 (Dominik Odoo 1724498): „nerozumiem dĺžku 2340; noha = svetlosť + 140". Výkresová 2340×2
		// pod 18017 = PREDNÁ NOHA (2200+140), nie samostatná zvislá zadná výstuha — skoršia misatribúcia
		// (2340 = svetlosť 2325 + 15 vs predná 2200 + 140 dávali rovnaké číslo). Honest-null nota
		// ODSTRÁNENÁ; dĺžka je vo `vypocitane` ako predná noha 2340. Nefitujeme nasilu — je to A9 potvrdené.
		expect(nepodpText).not.toMatch(/zvislá zadná výstuha/i);
		const noha = riadok(r.vypocitane, (p) => /predná noha/i.test(p.nazov));
		expect(noha!.dlzkaRezuMm).toBe(2340);
	});

	it('frézovanie drážok (výrobný list) ostáva nepodporované — doplní konštruktér', () => {
		expect(nepodpText).toMatch(/frézovan/i);
		expect(nepodpText).toMatch(/konštruktér/i);
	});
});
