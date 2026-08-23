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
