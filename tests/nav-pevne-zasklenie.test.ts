// #592 (Odoo úloha 1220, Marek 29.9.; ROZHODNUTÉ owner 30.9. „1"): „Pevné zasklenie" je v
// hornej lište JEDEN obyčajný odkaz na /fix (žiadny dropdown) a výber režimu sú TRI veľké karty
// pod nadpisom stránky — Fix z appky / Fix z cadu / Zábradlia (CLIP) — rovnaké na /fix,
// /fix/cad aj /clip (aktuálna zvýraznená). Tento test stráži dáta kariet, aktívny stav lišty,
// render zdieľaného komponentu a b2b konzistenciu; UI tok (klik v lište → karty → navigácia,
// zero console) pokrýva e2e/pevne-zasklenie-nav.spec.ts.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from 'svelte/server';
import {
	PEVNE_ZASKLENIE_NAV,
	PEVNE_ZASKLENIE_KARTY,
	jePevneZasklenie
} from '../src/lib/nav-pevne-zasklenie';
import PevneZasklenieKarty from '../src/lib/components/PevneZasklenieKarty.svelte';
import { b2bRedirectTarget } from '../src/lib/server/b2b-access';

const citaj = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), 'utf8');
const LAYOUT = citaj('src/routes/+layout.svelte');

describe('#592: „Pevné zasklenie" — dáta kariet a lišty', () => {
	it('tri karty v poradí zo zadania: Fix z appky, Fix z cadu, Zábradlia (CLIP)', () => {
		expect(PEVNE_ZASKLENIE_KARTY.map((k) => [k.href, k.nadpis])).toEqual([
			['/fix', 'Fix z appky'],
			['/fix/cad', 'Fix z cadu'],
			['/clip', 'Zábradlia (CLIP)']
		]);
	});

	it('štítky kariet: „z rozmerov", „CAD → Money", „zábradlie → Money"', () => {
		expect(PEVNE_ZASKLENIE_KARTY.map((k) => k.stitok)).toEqual([
			'z rozmerov',
			'CAD → Money',
			'zábradlie → Money'
		]);
	});

	it('lišta: jeden odkaz „Pevné zasklenie" na prvú kartu (/fix)', () => {
		expect(PEVNE_ZASKLENIE_NAV).toEqual({ href: '/fix', label: 'Pevné zasklenie' });
		expect(PEVNE_ZASKLENIE_NAV.href).toBe(PEVNE_ZASKLENIE_KARTY[0].href);
	});

	it.each(['/fix', '/fix/cad', '/clip', '/fix/nieco-dalsie', '/clip/detail'])(
		'odkaz je aktívny na %s (celá vetva /fix* a /clip*)',
		(p) => {
			expect(jePevneZasklenie(p)).toBe(true);
		}
	);

	it.each(['/zasklenia', '/pergola', '/pergola/fix', '/fixy', '/clipboard', '/', '/sietka'])(
		'odkaz NIE je aktívny na %s (žiadny falošný prefix match)',
		(p) => {
			expect(jePevneZasklenie(p)).toBe(false);
		}
	);

	// b2b konzistencia: b2b vetva lišty odkaz nemá a b2b sa na žiadnu z troch stránok nedostane
	// (hooks presmeruje) — teda nevidí ani jednu kartu. Platí LEN kým sú všetky tri routy pre b2b
	// zakázané; ak by niekto niektorú sprístupnil, tento test ho prinúti vedome doplniť
	// filtrovanie kariet aj lišty (fail-closed drift guard).
	it.each(PEVNE_ZASKLENIE_KARTY.map((k) => k.href))(
		'%s je pre b2b zakázané (b2b nevidí odkaz ani karty — musí to ostať konzistentné)',
		(href) => {
			expect(b2bRedirectTarget(href)).toBe('/zasklenia');
		}
	);
});

