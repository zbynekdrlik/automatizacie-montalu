// #417 fáza 2: unit testy pre odpad sekciu v Odoo note HTML.
import { describe, it, expect } from 'vitest';
import {
	buildZakazkaNote,
	buildZakazkaNoteHtml,
	type ZakazkaNote
} from '../src/lib/server/odoo-zakazka';

const baseNote: ZakazkaNote = {
	zak: 'ZAK2026999',
	op: 'OP260999',
	zakaznik: 'Test s.r.o.',
	scope: 'live',
	parkovanych: 0,
	bezPoloziek: 0,
	odpisovVScope: 1,
	sekcie: [{ nadpis: 'Profily a komponenty', polozky: [] }],
	cenaSpolu: null,
	cenaKompletna: false,
	cenaNakupSpolu: null,
	nakupKompletna: false,
	odpad: []
};

describe('buildZakazkaNoteHtml — odpad sekcia', () => {
	it('bez odpadových dát sa sekcia nevykreslí', () => {
		const html = buildZakazkaNoteHtml({ ...baseNote, odpad: [] });
		expect(html).not.toContain('Odpad z nárezov');
	});

	it('s odpadovými dátami sa vykreslí tabuľka + súčet', () => {
		const html = buildZakazkaNoteHtml({
			...baseNote,
			odpad: [
				{
					profilKod: 'ZASP001',
					profilNazov: 'Rámový profil',
					odpadMm: 500,
					materialMm: 15000,
					tyce: 2
				},
				{
					profilKod: 'ZASP002',
					profilNazov: 'Nosový profil',
					odpadMm: 200,
					materialMm: 7500,
					tyce: 1
				}
			]
		});
		expect(html).toContain('Odpad z nárezov');
		expect(html).toContain('ZASP001');
		expect(html).toContain('Rámový profil');
		expect(html).toContain('500');
		expect(html).toContain('15000');
		expect(html).toContain('ZASP002');
		expect(html).toContain('Nosový profil');
		expect(html).toContain('200');
		expect(html).toContain('7500');
		// per-profil %: 500/15000 = 3.3%, 200/7500 = 2.7%
		expect(html).toContain('3.3 %');
		expect(html).toContain('2.7 %');
		// súčet: 700mm / 22500mm = 3.1%
		expect(html).toContain('700 mm');
		expect(html).toContain('3.1 %');
	});

	it('odpad s materialMm=0 má 0 % (obrana pred delením nulou)', () => {
		const html = buildZakazkaNoteHtml({
			...baseNote,
			odpad: [{ profilKod: 'X', profilNazov: 'Y', odpadMm: 0, materialMm: 0, tyce: 0 }]
		});
		expect(html).toContain('Odpad z nárezov');
		expect(html).toContain('0 %');
	});
});

describe('buildZakazkaNote — odpad pole', () => {
	it('prevezme odpad z prehľadu', () => {
		const prehlad = {
			zak: 'ZAK2026999',
			zakNorm: 'ZAK2026999',
			zakaznik: 'Test s.r.o.',
			odpisy: [],
			scope: 'live' as const,
			polozky: [],
			odpisovVScope: 1,
			parkovanych: 0,
			bezPoloziek: 0,
			odpad: [
				{ profilKod: 'ZASP001', profilNazov: 'Rámový', odpadMm: 500, materialMm: 15000, tyce: 2 }
			]
		};
		const note = buildZakazkaNote(prehlad, 'OP260999', null);
		expect(note.odpad).toEqual(prehlad.odpad);
	});
});
