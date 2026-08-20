// Pergola — vrstva KUSOVÝCH komponentov (spojky, krytky, rámové/zakladacie lišty), #195.
// Zdroj = TYPY vyčítané z callu 13.8. (scr_014/015 Massive „KOMPONENTY Pergola 140";
// scr_042 Robust „KOMPONENTY Pergola 110"/expedícia) + výkres OP260282. User (16.8.)
// rozhodol „len mi stačia tie typy" — NEČAKAŤ na Dominikove tabuľky; implementovať
// z dostupných TYPOV. Display-only, do Money NIČ (statický guard:
// tests/pergola-narez-money-safety.test.ts).
//
// HONEST-NULL DISCIPLÍNA (Money-priľahlá, rovnaká ako pre profily):
//  • POČET: iba keď ho odvodí POTVRDENÉ pravidlo. Žiadne pravidlo počtu komponentov
//    zatiaľ nie je → pocetKs === null („—") pre VŠETKY typy. Jednorazové pozorovanie
//    z jedného výkresu (spojka U 12 ks) ide do poznámky, NIE do počtu.
//  • MONEY KÓD: žiaden potvrdený ZASK* → nič sa neasertuje ako Money kód. CAD kódy
//    (24007/24003) sú len informatívne; nečitateľná číslica (2400?) sa NIKDY nedopĺňa.
import { describe, it, expect } from 'vitest';
import {
	komponentyPergoly,
	PERGOLA_KOMPONENTY,
	type PergolaKomponent,
	type PergolaNarezVstup
} from '../src/lib/pergola-narez';

const BASE: PergolaNarezVstup = {
	system: 'Massive',
	sirka: 5760,
	hlbka: 3690,
	prednaSvetlost: 2200,
	vyskaZadna: 2900,
	pocetPrednychNoh: 4,
	uchytenie: 'stena',
	pocetZadnychNoh: 4,
	hornyProfilZadnej: 140,
	prieckaLight: false,
	zosilnenyNosnik: false
};

const massive = (): PergolaKomponent[] => komponentyPergoly({ ...BASE, system: 'Massive' });
const robust = (): PergolaKomponent[] => komponentyPergoly({ ...BASE, system: 'Robust' });

describe('#195 — katalóg komponentov: integrita a honest-null', () => {
	it('katalóg je neprázdny a bez duplicít typov', () => {
		expect(PERGOLA_KOMPONENTY.length).toBeGreaterThan(0);
		const typy = PERGOLA_KOMPONENTY.map((k) => k.typ);
		expect(new Set(typy).size).toBe(typy.length);
	});

	it('KAŽDÝ komponent má pocetKs === null (honest-null — žiadne potvrdené pravidlo počtu)', () => {
		for (const k of PERGOLA_KOMPONENTY) {
			expect(k.pocetKs, `${k.typ} počet musí byť null (žiadne pravidlo)`).toBeNull();
		}
	});

	it('žiadny komponent neasertuje Money kód (ZASK*) — kodCad je len CAD kód alebo null', () => {
		for (const k of PERGOLA_KOMPONENTY) {
			if (k.kodCad !== null) {
				expect(k.kodCad, `${k.typ}: kodCad nesmie byť ZASK* (nepotvrdený Money kód)`).not.toMatch(
					/ZASK/i
				);
				// CAD kód je krátky číselný string (24007/24003) — nie vymyslený katalógový kód
				expect(k.kodCad).toMatch(/^\d{4,5}$/);
			}
		}
	});

	it('každý komponent má systém, kde je doložený, a citáciu zdroja', () => {
		for (const k of PERGOLA_KOMPONENTY) {
			expect(k.systemy.length).toBeGreaterThan(0);
			for (const s of k.systemy) expect(['Robust', 'Massive']).toContain(s);
			expect(k.zdroj.length).toBeGreaterThan(0);
			expect(k.kdePouzity.length).toBeGreaterThan(0);
		}
	});
});

describe('#195 — komponentyPergoly filtruje podľa systému', () => {
	it('Massive vráti presne 5 komponentov (spojka U, rámová lišta, 2× krytka mask. lišty, krytka zadná roh)', () => {
		const m = massive();
		expect(m.length).toBe(5);
		for (const k of m) expect(k.systemy).toContain('Massive');
	});

	it('Robust vráti presne 2 komponenty (zakladacia lišta, krytka vrchná)', () => {
		const r = robust();
		expect(r.length).toBe(2);
		for (const k of r) expect(k.systemy).toContain('Robust');
		const typy = r.map((k) => k.typ.toLowerCase()).join(' | ');
		expect(typy).toMatch(/zakladacia lišta/);
		expect(typy).toMatch(/krytka vrchná/);
	});

	it('vracia ČERSTVÉ pole pri každom volaní — mutácia výsledku neovplyvní ďalšie volanie ani katalóg', () => {
		const prve = komponentyPergoly(BASE);
		const pocet = prve.length;
		expect(pocet).toBeGreaterThan(0);
		// mutácia vráteného poľa NESMIE presiaknuť do katalógu ani do ďalšieho volania
		prve.push({ ...prve[0]!, typ: 'MUTÁCIA-TEST' });
		expect(komponentyPergoly(BASE).length).toBe(pocet);
		expect(PERGOLA_KOMPONENTY.some((k) => k.typ === 'MUTÁCIA-TEST')).toBe(false);
	});
});

describe('#195 — konkrétne typy zo zdrojov (verbatim TYPY, žiadne hádanie počtov)', () => {
	it('Massive: spojka U 100×50 (140×140) — počet null, jednorazové 12 ks len v poznámke', () => {
		const su = massive().find((k) => /spojka u/i.test(k.typ));
		expect(su, 'spojka U musí byť v Massive katalógu').toBeTruthy();
		expect(su!.pocetKs).toBeNull();
		expect(su!.poznamka ?? '').toMatch(/12/);
		expect(su!.poznamka ?? '').toMatch(/jednorazov|nie.*pravidl/i);
	});

	it('Massive: krytka zadná roh — CAD kód 2400? nečitateľný → kodCad null, poznámka o nečitateľnosti', () => {
		const kzr = massive().find((k) => /krytka zadná roh/i.test(k.typ));
		expect(kzr, 'krytka zadná roh musí byť v Massive katalógu').toBeTruthy();
		expect(kzr!.kodCad).toBeNull();
		expect(kzr!.poznamka ?? '').toMatch(/2400/);
	});

	it('Massive: rámová lišta má informatívny CAD kód 24007 (NIE Money kód)', () => {
		const rl = massive().find((k) => /rámová lišta/i.test(k.typ));
		expect(rl, 'rámová lišta musí byť v Massive katalógu').toBeTruthy();
		expect(rl!.kodCad).toBe('24007');
		expect(rl!.pocetKs).toBeNull();
	});

	it('Massive: krytka maskovacej lišty (+ krajová) sú dva samostatné typy s CAD kódom 24003', () => {
		const krytky = massive().filter((k) => /krytka maskovacej lišty/i.test(k.typ));
		expect(krytky.length).toBe(2);
		for (const k of krytky) expect(k.kodCad).toBe('24003');
		expect(krytky.some((k) => /krajová/i.test(k.typ))).toBe(true);
	});
});
