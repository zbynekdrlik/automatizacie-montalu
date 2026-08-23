// Zákaznícky 3D náhľad (#170) — unit test `supersampleFaktor` (§2.10, čistá
// funkcia bez DOM/WebGL).
import { describe, expect, it } from 'vitest';
import { supersampleFaktor } from '../src/lib/vizual/snimka';

describe('supersampleFaktor (#285: pridaný 3× pre ostrejší tlačový PNG)', () => {
	it('oba limity >= 7200 → 3× (7200 px = 3×2400 základnej šírky)', () => {
		expect(supersampleFaktor(16384, 16384)).toBe(3);
		expect(supersampleFaktor(8192, 8192)).toBe(3);
		expect(supersampleFaktor(7200, 7200)).toBe(3);
	});

	it('oba limity >= 4800 ale < 7200 → 2×', () => {
		expect(supersampleFaktor(4800, 4800)).toBe(2);
		expect(supersampleFaktor(7199, 7199)).toBe(2);
	});

	it('ktorýkoľvek limit < 4800 → 1× (min() rozhoduje — bezpečné pre mobil 4096)', () => {
		expect(supersampleFaktor(4096, 8192)).toBe(1);
		expect(supersampleFaktor(8192, 4096)).toBe(1);
		expect(supersampleFaktor(4799, 4799)).toBe(1);
	});

	it('min() rozhoduje aj pri 3× hranici (jeden limit pod 7200)', () => {
		expect(supersampleFaktor(16384, 7199)).toBe(2);
		expect(supersampleFaktor(7199, 16384)).toBe(2);
	});
});

// #290 (CI-fix PR #290, run 32661546086) — softvérové WebGL (SwiftShader na
// GitHub CI, llvmpipe, alebo CHÝBAJÚCA GPU identifikácia) hlási VEĽKÉ
// per-dimension limity (16384), ale má MALÝ CELKOVÝ alokačný rozpočet: 3×
// supersample (7200×4860 MSAA buffer) prekročí SwiftShader "Texture total
// allocation size is too large" → framebuffer incomplete → kaskáda GL
// warningov → E2E `expect(consoleMsgs).toEqual([])` padne. 2× (4800×3240) je
// DOKÁZANE bezpečné (main CI ho servoval). `softverovyRenderer` 3. parameter
// (fail-safe default false) stropuje ss na 2× pre softvér, hardvér drží 3×.
describe('supersampleFaktor — softvérový/neznámy renderer strop 2× (#290)', () => {
	it('softverovyRenderer=true → strop 2× aj pri per-dimension limitoch >= 7200', () => {
		expect(supersampleFaktor(16384, 16384, true)).toBe(2);
		expect(supersampleFaktor(8192, 8192, true)).toBe(2);
		expect(supersampleFaktor(7200, 7200, true)).toBe(2);
	});

	it('softvér pod 4800 stále padne na 1× (min() rozhoduje aj na softvéri)', () => {
		expect(supersampleFaktor(4096, 8192, true)).toBe(1);
		expect(supersampleFaktor(4799, 4799, true)).toBe(1);
	});

	it('hardvér (softverovyRenderer=false) drží 3× — #285 zámer nezmenený', () => {
		expect(supersampleFaktor(16384, 16384, false)).toBe(3);
	});
});
