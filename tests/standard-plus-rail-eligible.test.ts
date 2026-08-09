// #134 — predikát „je toto Štandard + s koľajnicou, ktorá sa dá zväčšiť" bol
// trojnásobne duplikovaný (railUpsize v compute.ts, checkbox visibility v
// +page.svelte, pridavnaKolajnicaDefault v styl.ts). Vyextrahovaný do
// `standardPlusRailEligible` (styl.ts). Tento test kryje dve veci:
//  1. truth-table samotného predikátu naprieč system × styl,
//  2. že `railUpsize` (compute.ts), `pridavnaKolajnicaDefault` (styl.ts) a
//     checkbox visibility (rovnaký `standardPlusRailEligible` import v
//     +page.svelte — nekontrolovateľné z .svelte súboru vo vitest, preto sa
//     overuje nepriamo cez `railUpsize`'s efektívny výsledok) SÚHLASIA pre
//     rovnaké vstupy — ak by niekedy zase zdrifitovali, tento test spadne.
import { describe, it, expect } from 'vitest';
import { standardPlusRailEligible, pridavnaKolajnicaDefault } from '../src/lib/styl';
import { railUpsize, RAIL_UPSIZE } from '../src/lib/server/compute';

const SYSTEMY = ['Robust', 'Slide', 'Štandard', 'Štandard +', 'Deluxe'];
const STYLY = ['2K', '3K', '4K', '5K', '6K', '2x2K', '2x3K'];

describe('standardPlusRailEligible — #134', () => {
	it('true LEN pre Štandard + mimo 6K (a mimo opony 2x6K, keby existovala)', () => {
		for (const system of SYSTEMY) {
			for (const styl of STYLY) {
				const expected = system === 'Štandard +' && !styl.startsWith('6K');
				expect(standardPlusRailEligible(system, styl)).toBe(expected);
			}
		}
	});

	it('6K je vylúčené — 7K koľajnica neexistuje (Štandard + navyše nemá oponu, takže "2x6K" v praxi nenastáva)', () => {
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

describe('standardPlusRailEligible — zhoda naprieč konzumentmi (#134)', () => {
	it('pridavnaKolajnicaDefault sa zhoduje so standardPlusRailEligible (keď je sklo IZO)', () => {
		for (const system of SYSTEMY) {
			for (const styl of STYLY) {
				const eligible = standardPlusRailEligible(system, styl);
				expect(pridavnaKolajnicaDefault(system, styl, 'Izolačné sklo 4.8.4')).toBe(eligible);
				// s neizolačným sklom musí byť VŽDY false, nezávisle od eligibility
				expect(pridavnaKolajnicaDefault(system, styl, 'Float sklo 4 mm')).toBe(false);
			}
		}
	});

	it('railUpsize swapne LEN keď standardPlusRailEligible je true A kód má vyšší variant', () => {
		for (const system of SYSTEMY) {
			for (const styl of STYLY) {
				for (const kod of Object.keys(RAIL_UPSIZE)) {
					const eligible = standardPlusRailEligible(system, styl);
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

	it('6K kód (ZASP202437) nemá v RAIL_UPSIZE záznam — dôkaz, že pôvodný bez-styl gate bol dovtedy náhodne bezpečný', () => {
		expect(RAIL_UPSIZE['ZASP202437']).toBeUndefined();
	});
});
