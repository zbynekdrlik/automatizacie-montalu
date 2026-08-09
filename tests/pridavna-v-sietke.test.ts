// #123 ROZHODNUTÉ — Patrik (Odoo 207, msg #1646652, 2026-08-09): checkbox
// „Prídavná koľajnica" pri zapnutej sieťke na 2K systéme „Štandard +" nič
// navyše nemení — sieťka sama vynúti celú 3K sadu, ktorá spodnú (jediné, čo
// prídavná pridáva) už obsahuje. Money odpis (`railUpsize`/`sietkaKolajnicaSwap`
// v compute.ts) sa touto odpoveďou NEMENÍ (pozri tests/compute.test.ts pre
// odpisové kódy) — tento súbor overuje LEN čistú UI logiku v `sietka.ts`
// (`pridavnaJeVSietke`/`pridavnaKolajnicaHint`), client-safe, bez `cfg`.
import { describe, it, expect } from 'vitest';
import { pridavnaJeVSietke, pridavnaKolajnicaHint } from '../src/lib/sietka';

describe('pridavnaJeVSietke — #123', () => {
	it('true LEN na Štandard + | 2K (základný štýl) so zapnutou sieťkou', () => {
		expect(pridavnaJeVSietke('Štandard +', '2K', true)).toBe(true);
		expect(pridavnaJeVSietke('Štandard +', '2K IZO', true)).toBe(true); // IZO prípona nevadí
	});

	it('false keď je sieťka vypnutá — checkbox platí normálne (spodná +1)', () => {
		expect(pridavnaJeVSietke('Štandard +', '2K', false)).toBe(false);
	});

	it('false na 3K a vyššie — Patrik: „Ak už bude 3K a viac nič mi sieťka iné nemení"', () => {
		expect(pridavnaJeVSietke('Štandard +', '3K', true)).toBe(false);
		expect(pridavnaJeVSietke('Štandard +', '4K', true)).toBe(false);
		expect(pridavnaJeVSietke('Štandard +', '3K IZO', true)).toBe(false);
	});

	it('false mimo „Štandard +" — checkbox tam v UI vôbec nie je a railUpsize naň negejtuje', () => {
		expect(pridavnaJeVSietke('Štandard', '2K', true)).toBe(false);
		expect(pridavnaJeVSietke('Robust', '2K', true)).toBe(false);
		expect(pridavnaJeVSietke('Slide', '2K', true)).toBe(false);
		expect(pridavnaJeVSietke('Deluxe', '2K', true)).toBe(false);
	});

	it('false na oponové štýly (2x*) — mimo scope prídavnej aj sieťky', () => {
		expect(pridavnaJeVSietke('Štandard +', '2x2K', true)).toBe(false);
	});
});

describe('pridavnaKolajnicaHint — #123', () => {
	it('null, keď pridavnaJeVSietke neplatí (žiadna hláška)', () => {
		expect(pridavnaKolajnicaHint('Štandard +', '2K', false, true)).toBeNull();
		expect(pridavnaKolajnicaHint('Štandard +', '3K', true, true)).toBeNull();
		expect(pridavnaKolajnicaHint('Robust', '2K', true, true)).toBeNull();
	});

	it('text existuje a spomína 3K, keď platí — checkbox ZAŠKRTNUTÝ (pridavna=true)', () => {
		const t = pridavnaKolajnicaHint('Štandard +', '2K', true, true);
		expect(t).toBeTruthy();
		expect(t).toMatch(/3K/);
		expect(t).toMatch(/[Nn]echaj/); // checkbox sa NESMIE disablovať/skrývať — text hovorí "nechaj zaškrtnuté"
	});

	it('text existuje aj keď checkbox NIE JE zaškrtnutý (pridavna=false) — iné znenie', () => {
		const t = pridavnaKolajnicaHint('Štandard +', '2K', true, false);
		expect(t).toBeTruthy();
		expect(t).toMatch(/3K/);
		expect(t).not.toMatch(/[Nn]echaj ju zaškrtnutú/); // nemá zmysel radiť "nechaj" keď nie je zaškrtnuté
	});

	it('rovnaký text platí aj pre IZO variant (žiadny vlastný IZO kód koľajnice)', () => {
		expect(pridavnaKolajnicaHint('Štandard +', '2K IZO', true, true)).toBe(
			pridavnaKolajnicaHint('Štandard +', '2K', true, true)
		);
	});
});
