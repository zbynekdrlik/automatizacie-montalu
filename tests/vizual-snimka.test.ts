// Zákaznícky 3D náhľad (#170) — unit test `supersampleFaktor` (§2.10, čistá
// funkcia bez DOM/WebGL).
import { describe, expect, it } from 'vitest';
import { supersampleFaktor } from '../src/lib/vizual/snimka';

describe('supersampleFaktor', () => {
	it('oba limity >= 4800 → 2×', () => {
		expect(supersampleFaktor(8192, 8192)).toBe(2);
		expect(supersampleFaktor(4800, 4800)).toBe(2);
	});

	it('ktorýkoľvek limit < 4800 → 1× (min() rozhoduje)', () => {
		expect(supersampleFaktor(4096, 8192)).toBe(1);
		expect(supersampleFaktor(8192, 4096)).toBe(1);
		expect(supersampleFaktor(4799, 4799)).toBe(1);
	});
});
