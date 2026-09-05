// #456 — prídavná koľajnica rozšírená na Slide/Deluxe/Robust.
// `plusRailEligible` nahrádza pôvodný `standardPlusRailEligible` gate pre VIDITEĽNOSŤ
// checkboxu a pre `railUpsize` swap. `pridavnaKolajnicaDefault` (auto-default na IZO)
// ostáva LEN pre Štandard + — Patrik (#1646652) „my vždy dávame pri štandardoch IZO
// spodnú koľaj navyše" sa netýka ostatných systémov.
//
// Nové kódy v RAIL_UPSIZE (obvodové koľajnice):
//   Slide:  ZASP00097 (2K) → ZASP00100 (3K); 4K Slide neexistuje
//   Robust: ZASP00014 (2K) → ZASP00016 (3K) → ZASP20254 (4K); 5K Robust neexistuje
//   Deluxe: zdieľa spodné kódy so Štandard + (ZASP00104→…), gate otvorený
import { describe, it, expect } from 'vitest';
import { plusRailEligible } from '../src/lib/styl';
import { railUpsize, RAIL_UPSIZE } from '../src/lib/server/compute';

const SYSTEMY = ['Robust', 'Slide', 'Štandard', 'Štandard +', 'Deluxe'];
const STYLY = ['2K', '3K', '4K', '5K', '6K', '2x2K', '2x3K', '2x4K'];

describe('plusRailEligible — #456', () => {
	it('Štandard + — eligible mimo 6K (existujúce správanie)', () => {
		expect(plusRailEligible('Štandard +', '2K')).toBe(true);
		expect(plusRailEligible('Štandard +', '3K')).toBe(true);
		expect(plusRailEligible('Štandard +', '4K')).toBe(true);
		expect(plusRailEligible('Štandard +', '5K')).toBe(true);
		expect(plusRailEligible('Štandard +', '6K')).toBe(false);
		expect(plusRailEligible('Štandard +', '2x2K')).toBe(true);
		expect(plusRailEligible('Štandard +', '2x3K')).toBe(true);
	});

	it('Deluxe — eligible mimo 6K (zdieľa spodné kódy so Štandard +)', () => {
		expect(plusRailEligible('Deluxe', '2K')).toBe(true);
		expect(plusRailEligible('Deluxe', '3K')).toBe(true);
		expect(plusRailEligible('Deluxe', '5K')).toBe(true);
		expect(plusRailEligible('Deluxe', '6K')).toBe(false);
		expect(plusRailEligible('Deluxe', '2x3K')).toBe(true);
		expect(plusRailEligible('Deluxe', '2x4K')).toBe(true);
	});

	it('Slide — eligible len 2K (3K Slide je maximum, 4K Slide neexistuje)', () => {
		expect(plusRailEligible('Slide', '2K')).toBe(true);
		expect(plusRailEligible('Slide', '3K')).toBe(false);
		expect(plusRailEligible('Slide', '2x2K')).toBe(true);
		expect(plusRailEligible('Slide', '2x3K')).toBe(false);
	});

	it('Robust — eligible mimo 4K (4K Robust je maximum, 5K Robust neexistuje)', () => {
		expect(plusRailEligible('Robust', '2K')).toBe(true);
		expect(plusRailEligible('Robust', '3K')).toBe(true);
		expect(plusRailEligible('Robust', '4K')).toBe(false);
		expect(plusRailEligible('Robust', '2x2K')).toBe(true);
		expect(plusRailEligible('Robust', '2x3K')).toBe(true);
		expect(plusRailEligible('Robust', '2x4K')).toBe(false);
	});

	it('Štandard (starý, bez +) — vždy false (nepoužíva prídavnú koľajnicu)', () => {
		for (const styl of STYLY) {
			expect(plusRailEligible('Štandard', styl)).toBe(false);
		}
	});

	it('neznámy systém — vždy false', () => {
		expect(plusRailEligible('Neznámy', '2K')).toBe(false);
	});
});

describe('railUpsize — Slide/Deluxe/Robust kódy (#456)', () => {
	it('Slide 2K: ZASP00097 → ZASP00100 (obvodová 2K→3K)', () => {
		const up = railUpsize('Slide', '2K', true, 'ZASP00097', 'Koľajnica 2K Slide Surový 7500 mm');
		expect(up.kod).toBe('ZASP00100');
		expect(up.nazov).toMatch(/3K.*Slide/);
	});

	it('Slide 3K: ZASP00100 nemá +1 (4K Slide neexistuje)', () => {
		const up = railUpsize('Slide', '3K', true, 'ZASP00100', 'Koľajnica 3K Slide Surový 7500 mm');
		// plusRailEligible('Slide', '3K') = false, takže sa nič nezmení
		expect(up.kod).toBe('ZASP00100');
	});

	it('Robust 2K: ZASP00014 → ZASP00016 (obvodová 2K→3K)', () => {
		const up = railUpsize('Robust', '2K', true, 'ZASP00014', 'Koľajnica 2K Surový 7500 mm');
		expect(up.kod).toBe('ZASP00016');
		expect(up.nazov).toMatch(/3K/);
	});

	it('Robust 3K: ZASP00016 → ZASP20254 (obvodová 3K→4K)', () => {
		const up = railUpsize('Robust', '3K', true, 'ZASP00016', 'Koľajnica 3K Surový 7500 mm');
		expect(up.kod).toBe('ZASP20254');
	});

	it('Robust 4K: ZASP20254 nemá +1 (5K Robust neexistuje)', () => {
		const up = railUpsize('Robust', '4K', true, 'ZASP20254', 'Koľajnica 4K Surový 7500mm');
		// plusRailEligible('Robust', '4K') = false
		expect(up.kod).toBe('ZASP20254');
	});

	it('Deluxe 2K: ZASP00104 → ZASP00030 (spodná 2K→3K, zdieľané kódy so Štandard +)', () => {
		const up = railUpsize('Deluxe', '2K', true, 'ZASP00104', 'Koľajnica spodná 2K Surový 7500 mm');
		expect(up.kod).toBe('ZASP00030');
	});

	it('Deluxe 5K: ZASP202432 → ZASP202437 (spodná 5K→6K)', () => {
		const up = railUpsize('Deluxe', '5K', true, 'ZASP202432', 'Koľajnica spodná 5K Surový 7500 mm');
		expect(up.kod).toBe('ZASP202437');
	});

	it('pridavna=false → žiadna zmena pre žiadny systém', () => {
		for (const system of SYSTEMY) {
			const up = railUpsize(system, '2K', false, 'ZASP00097', 'orig');
			expect(up).toEqual({ kod: 'ZASP00097', nazov: 'orig' });
		}
	});

	it('Štandard + — existujúce správanie nezmenené', () => {
		const up = railUpsize('Štandard +', '2K', true, 'ZASP00104', 'Koľajnica spodná 2K Surový 7500 mm');
		expect(up.kod).toBe('ZASP00030');
	});
});
