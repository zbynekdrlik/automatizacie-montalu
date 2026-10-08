// #587 (Odoo úloha 1185 — „Výkres alebo DXF k sklu pôjde s objednávkou z appky"): POLOHA zámkového
// otvoru (⌀46, stred 50 mm od zvislej hrany skla, výška vŕtania od spodku skla) je JEDNO pravidlo
// v `src/lib/sklo-otvory.ts` — náhľad nárezáku (`Nahlad2D`), riadok objednávky skla aj PDF výkres
// pre IZOS z neho čítajú. Nárezák navyše v karte „Sklo (mm)" ukáže rozpis „s otvorom / bez".
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { render } from 'svelte/server';
import {
	D_ZAMOK_MM,
	OKRAJ_ZAMOK_MM,
	VRTANIE_ZAMKU_DEFAULT_MM,
	polohaOtvoru,
	riadkySklaPosuvu,
	rozpisOtvorovSkla,
	popisPolohyOtvoru,
	triedaOtvoru,
	stranyOtvorov,
	fmtMmOtvoru,
	otvoryVSkle,
	otvoryRucneZmenene
} from '../src/lib/sklo-otvory';
import Nahlad2D from '../src/lib/components/Nahlad2D.svelte';
import SkloOtvoryRozpis from '../src/lib/components/zasklenia/SkloOtvoryRozpis.svelte';

describe('#587 polohaOtvoru — jedno pravidlo polohy', () => {
	it('konštanty: 50 mm od hrany, default výška 1050, ⌀46', () => {
		expect(OKRAJ_ZAMOK_MM).toBe(50);
		expect(VRTANIE_ZAMKU_DEFAULT_MM).toBe(1050);
		expect(D_ZAMOK_MM).toBe(46);
	});

	it('otvor v skle → { odHrany 50, odSpodku = výška vŕtania, priemer 46 }', () => {
		expect(polohaOtvoru(1100, 1004, 1914)).toEqual({
			odHranyMm: 50,
			odSpodkuMm: 1100,
			priemerMm: 46
		});
	});

	it('otvor by nebol celý v skle → null (honest-null, výkres sa negeneruje)', () => {
		// stred 1900 + polomer 23 > výška skla 1914
		expect(polohaOtvoru(1900, 1004, 1914)).toBeNull();
		// stred pod polomerom (otvor by pretŕčal pod spodnú hranu)
		expect(polohaOtvoru(20, 1004, 1914)).toBeNull();
		// úzke sklo — 50 + 23 > šírka
		expect(polohaOtvoru(1050, 60, 1914)).toBeNull();
		expect(polohaOtvoru(Number.NaN, 1004, 1914)).toBeNull();
		expect(polohaOtvoru(1050, 1004, 0)).toBeNull();
	});
});

describe('#587 riadkySklaPosuvu nesie polohu otvoru na riadku „s otvorom"', () => {
	it('Deluxe 4K s rozmerom skla → riadok s otvorom má polohu, riadok bez nie', () => {
		const [s, bez] = riadkySklaPosuvu('Zasklenie 1', 'Deluxe', 4, 'L - P', {
			vrtanieZamku: 1100,
			sirkaMm: 1004,
			vyskaMm: 1914
		});
		expect(s!.otvor).toEqual({ odHranyMm: 50, odSpodkuMm: 1100, priemerMm: 46 });
		expect(bez!.otvor ?? null).toBeNull();
	});

	it('otvor mimo skla → riadok s otvorom ostane (cena IZOS), ale poloha null', () => {
		const [s] = riadkySklaPosuvu('Zasklenie 1', 'Deluxe', 2, 'L - P', {
			vrtanieZamku: 5000,
			sirkaMm: 1004,
			vyskaMm: 1914
		});
		expect(s!.holesQty).toBe(1);
		expect(s!.otvor).toBeNull();
	});
});

describe('#587 rozpis tabúľ s otvorom / bez pre kartu „Sklo (mm)"', () => {
	it('Deluxe 4K → 2 s otvorom + 2 bez; Deluxe 2K → 2 + 0', () => {
		expect(rozpisOtvorovSkla('Deluxe', 4, 'L - P')).toBe(
			'z toho s otvorom ⌀46: 2 ks · bez otvoru: 2 ks'
		);
		expect(rozpisOtvorovSkla('Deluxe', 2, 'L - P')).toBe(
			'z toho s otvorom ⌀46: 2 ks · bez otvoru: 0 ks'
		);
	});

	it('systém bez otvorov → null (karta nič nepridá)', () => {
		for (const sys of ['Robust', 'Slide', 'Štandard', ''])
			expect(rozpisOtvorovSkla(sys, 4, 'Opona')).toBeNull();
	});

	it('SkloOtvoryRozpis (SSR) vypíše rozpis pre Deluxe a nič pre Robust', () => {
		const d = render(SkloOtvoryRozpis, {
			props: { system: 'Deluxe', pocet: 4, otvaranie: 'L - P', testid: 'x' }
		}).body;
		expect(d).toContain('data-testid="x"');
		expect(d).toContain('z toho s otvorom ⌀46: 2 ks · bez otvoru: 2 ks');
		const r = render(SkloOtvoryRozpis, {
			props: { system: 'Robust', pocet: 4, otvaranie: 'L - P', testid: 'x' }
		}).body;
		expect(r).not.toContain('data-testid="x"');
	});
});

