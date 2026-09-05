// #123 ROZHODNUTÉ — Patrik (Odoo 207, msg #1646652, 2026-08-09), rozšírené #456:
// Checkbox „Prídavná koľajnica" pri zapnutej sieťke na 2K systéme nič navyše
// nemení — sieťka sama vynúti celú 3K sadu, a koľajnicu, ktorú by inak pridala
// prídavná, tá 3K sada už obsahuje. Platí pre VŠETKY systémy s `plusRailEligible`
// (#456, nie len Štandard +). Money odpis (`railUpsize`/`sietkaKolajnicaSwap`)
// sa touto funkciou NEMENÍ — čisto UI logika.
import { describe, it, expect } from 'vitest';
import { pridavnaJeVSietke, pridavnaKolajnicaHint } from '../src/lib/sietka';

describe('pridavnaJeVSietke — #123, rozšírené #456', () => {
	it('true na 2K (základný štýl) so zapnutou sieťkou — pre VŠETKY systémy s plusRailEligible', () => {
		expect(pridavnaJeVSietke('Štandard +', '2K', true)).toBe(true);
		expect(pridavnaJeVSietke('Štandard +', '2K IZO', true)).toBe(true);
		expect(pridavnaJeVSietke('Deluxe', '2K', true)).toBe(true);
		expect(pridavnaJeVSietke('Slide', '2K', true)).toBe(true);
		expect(pridavnaJeVSietke('Robust', '2K', true)).toBe(true);
	});

	it('false keď je sieťka vypnutá — checkbox platí normálne (koľajnica +1)', () => {
		expect(pridavnaJeVSietke('Štandard +', '2K', false)).toBe(false);
		expect(pridavnaJeVSietke('Slide', '2K', false)).toBe(false);
		expect(pridavnaJeVSietke('Robust', '2K', false)).toBe(false);
	});

	it('false na 3K a vyššie — sieťka na 3K+ nemení koľajnicu', () => {
		expect(pridavnaJeVSietke('Štandard +', '3K', true)).toBe(false);
		expect(pridavnaJeVSietke('Štandard +', '4K', true)).toBe(false);
		expect(pridavnaJeVSietke('Robust', '3K', true)).toBe(false);
		expect(pridavnaJeVSietke('Robust', '4K', true)).toBe(false);
	});

	it('false pre Štandard (starý, bez +) — systém nemá prídavnú koľajnicu', () => {
		expect(pridavnaJeVSietke('Štandard', '2K', true)).toBe(false);
	});

	it('false na oponové štýly (2x*) — mimo scope', () => {
		expect(pridavnaJeVSietke('Štandard +', '2x2K', true)).toBe(false);
		expect(pridavnaJeVSietke('Slide', '2x2K', true)).toBe(false);
	});
});

describe('pridavnaKolajnicaHint — #123, rozšírené #456', () => {
	it('null, keď pridavnaJeVSietke neplatí (žiadna hláška)', () => {
		expect(pridavnaKolajnicaHint('Štandard +', '2K', false, true)).toBeNull();
		expect(pridavnaKolajnicaHint('Štandard +', '3K', true, true)).toBeNull();
		expect(pridavnaKolajnicaHint('Štandard', '2K', true, true)).toBeNull();
	});

	it('Štandard + text spomína hornú aj spodnú (horná+spodná topológia)', () => {
		const t = pridavnaKolajnicaHint('Štandard +', '2K', true, true);
		expect(t).toBeTruthy();
		expect(t).toMatch(/3K/);
		expect(t).toMatch(/hornú.*spodnú/);
		expect(t).toMatch(/[Nn]echaj/);
	});

	it('Slide/Robust text NESPOMÍNA hornú/spodnú (obvodová topológia)', () => {
		const tSlide = pridavnaKolajnicaHint('Slide', '2K', true, true);
		expect(tSlide).toBeTruthy();
		expect(tSlide).toMatch(/3K/);
		expect(tSlide).not.toMatch(/hornú.*spodnú/);
		expect(tSlide).toMatch(/[Nn]echaj/);

		const tRobust = pridavnaKolajnicaHint('Robust', '2K', true, false);
		expect(tRobust).toBeTruthy();
		expect(tRobust).toMatch(/3K/);
		expect(tRobust).not.toMatch(/hornú.*spodnú/);
		expect(tRobust).not.toMatch(/[Nn]echaj/);
	});

	it('Deluxe text spomína hornú aj spodnú (rovnaká topológia ako Štandard +)', () => {
		const t = pridavnaKolajnicaHint('Deluxe', '2K', true, true);
		expect(t).toBeTruthy();
		expect(t).toMatch(/hornú.*spodnú/);
	});

	it('rovnaký text pre IZO variant (žiadny vlastný IZO kód koľajnice)', () => {
		expect(pridavnaKolajnicaHint('Štandard +', '2K IZO', true, true)).toBe(
			pridavnaKolajnicaHint('Štandard +', '2K', true, true)
		);
	});
});
