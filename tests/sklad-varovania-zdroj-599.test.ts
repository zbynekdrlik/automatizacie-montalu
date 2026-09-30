// #599 krok 3: `SkladVarovania` ukazuje, ODKIAĽ je číslo skladu — Odoo (`stock.quant`, aktuálny
// stav) alebo denný Money snapshot (s dátumom); pri zmiešaných zdrojoch hlavička povie, že platí
// nižší. SSR render komponentu (vzor `tests/sklo-otvory-578.test.ts`), E2E pokrýva CI vetvu bez Odoo.
import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import SkladVarovania from '../src/lib/components/SkladVarovania.svelte';
import type { SkladVarovanie } from '../src/lib/server/ceny';

const v = (kod: string, zdroj: SkladVarovanie['zdroj']): SkladVarovanie => ({
	kod,
	nazov: `Položka ${kod}`,
	sklad: 1,
	mnozstvo: 5,
	zdroj
});
const html = (varovania: SkladVarovanie[]) =>
	render(SkladVarovania, {
		props: { varovania, snapshotDatum: '2026-09-30T05:30:00Z' }
	}).body;
const hlavicka = (h: string) =>
	h.match(/data-testid="sklad-varovania-zdroj"[^>]*>([^<]*)</)?.[1] ?? '';

describe('#599 SkladVarovania — zdroj skladu', () => {
	it('len Odoo → „Odoo, aktuálny stav", položka označená Odoo', () => {
		const h = html([v('ZASP00024', 'odoo')]);
		expect(hlavicka(h)).toBe('(sklad: Odoo, aktuálny stav)');
		expect(h).toMatch(/data-testid="sklad-varovania-ZASP00024-zdroj"[^>]*>Odoo</);
	});

	it('len snapshot → Money snapshot s dátumom', () => {
		const h = html([v('ZASP00024', 'snapshot')]);
		expect(hlavicka(h)).toBe('(sklad: Money snapshot k 30.9.2026)');
		expect(h).toMatch(/data-testid="sklad-varovania-ZASP00024-zdroj"[^>]*>Money</);
	});

	it('zmiešané zdroje → hlavička povie, že platí nižší', () => {
		const h = html([v('ZASP00024', 'odoo'), v('PRP20256', 'snapshot')]);
		expect(hlavicka(h)).toBe('(sklad: Odoo aj Money snapshot k 30.9.2026 — platí nižší)');
	});

	it('bez varovaní sa nič nerenderuje', () => {
		expect(html([])).not.toContain('sklad-varovania');
	});
});
