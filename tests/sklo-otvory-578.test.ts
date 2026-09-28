// #578: JEDNO pravidlo „ktoré tabule majú vŕtaný otvor" (`otvoryVSkle`) — používa ho výkres
// (`Nahlad2D` kreslí zámkové otvory ⌀46) AJ objednávka skla (riadok „s otvorom" + „bez").
// Výkres a objednávka tak nemôžu nesedieť.
import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import { otvoryVSkle, riadkySklaPosuvu } from '../src/lib/sklo-otvory';
import Nahlad2D from '../src/lib/components/Nahlad2D.svelte';

describe('#578 otvoryVSkle — pravidlo', () => {
	it('Deluxe: krajné sklá (N=1 → 1 tabuľa, inak 2), 1 otvor ⌀46 (d50) na tabuľu', () => {
		expect(otvoryVSkle('Deluxe', 4)).toEqual({
			indexy: [0, 3],
			sOtvorom: 2,
			otvorovNaTabulu: 1,
			velkost: 'd50'
		});
		expect(otvoryVSkle('Deluxe', 1)).toEqual({
			indexy: [0],
			sOtvorom: 1,
			otvorovNaTabulu: 1,
			velkost: 'd50'
		});
		// opona 2x3K = 6 polí — výkres kreslí otvory na krajných (0 a 5)
		expect(otvoryVSkle('Deluxe', 6).indexy).toEqual([0, 5]);
	});

	it('ostatné systémy do skla nevŕtajú', () => {
		for (const sys of ['Robust', 'Slide', 'Štandard', 'Štandard +', 'Štandard Drevo', '']) {
			expect(otvoryVSkle(sys, 4)).toEqual({
				indexy: [],
				sOtvorom: 0,
				otvorovNaTabulu: 0,
				velkost: ''
			});
		}
	});

	it('neplatné N (0, NaN) → žiadne otvory', () => {
		expect(otvoryVSkle('Deluxe', 0).sOtvorom).toBe(0);
		expect(otvoryVSkle('Deluxe', Number.NaN).sOtvorom).toBe(0);
	});
});

describe('#578 riadkySklaPosuvu — rozdelenie posuvu na riadky objednávky', () => {
	it('Deluxe 4K → „s otvorom" (2 ks, 1 × d50) + bez (2 ks)', () => {
		expect(riadkySklaPosuvu('Zasklenie 1', 'Deluxe', 4)).toEqual([
			{ popis: 'Zasklenie 1 — s otvorom ⌀46', pocet: 2, holesQty: 1, holeSize: 'd50' },
			{ popis: 'Zasklenie 1', pocet: 2, holesQty: 0, holeSize: '' }
		]);
	});

	it('Deluxe 2K → len riadok s otvorom (bez-riadok s 0 ks nevznikne)', () => {
		expect(riadkySklaPosuvu('Zasklenie 2', 'Deluxe', 2)).toEqual([
			{ popis: 'Zasklenie 2 — s otvorom ⌀46', pocet: 2, holesQty: 1, holeSize: 'd50' }
		]);
	});

	it('Deluxe 1 krídlo → 1 riadok s otvorom', () => {
		expect(riadkySklaPosuvu('Zasklenie 1', 'Deluxe', 1)).toEqual([
			{ popis: 'Zasklenie 1 — s otvorom ⌀46', pocet: 1, holesQty: 1, holeSize: 'd50' }
		]);
	});

	it('Robust → jeden riadok bez otvorov', () => {
		expect(riadkySklaPosuvu('Zasklenie 1', 'Robust', 3)).toEqual([
			{ popis: 'Zasklenie 1', pocet: 3, holesQty: 0, holeSize: '' }
		]);
	});
});

describe('#578 Nahlad2D kreslí otvory podľa TOHO ISTÉHO pravidla', () => {
	const props = (system: string, N: number) => ({
		S: 1000 * N,
		V: 2000,
		N,
		skloS: 950,
		skloV: 1900,
		system
	});
	// zámkové otvory = prerušované kruhy (e2e/app.spec.ts D46 test ich počíta tak isto)
	const pocetOtvorov = (html: string) => (html.match(/<circle[^>]*stroke-dasharray/g) ?? []).length;

	for (const [system, N] of [
		['Deluxe', 1],
		['Deluxe', 2],
		['Deluxe', 4],
		['Deluxe', 6],
		['Robust', 4],
		['Slide', 3]
	] as const) {
		it(`${system} N=${N}: počet otvorov na výkrese = pravidlo`, () => {
			const { body } = render(Nahlad2D, { props: props(system, N) });
			expect(pocetOtvorov(body)).toBe(otvoryVSkle(system, N).indexy.length);
		});
	}
});
