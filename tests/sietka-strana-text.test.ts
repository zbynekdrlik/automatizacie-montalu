// #583 (dodatok): hint sieťky vo formulári zasklení skloňoval stranu zle —
// „Sieťka pôjde na ľavá stranu" (nominatív). Správne je akuzatív „na ľavú / pravú stranu".
// Hodnoty `sietkaStrana` ('ľavá'/'pravá') sú IDENTIFIKÁTORY (kovanieSkryte, server) —
// menia sa len v zobrazenom texte.
import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import SietkaPolia from '../src/lib/components/SietkaPolia.svelte';

function hint(strana: 'ľavá' | 'pravá'): string {
	const html = render(SietkaPolia, { props: { on: true, strana } }).body;
	const m = html.match(/data-testid="sietka-strana"[^>]*>([\s\S]*?)<\/p>/);
	if (!m) throw new Error('hint sieťky sa nevykreslil');
	return m[1]!
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

describe('SietkaPolia — hint strany sieťky v akuzatíve', () => {
	it('ľavá → „na ľavú stranu"', () => {
		expect(hint('ľavá')).toBe('Sieťka pôjde na ľavú stranu (podľa smeru posuvu).');
	});
	it('pravá → „na pravú stranu"', () => {
		expect(hint('pravá')).toBe('Sieťka pôjde na pravú stranu (podľa smeru posuvu).');
	});
});