describe('#587 náhľad a PDF čítajú TIE ISTÉ konštanty', () => {
	it('Nahlad2D kótuje odsadenie OKRAJ_ZAMOK_MM a default výšku VRTANIE_ZAMKU_DEFAULT_MM', () => {
		const body = render(Nahlad2D, {
			props: {
				S: 4000,
				V: 2000,
				N: 4,
				skloS: 1004,
				skloV: 1914,
				system: 'Deluxe',
				otvaranie: 'L - P'
			}
		}).body;
		expect(body).toContain(`>${OKRAJ_ZAMOK_MM}</text>`);
		expect(body).toContain(`>v ${VRTANIE_ZAMKU_DEFAULT_MM}</text>`);
		expect(body).toContain(`>⌀${D_ZAMOK_MM}</text>`);
	});

	it('Nahlad2D ani PDF generátor nemajú vlastné číselné konštanty polohy (jeden zdroj)', () => {
		const nahlad = fs.readFileSync('src/lib/components/Nahlad2D.svelte', 'utf8');
		expect(nahlad).not.toMatch(/OKRAJ_ZAMOK\s*=\s*\d/);
		expect(nahlad).not.toMatch(/vrtanieZamku\s*=\s*\d/);
		// Stryker (mutation-diff) súbor inštrumentuje a vkladá ČÍSELNÉ id mutantov
		// (`stryMutAct_xxx("50")`, `stryCov_xxx("46", …)`) — tie nie sú konštanty kódu, preto ich
		// pred kontrolou literálov odstráň (pôvodné literály kódu v súbore ostávajú).
		const pdf = fs
			.readFileSync('src/lib/server/sklo-otvor-pdf.ts', 'utf8')
			.replace(/stry(?:MutAct|Cov)_\w+\((?:"\d+"(?:,\s*)?)+\)/g, '');
		expect(pdf).toContain("from '../sklo-otvory'");
		expect(pdf).not.toMatch(/\b(50|46|1050)\b/);
	});

	it('formulár nárezáka (single) nemá vlastný literál default výšky vŕtania', () => {
		for (const f of [
			'src/routes/zasklenia/+page.svelte',
			'src/lib/components/zasklenia/ZasklieniaForm.svelte',
			'src/lib/components/Nahlad2D.svelte'
		])
			expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/\b1050\b/);
	});
});

describe('#587 pomocné pravidlá polohy', () => {
	it('popisPolohyOtvoru — text do poznámky Odoo aj na podklad', () => {
		expect(popisPolohyOtvoru({ odHranyMm: 50, odSpodkuMm: 1100, priemerMm: 46 })).toBe(
			'otvor ⌀46: stred 50 mm od zvislej hrany, 1100 mm od spodku skla'
		);
		expect(fmtMmOtvoru(1050.25)).toBe('1050,3');
	});

	it('triedaOtvoru — d30 do 30 mm, d50 31–50 mm, inak null', () => {
		expect(triedaOtvoru(D_ZAMOK_MM)).toBe('d50');
		expect(triedaOtvoru(30)).toBe('d30');
		expect(triedaOtvoru(31)).toBe('d50');
		expect(triedaOtvoru(51)).toBeNull();
		expect(triedaOtvoru(3)).toBeNull();
		expect(triedaOtvoru(Number.NaN)).toBeNull();
	});

	it('otvoryRucneZmenene — len riadok „— s otvorom ⌀N", ktorého spec nesedí s ⌀', () => {
		const popis = 'Zasklenie 1 — s otvorom ⌀46';
		expect(otvoryRucneZmenene({ popis, holesQty: 1, holeSize: 'd50' })).toBe(false);
		expect(otvoryRucneZmenene({ popis, holesQty: 2, holeSize: 'd50' })).toBe(true);
		expect(otvoryRucneZmenene({ popis, holesQty: 1, holeSize: 'd30' })).toBe(true);
		expect(otvoryRucneZmenene({ popis: 'ATYP', holesQty: 2, holeSize: 'd30' })).toBe(false);
	});

	it('stranyOtvorov — prvá tabuľa ľavé krídlo, ďalšia pravé (pravidlo otvoryVSkle)', () => {
		expect(stranyOtvorov(otvoryVSkle('Deluxe', 4, 'L - P').sOtvorom)).toEqual({
			vlavo: 1,
			vpravo: 1
		});
		expect(stranyOtvorov(otvoryVSkle('Deluxe', 1, 'L - P').sOtvorom)).toEqual({
			vlavo: 1,
			vpravo: 0
		});
		expect(stranyOtvorov(0)).toEqual({ vlavo: 0, vpravo: 0 });
		expect(stranyOtvorov(-1)).toEqual({ vlavo: 0, vpravo: 0 });
	});
});