describe('#592: horná lišta — žiadny dropdown „Pevné zasklenie"', () => {
	it('layout nemá vnorený dropdown ani mobilnú podsekciu a používa jeden odkaz', () => {
		expect(LAYOUT).not.toMatch(/pevne-menu-toggle/);
		expect(LAYOUT).not.toMatch(/nav-pevne/);
		expect(LAYOUT).not.toMatch(/nav-subgroup/);
		expect(LAYOUT).not.toMatch(/pevneEl/);
		expect(LAYOUT).toMatch(/PEVNE_ZASKLENIE_NAV/);
		expect(LAYOUT).not.toMatch(/label: 'Fixy'/);
		expect(LAYOUT).not.toMatch(/label: 'Clip'/);
	});

	it('mŕtve CSS dropdownu/podsekcie je preč z app.css', () => {
		const css = citaj('src/app.css');
		expect(css).not.toMatch(/nav-subgroup/);
		expect(css).not.toMatch(/nav-pevne/);
	});

	it('nav <details> v layoute nepoužívajú bind:open (#583 — hydratácia prepíše stav)', () => {
		// atribút `bind:open={…}` aj skratka `<details bind:open>`, nie zmienka v komentári
		// (#583 komentár ju cituje v backtickoch)
		expect(LAYOUT).not.toMatch(/bind:open(?!`)(\s*=|[\s/>])/);
	});
});

describe('#592: PevneZasklenieKarty — tri karty, aktuálna zvýraznená', () => {
	const html = (aktivna: (typeof PEVNE_ZASKLENIE_KARTY)[number]['href']) =>
		render(PevneZasklenieKarty, { props: { aktivna } }).body;

	it.each(PEVNE_ZASKLENIE_KARTY.map((k) => k.href))('na %s: 3 karty, aktuálna nie je odkaz', (a) => {
		const h = html(a);
		const karty = [...h.matchAll(/<(a|div)\b[^>]*class="mode-card[^"]*"[^>]*>/g)].map((m) => m[0]);
		expect(karty).toHaveLength(3);
		const aktivne = karty.filter((k) => /class="mode-card active"/.test(k));
		expect(aktivne).toHaveLength(1);
		expect(aktivne[0]).toMatch(/^<div/);
		// ostatné dve sú odkazy na zvyšné stránky
		const odkazy = karty
			.filter((k) => k.startsWith('<a'))
			.map((k) => k.match(/href="([^"]+)"/)?.[1]);
		expect(odkazy).toEqual(PEVNE_ZASKLENIE_KARTY.map((k) => k.href).filter((x) => x !== a));
		expect(h.match(/Otvoriť →/g)).toHaveLength(2);
		expect(h.match(/tu si/g)).toHaveLength(1);
	});

	it('grid má 3 stĺpce s vlastným zlomom pod 900px (modifikátor, nie cols-2)', () => {
		const h = html('/fix');
		expect(h).toMatch(/class="mode-grid pevne-karty"/);
		expect(h).not.toMatch(/cols-2/);
		const css = citaj('src/app.css');
		expect(css).toMatch(/@media \(max-width: 900px\)\s*\{\s*\.mode-grid\.pevne-karty/);
	});

	it.each([
		['src/routes/fix/+page.svelte', '/fix'],
		['src/routes/fix/cad/+page.svelte', '/fix/cad'],
		['src/routes/clip/+page.svelte', '/clip']
	])('%s zobrazuje zdieľané karty s aktívnou %s', (subor, aktivna) => {
		const src = citaj(subor);
		expect(src).toContain(`<PevneZasklenieKarty aktivna="${aktivna}" />`);
		expect(src).not.toMatch(/FixModeNav/);
	});

	it('starý 2-kartový FixModeNav je odstránený (mŕtvy kód)', () => {
		expect(fs.existsSync(path.resolve(process.cwd(), 'src/lib/components/FixModeNav.svelte'))).toBe(
			false
		);
	});
});
