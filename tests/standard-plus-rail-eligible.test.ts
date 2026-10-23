// #134 — predikát „je toto systém s koľajnicou, ktorá sa dá zväčšiť" bol
// trojnásobne duplikovaný (railUpsize v compute.ts, checkbox visibility v
// +page.svelte, pridavnaKolajnicaDefault v styl.ts). Vyextrahovaný do
// `standardPlusRailEligible` (styl.ts). #456 rozšírený na `plusRailEligible`
// (Slide, Deluxe, Robust). Úloha 1459 (#618): starý Štandard dostal checkbox tiež a
// `standardPlusRailEligible` (gate auto-defaultu LEN pre Štandard +) zanikol — auto-default
// je teraz rodina Štandard (`skloVyberaIzo`) × `plusRailEligible`. Tento test kryje:
//  1. truth-table auto-defaultu (rodina Štandard mimo 6K, pri IZO skle),
//  2. truth-table `plusRailEligible` (rozšírený, pre viditeľnosť checkboxu + railUpsize),
//  3. že `railUpsize` (compute.ts), `pridavnaKolajnicaDefault` (styl.ts) a
//     checkbox visibility (`plusRailEligible`) SÚHLASIA pre rovnaké vstupy.
import { describe, it, expect } from 'vitest';
import { plusRailEligible, pridavnaKolajnicaDefault, skloVyberaIzo } from '../src/lib/styl';
import { railUpsize, RAIL_UPSIZE } from '../src/lib/server/compute';

const SYSTEMY = ['Robust', 'Slide', 'Štandard', 'Štandard +', 'Deluxe'];
const STYLY = ['2K', '3K', '4K', '5K', '6K', '2x2K', '2x3K'];

describe('auto-default prídavnej koľajnice — rodina Štandard (#134 → úloha 1459)', () => {
	it('true LEN pre Štandard + a starý Štandard mimo 6K (pri IZO skle)', () => {
		for (const system of SYSTEMY) {
			for (const styl of STYLY) {
				const expected =
					(system === 'Štandard +' || system === 'Štandard') && !styl.startsWith('6K');
				expect(pridavnaKolajnicaDefault(system, styl, 'Izolačné sklo 4.8.4'), system + styl).toBe(
					expected
				);
			}
		}
	});

	it('6K je vylúčené — 7K koľajnica neexistuje', () => {
		expect(pridavnaKolajnicaDefault('Štandard +', '6K', 'Izolačné sklo 4.8.4')).toBe(false);
		expect(pridavnaKolajnicaDefault('Štandard', '6K', 'Izolačné sklo 4.8.4')).toBe(false);
	});

	it('mimo rodiny Štandard je vždy false, nezávisle od štýlu', () => {
		for (const system of SYSTEMY.filter((s) => !skloVyberaIzo(s))) {
			for (const styl of STYLY) {
				expect(pridavnaKolajnicaDefault(system, styl, 'Izolačné sklo 4.8.4')).toBe(false);
			}
		}
	});
});

describe('plusRailEligible × pridavnaKolajnicaDefault — zhoda (#134, #456)', () => {
	it('pridavnaKolajnicaDefault = rodina Štandard × plusRailEligible (keď je sklo IZO) — auto-default je LEN pri Štandardoch', () => {
		for (const system of SYSTEMY) {
			for (const styl of STYLY) {
				const eligible = skloVyberaIzo(system) && plusRailEligible(system, styl);
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
