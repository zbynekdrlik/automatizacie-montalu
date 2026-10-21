// #444 — vysvetľujúce „prečo sa to robí" texty pri nastaveniach (Špetta, Odoo msg 1789036).
// Content guard (text sa nedá omylom vyprázdniť/skomoliť bez RED testu) + „žiadne siroty"
// guard (každý POZNAMKY kľúč MUSÍ byť reálne renderovaný v `nastavenia/+page.svelte` —
// vzor Money-safety source-text guardov, `dopyt-money-safety.test.ts`).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { POZNAMKY } from '../src/lib/nastavenia-poznamky';

describe('#444 POZNAMKY — vysvetľujúce texty pri nastaveniach', () => {
	it('korekcia obsahuje overený dôvod (podložky) — content guard proti tichému vyprázdneniu', () => {
		expect(POZNAMKY.korekcia).toContain('podložk');
	});

	// #616 (Odoo úloha 1450): overený zdroj ostáva povinný, ale patrí do KOMENTÁRA pri kľúči —
	// text číta dielňa a nesmie menovať ľudí ani Odoo msg id (Stryker komentáre zachováva).
	it('korekcia má overený zdroj (Odoo msg id) v komentári modulu, nie v texte pre dielňu', () => {
		const zdroj = fs.readFileSync(
			new URL('../src/lib/nastavenia-poznamky.ts', import.meta.url),
			'utf8'
		);
		expect(zdroj).toMatch(/\/\/ Zdroj: .*msg\s*17894\d\d/);
		expect(POZNAMKY.korekcia).not.toMatch(/msg|Patrik|Špett/);
		expect(POZNAMKY.korekcia).toContain('neudržateľná');
	});

	it('redukcia obsahuje overený dôvod (16mm/6mm rezanie, len Slide)', () => {
		expect(POZNAMKY.redukcia).toContain('16 mm');
		expect(POZNAMKY.redukcia).toContain('Slide');
	});

	it('žiadny text nie je prázdny/whitespace (honest-null pre prózu — radšej žiadny kľúč než prázdny)', () => {
		for (const [key, text] of Object.entries(POZNAMKY)) {
			expect(text.trim().length, key).toBeGreaterThan(20);
		}
	});

	it('každý kľúč POZNAMKY je referencovaný v nastavenia/+page.svelte (žiadne siroty po refaktore)', () => {
		const svelte = fs.readFileSync(
			new URL('../src/routes/zasklenia/nastavenia/+page.svelte', import.meta.url),
			'utf8'
		);
		expect(svelte).toContain("import { POZNAMKY } from '$lib/nastavenia-poznamky'");
		expect(svelte).toContain('class="pozn"');
		for (const key of Object.keys(POZNAMKY)) {
			expect(svelte, key).toContain(`POZNAMKY.${key}`);
		}
	});
});
