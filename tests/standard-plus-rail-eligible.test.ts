// #134 — predikát „je toto systém s koľajnicou, ktorá sa dá zväčšiť" bol
// trojnásobne duplikovaný (railUpsize v compute.ts, checkbox visibility v
// +page.svelte, pridavnaKolajnicaDefault v styl.ts). Vyextrahovaný do
// `standardPlusRailEligible` (styl.ts). #456 rozšírený na `plusRailEligible`
// (Slide, Deluxe, Robust). Tento test kryje:
//  1. truth-table `standardPlusRailEligible` (pôvodný, pre pridavnaKolajnicaDefault),
//  2. truth-table `plusRailEligible` (rozšírený, pre viditeľnosť checkboxu + railUpsize),
//  3. že `railUpsize` (compute.ts), `pridavnaKolajnicaDefault` (styl.ts) a
//     checkbox visibility (`plusRailEligible`) SÚHLASIA pre rovnaké vstupy.
import { describe, it, expect } from 'vitest';
import {
	standardPlusRailEligible,
	plusRailEligible,
	pridavnaKolajnicaDefault
} from '../src/lib/styl';
import { railUpsize, RAIL_UPSIZE } from '../src/lib/server/compute';

const SYSTEMY = ['Robust', 'Slide', 'Štandard', 'Štandard +', 'Deluxe'];
const STYLY = ['2K', '3K', '4K', '5K', '6K', '2x2K', '2x3K'];

describe('standardPlusRailEligible — #134 (zachovaný pre auto-default IZO)', () => {
	it('true LEN pre Štandard + mimo 6K', () => {
		for (const system of SYSTEMY) {
			for (const styl of STYLY) {
				const expected = system === 'Štandard +' && !styl.startsWith('6K');
				expect(standardPlusRailEligible(system, styl)).toBe(expected);
			}
		}
	});

	it('6K je vylúčené — 7K koľajnica neexistuje', () => {
		expect(standardPlusRailEligible('Štandard +', '6K')).toBe(false);
	});

	it('mimo Štandard + je vždy false, nezávisle od štýlu', () => {
		for (const system of SYSTEMY.filter((s) => s !== 'Štandard +')) {
			for (const styl of STYLY) {
				expect(standardPlusRailEligible(system, styl)).toBe(false);
			}
		}
	});
});

describe('plusRailEligible × pridavnaKolajnicaDefault — zhoda (#134, #456)', () => {
	it('pridavnaKolajnicaDefault sa zhoduje so standardPlusRailEligible (keď je sklo IZO) — auto-default je LEN Štandard+', () => {
		for (const system of SYSTEMY) {
			for (const styl of STYLY) {
				const eligible = standardPlusRailEligible(system, styl);
				expect(pridavnaKolajnicaDefault(system, styl, 'Izolačné sklo 4.8.4')).toBe(eligible);
				// s neizolačným sklom musí byť VŽDY false, nezávisle od eligibility
				expect(pridavnaKolajnicaDefault(system, styl, 'Float sklo 4 mm')).toBe(false);
			}
		}
	});

	it('railUpsize swapne LEN keď plusRailEligible je true A kód má vyšší variant', () => {
		for (const system of SYSTEMY) {
			for (const styl of STYLY) {
				for (const kod of Object.keys(RAIL_UPSIZE)) {
					const eligible = plusRailEligible(system, styl);
					const up = railUpsize(system, styl, true, kod, 'pôvodný názov');
					if (eligible) {
						expect(up).toEqual(RAIL_UPSIZE[kod]);
					} else {
						expect(up).toEqual({ kod, nazov: 'pôvodný názov' });
					}
				}
			}
		}
	});

	it('railUpsize nikdy nezmení kód, keď pridavna=false — nezávisle od eligibility', () => {
		for (const system of SYSTEMY) {
			for (const styl of STYLY) {
				for (const kod of Object.keys(RAIL_UPSIZE)) {
					const up = railUpsize(system, styl, false, kod, 'pôvodný názov');
					expect(up).toEqual({ kod, nazov: 'pôvodný názov' });
				}
			}
		}
	});

	it('max-K kódy nemajú v RAIL_UPSIZE záznam — dôkaz, že gate + tabuľka sú zosúladené', () => {
		// Štandard+/Deluxe: 6K spodná (ZASP202437) → 7K neexistuje
		expect(RAIL_UPSIZE['ZASP202437']).toBeUndefined();
		// Slide: 3K Slide (ZASP00100) → 4K Slide neexistuje
		expect(RAIL_UPSIZE['ZASP00100']).toBeUndefined();
		// Robust: 4K (ZASP20254) → 5K Robust neexistuje
		expect(RAIL_UPSIZE['ZASP20254']).toBeUndefined();
	});
});
