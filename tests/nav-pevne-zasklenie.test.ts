// #592 (Odoo úloha 1220, Marek 29.9.): „Fixy" + „Clip" zjednotené v hornej lište pod JEDNU
// položku „Pevné zasklenie" s tromi voľbami. Tento test stráži dátovú časť (odkazy + aktívny
// stav) a b2b konzistenciu; UI tok (otvorenie dropdownu, navigácia, zero console) pokrýva
// e2e/pevne-zasklenie-nav.spec.ts.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PEVNE_ZASKLENIE_LINKS, jePevneZasklenie } from '../src/lib/nav-pevne-zasklenie';
import { b2bRedirectTarget } from '../src/lib/server/b2b-access';

const LAYOUT = fs.readFileSync(path.resolve(process.cwd(), 'src/routes/+layout.svelte'), 'utf8');

describe('#592: položka „Pevné zasklenie" v hornej lište', () => {
	it('má presne tri voľby v poradí zo zadania: Fix z appky, Fix z CADu, Zábradlia (CLIP)', () => {
		expect(PEVNE_ZASKLENIE_LINKS.map((l) => [l.href, l.label])).toEqual([
			['/fix', 'Fix z appky'],
			['/fix/cad', 'Fix z CADu'],
			['/clip', 'Zábradlia (CLIP)']
		]);
	});

	it.each(['/fix', '/fix/cad', '/clip', '/fix/nieco-dalsie'])(
		'je aktívna na %s (celá vetva /fix* a /clip)',
		(p) => {
			expect(jePevneZasklenie(p)).toBe(true);
		}
	);

	it.each(['/zasklenia', '/pergola', '/pergola/fix', '/fixy', '/clipboard', '/', '/sietka'])(
		'NIE je aktívna na %s (žiadny falošný prefix match)',
		(p) => {
			expect(jePevneZasklenie(p)).toBe(false);
		}
	);

	// b2b konzistencia: b2b vetva `moduleLinks` skupinu vôbec nerenderuje, čo je správne LEN
	// kým sú všetky tri routy pre b2b zakázané. Ak by niekto niektorú b2b sprístupnil, tento
	// test ho prinúti vedome doplniť filtrovanie dropdownu (fail-closed drift guard).
	it.each(PEVNE_ZASKLENIE_LINKS.map((l) => l.href))(
		'%s je pre b2b zakázané (b2b nevidí skupinu — musí to ostať konzistentné)',
		(href) => {
			expect(b2bRedirectTarget(href)).toBe('/zasklenia');
		}
	);

	it('layout už nemá samostatné položky „Fixy"/„Clip" a používa zdieľaný zoznam', () => {
		expect(LAYOUT).not.toMatch(/label: 'Fixy'/);
		expect(LAYOUT).not.toMatch(/label: 'Clip'/);
		expect(LAYOUT).toMatch(/PEVNE_ZASKLENIE_LINKS/);
		expect(LAYOUT).toMatch(/data-testid="pevne-menu-toggle"/);
	});

	it('nav <details> v layoute nepoužívajú bind:open (#583 — hydratácia prepíše stav)', () => {
		// atribút `bind:open={…}`, nie zmienka v komentári (#583 komentár ho cituje)
		expect(LAYOUT).not.toMatch(/bind:open\s*=/);
	});
});
