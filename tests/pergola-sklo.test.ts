// Strešné sklo pergoly — vzorec šírky + počet tabúľ + honest-null dĺžka (#223).
// Konzumuje POTVRDENÚ A1 (Dominik #198, 21.8.): šírka skla = svetlosť medzi krovmi + 30
// (sklo/STADUR) / + 34 (polykarbonát 16 mm); stredová výstuha 140 do šírky NEvstupuje.
// DĹŽKA tabule je honest-null — reálny výrobný výkres skla OP260282 (ch207 príloha 10504:
// 7 ks, 685 × 3259) vyvracia chatové „dĺžka krovu + 40" (3279,76 ✗) aj call „HH + 20"
// (3260,93 ✗) → kým Dominik rozpor nerozsekne, dĺžka sa NEpočíta (viď verifikačný describe).
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

describe('#223 VERIFIKÁCIA proti reálnemu sklu OP260282 (výrobný výkres, ch207 príloha 10504)', () => {
	// Reálny výrobný výkres skla, ktorý Dominik pripol do kanála 207 (msg 1731731; „sklo maš
	// pripnute" — msg 1739824): STRECHA SKLO 4-4-2číre-8-6stopsol classic grey, 7 ks,
	// tabuľa 685 × 3259 mm. Prvé overenie vzorcov proti reálne rezanému kusu (nie chatu).
	const r = spocitajStrechaSklo(OP260282);

	it('počet tabúľ SEDÍ na reálny rez: 7 ks (8 krovov → 7 polí)', () => {
		expect(r.pocetTabul).toBe(7);
	});

	it('šírka SEDÍ na reálny rez: 685,43 → rezaných 685 (celé mm nadol — sklo musí zapadnúť)', () => {
		expect(r.sirkaMm).toBe(685.43);
		expect(Math.floor(r.sirkaMm as number)).toBe(685); // rozmer tabule na výrobnom výkrese
	});

	it('dĺžka OSTÁVA honest-null — žiadne verbatim pravidlo nereprodukuje reálnych 3259 mm', () => {
		// Kandidáti vs. reálny rez 3259:
		//  - chat „dĺžka skla = dĺžka krovu + 40 (masív)" (ch207 1725597–1725599):
		//    nominál 3239,76 + 40 = 3279,76 ✗ (Δ +20,76; zhodou okolností presne dĺžka
		//    prítlačnej lišty 3279,77 — pravidlo koliduje s vlastným pravidlom líšt)
		//  - call 19.8. „dĺžka hornej hrany + 20 (masív)": HH 3240,93 + 20 = 3260,93 ✗ (Δ +1,93)
		//  - hypotéza „nominál + 20, zaokrúhlené nadol" = 3259 by sedela, ale vyžaduje DVE
		//    neoverené domnienky naraz → force-fit, do enginu nejde (rozpor zaznamenaný na #223)
		expect(r.dlzkaMm).toBeNull();
	});

	it('reálny typ (4-4-2číre-8-6stopsol) → najbližší katalógový IZO typ s TS kódom', () => {
		// stopsol variácia nemá vlastnú kartu — appka priradí najbližšiu cenu (IZO 4.4.2-8-6
		// číre = TS00014), reálnu Dominik po potvrdení prepíše ručne (zadanie #223).
		expect(r.moneyKod).toBe('TS00014');
	});

	it('všetkých 7 tabúľ má ROVNAKÚ šírku — pole s výstuhou sa nekoriguje (výkres aj Dominik)', () => {
		// Príloha má JEDEN rozmer pre všetkých 7 ks (žiadne užšie pole) a Dominik potvrdil
		// „ano nevstupuje" (ch207 1725595) — trčanie výstuhy 95/125 patrí k prednej svetlej
		// výške/nohe, nie k šírke strešných polí. Engine preto vracia jednu šírku pre všetky
		// polia (sirkaMm je skalár, žiadna per-pole korekcia neexistuje).
		expect(typeof r.sirkaMm).toBe('number');
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
