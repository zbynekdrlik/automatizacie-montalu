// Zákaznícky 3D náhľad (#170) — unit test `supersampleFaktor` (§2.10, čistá
// funkcia bez DOM/WebGL).
import { describe, expect, it } from 'vitest';
import { jeSoftverovyRenderer, supersampleFaktor } from '../src/lib/vizual/snimka';

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

describe('jeSoftverovyRenderer (#290)', () => {
	it('známe softvérové renderery → true (SwiftShader/llvmpipe/Microsoft/Software)', () => {
		expect(
			jeSoftverovyRenderer(
				'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'
			)
		).toBe(true);
		expect(jeSoftverovyRenderer('Google SwiftShader')).toBe(true);
		expect(jeSoftverovyRenderer('llvmpipe (LLVM 15.0.0, 256 bits)')).toBe(true);
		expect(jeSoftverovyRenderer('Microsoft Basic Render Driver')).toBe(true);
		expect(jeSoftverovyRenderer('Mesa OffScreen Software Rasterizer')).toBe(true);
	});

	it('prázdny / medzerový reťazec (debug info nedostupné, privacy) → true (fail-safe)', () => {
		expect(jeSoftverovyRenderer('')).toBe(true);
		expect(jeSoftverovyRenderer('   ')).toBe(true);
	});

	it('reálne hardvérové GPU → false (3× zostáva dostupné)', () => {
		expect(
			jeSoftverovyRenderer(
				'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)'
			)
		).toBe(false);
		expect(jeSoftverovyRenderer('Apple M2')).toBe(false);
		expect(jeSoftverovyRenderer('AMD Radeon Pro 5500M OpenGL Engine')).toBe(false);
		expect(jeSoftverovyRenderer('Intel(R) Iris(R) Xe Graphics')).toBe(false);
	});
});
