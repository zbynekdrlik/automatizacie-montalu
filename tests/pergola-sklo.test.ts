// Strešné sklo pergoly — vzorec šírky + počet tabúľ + POTVRDENÁ dĺžka (#223).
// Konzumuje POTVRDENÚ A1 (Dominik #198, 21.8.): šírka skla = svetlosť medzi krovmi + 30
// (sklo/STADUR) / + 34 (polykarbonát 16 mm); stredová výstuha 140 do šírky NEvstupuje.
// DĹŽKA tabule = POTVRDENÁ 2.9. (Dominik, discuss.channel_393 msg 1777597): dĺžka hornej
// hrany krovu + 10 (Robust) / + 20 (Massiv), meria sa z hornej hrany, ~2 mm drift voči
// reálnemu rezu sa NErieši (návrhový výkres na rezerváciu materiálu). Base = appkin nominál
// krovu (`krovDlzkaNominal`) — „dĺžka hornej hrany" so waivnutým ~1,17 mm seating detailom;
// golden OP260282 (masív): 3239,76 + 20 = 3259,76 → reálny rez 3259 (Δ 0,76 mm, v pásme
// „~2 mm NErieši"). Config-gate: emituje sa LEN pre overenú konfiguráciu kotvy (samostatne
// stojaca + zadný profil 110) — inak honest-null (rovnaká disciplína ako rez krovu, #161).
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
// samostatne stojaca + zadný profil 110 + sklon 6,1° = overená konfigurácia kotvy → dĺžka
// = nominál krovu 3239,76 + 20 (masív) = 3259,76 (reálny rez skla 3259 mm).
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
	it('dĺžka tabule = dĺžka hornej hrany krovu 3239,76 + 20 (masív) = 3259,76 mm', () => {
		expect(r.dlzkaMm).toBe(3259.76);
	});
	it('Money kód = TS00014 (potvrdené mapovanie, #274)', () => {
		expect(r.moneyKod).toBe('TS00014');
	});
	it('poznámka o dĺžke je prítomná (plain, bez interných referencií)', () => {
		expect(r.poznamky.some((p) => /dĺžk/i.test(p))).toBe(true);
		expect(r.poznamky.join(' ')).not.toMatch(/#\d|\bO\d/);
	});
});

describe('#223 VERIFIKÁCIA proti reálnemu sklu OP260282 (výrobný výkres, ch207 príloha 10504)', () => {
	// Reálny výrobný výkres skla, ktorý Dominik pripol do kanála 207 (msg 1731731; „sklo maš
	// pripnute" — msg 1739824): STRECHA SKLO 4-4-2číre-8-6stopsol classic grey, 7 ks,
	// tabuľa 685 × 3259 mm. Overenie vzorcov proti reálne rezanému kusu.
	const r = spocitajStrechaSklo(OP260282);

	it('počet tabúľ SEDÍ na reálny rez: 7 ks (8 krovov → 7 polí)', () => {
		expect(r.pocetTabul).toBe(7);
	});

	it('šírka SEDÍ na reálny rez: 685,43 → rezaných 685 (celé mm nadol — sklo musí zapadnúť)', () => {
		// Príloha má JEDEN rozmer pre všetkých 7 ks (žiadne užšie pole) a Dominik potvrdil
		// „ano nevstupuje" (ch207 1725595) — trčanie výstuhy 95/125 patrí k prednej svetlej
		// výške/nohe, nie k šírke strešných polí. Engine preto vracia JEDNU skalárnu šírku
		// pre všetky polia (per-pole korekcia neexistuje) a tá sedí na reálny rez.
		expect(r.sirkaMm).toBe(685.43);
		expect(Math.floor(r.sirkaMm as number)).toBe(685); // rozmer tabule na výrobnom výkrese
	});

	it('dĺžka SEDÍ na reálny rez ~3259: hornej hrana 3239,76 + 20 = 3259,76 (Δ 0,76 mm, „~2 mm NErieši")', () => {
		// Dominik 2.9. (discuss.channel_393 msg 1777597) rozsekol rozpor: dĺžka skla = dĺžka
		// hornej hrany + 10 (Robust) / + 20 (Massiv), meria sa z hornej hrany, „tieto detaile
		// prosím nerieš … návrhový výkres na rezervovanie materiálu … sklo je osadené na ploche
		// ktorá nie je nikde kótovaná". Base = appkin nominál krovu (dĺžka hornej hrany so
		// waivnutým ~1,17 mm seating detailom): 3239,76 + 20 = 3259,76 → reálny rez 3259, Δ 0,76
		// mm — v pásme návrhovej presnosti (~2 mm). Skoršie kandidáty, ktoré reál VYVRACAL
		// (chat „krov+40"→3279,76; „HH+20"→3260,93), sú tým prekonané potvrdeným pravidlom.
		expect(r.dlzkaMm).toBe(3259.76);
		expect(Math.round(r.dlzkaMm as number)).toBe(3260); // ~ reálny rez 3259 (Δ < 2 mm)
	});

	it('reálny typ (4-4-2číre-8-6stopsol) → najbližší katalógový IZO typ s TS kódom', () => {
		// stopsol variácia nemá vlastnú kartu — appka priradí najbližšiu cenu (IZO 4.4.2-8-6
		// číre = TS00014), reálnu Dominik po potvrdení prepíše ručne (zadanie #223).
		expect(r.moneyKod).toBe('TS00014');
	});
});

