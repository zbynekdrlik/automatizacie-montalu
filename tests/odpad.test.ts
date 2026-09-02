// #417 — kumulatívny odpad naprieč profilmi (display-only). Overuje čistú
// funkciu sumaOdpad: súčet koncových zvyškov + vážené % z použitého materiálu,
// s vylúčením profilov bez použitej tyče. Žiadny Money odpis, len sčítanie.
import { describe, it, expect } from 'vitest';
import { sumaOdpad } from '../src/lib/odpad';
import type { MaterialRow } from '../src/lib/server/compute';

/** minimálny MaterialRow — sumaOdpad číta len tyce/odpadMm/barLen, zvyšok je typová výplň */
function mk(o: Partial<MaterialRow>): MaterialRow {
	return {
		kod: '',
		nazov: '',
		rezy: [],
		tyce: 0,
		bary: [],
		odpadMm: 0,
		odpadPct: 0,
		barLen: 7500,
		sikmyRez: false,
		...o
	};
}

describe('sumaOdpad (#417)', () => {
	it('prázdny vstup → samé nuly', () => {
		expect(sumaOdpad([])).toEqual({ profily: 0, odpadMm: 0, materialMm: 0, odpadPct: 0 });
	});

	it('jeden profil → súčet = ten profil, % = odpad / (tyce×barLen)', () => {
		// 2 tyče × 7500 = 15000 mm materiálu; 300 mm odpad → 300/15000 = 2,0 %
		const r = sumaOdpad([mk({ tyce: 2, barLen: 7500, odpadMm: 300 })]);
		expect(r).toEqual({ profily: 1, odpadMm: 300, materialMm: 15000, odpadPct: 2 });
	});

	it('dva profily rôznej dĺžky tyče → vážený podiel z celého materiálu', () => {
		// A: 2×7500=15000, odpad 300 ; B: 1×6000=6000, odpad 600
		// spolu: odpad 900, materiál 21000 → 900/21000 = 4,285… → 4,3 %
		const r = sumaOdpad([
			mk({ tyce: 2, barLen: 7500, odpadMm: 300 }),
			mk({ tyce: 1, barLen: 6000, odpadMm: 600 })
		]);
		expect(r).toEqual({ profily: 2, odpadMm: 900, materialMm: 21000, odpadPct: 4.3 });
	});

	it('profily s tyce=0 sa NErátajú (ani do počtu, ani do odpadu/materiálu)', () => {
		const r = sumaOdpad([
			mk({ tyce: 2, barLen: 7500, odpadMm: 300 }),
			mk({ tyce: 0, barLen: 7500, odpadMm: 9999 }) // nepoužitý profil — vylúčený
		]);
		expect(r).toEqual({ profily: 1, odpadMm: 300, materialMm: 15000, odpadPct: 2 });
	});

	it('nulový materiál (všetko tyce=0) → odpadPct 0, žiadne delenie nulou', () => {
		const r = sumaOdpad([mk({ tyce: 0, odpadMm: 500 }), mk({ tyce: 0, odpadMm: 100 })]);
		expect(r).toEqual({ profily: 0, odpadMm: 0, materialMm: 0, odpadPct: 0 });
	});
});