describe('spocitajStrechaSklo — Robust vetva + polykarbonát +34 + dĺžka +10', () => {
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
	it('dĺžka = dĺžka hornej hrany krovu Robust 3269,76 + 10 = 3279,76 mm', () => {
		// Robust nominál = 3470/cos(6,1°) − 220 = 3269,76; Robust prídavok dĺžky = +10.
		expect(r.dlzkaMm).toBe(3279.76);
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
		expect(r.dlzkaMm).toBeNull();
	});
	it('typ zvolený, bez počtu krovov → šírka/počet null, ale dĺžka (per tabuľu) sa počíta', () => {
		// Dĺžka tabule = dĺžka hornej hrany krovu + prídavok — nezávisí od POČTU krovov (to je
		// per-poľová dĺžka). Bez počtu krovov chýba svetlosť (šírka) aj počet tabúľ; dĺžka ostáva.
		const r = spocitajStrechaSklo({ ...OP260282, pocetKrovov: null });
		expect(r.typ).toBe('IZO 4.4.2-8-6 číre');
		expect(r.pocetTabul).toBeNull();
		expect(r.sirkaMm).toBeNull();
		expect(r.dlzkaMm).toBe(3259.76);
		expect(r.poznamky.some((p) => /po[čc]et krovov/i.test(p))).toBe(true);
	});
});

describe('spocitajStrechaSklo — dĺžka honest-null keď krov nominál nie je overený (#161 config-gate)', () => {
	// Dĺžka = dĺžka hornej hrany krovu, ktorý sa emituje LEN pre overenú konfiguráciu kotvy
	// (samostatne stojaca + zadný profil 110, so zadaným sklonom do 9°). Inak by base pochádzal
	// z neovereného odpočtu (250/220 je golden len pre túto kotvu) → honest-null, nikdy hádaný
	// rozmer (default formulára je stena → dĺžka „—").
	it('uchytenie na stenu → dĺžka null (odpočet krovu neoverený pre stenu)', () => {
		const r = spocitajStrechaSklo({ ...OP260282, uchytenie: 'stena' });
		expect(r.dlzkaMm).toBeNull();
		expect(r.sirkaMm).toBe(685.43); // šírka je čistá geometria — ostáva
		expect(r.pocetTabul).toBe(7);
	});
	it('zadný profil 140 (nie 110) → dĺžka null (neoverená konfigurácia)', () => {
		const r = spocitajStrechaSklo({ ...OP260282, hornyProfilZadnej: 140 });
		expect(r.dlzkaMm).toBeNull();
	});
	it('bez zadaného sklonu strechy → dĺžka null (krov nominál sa bez sklonu nepočíta)', () => {
		const r = spocitajStrechaSklo({ ...OP260282, sklonStrechy: null });
		expect(r.dlzkaMm).toBeNull();
	});
	it('sklon nad 9° → dĺžka null (pásmo bez potvrdeného vzorca, A7)', () => {
		const r = spocitajStrechaSklo({ ...OP260282, sklonStrechy: 10 });
		expect(r.dlzkaMm).toBeNull();
	});
});
