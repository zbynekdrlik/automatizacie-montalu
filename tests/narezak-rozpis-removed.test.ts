// #511: rozpis materiálu (s cenami) prestal ísť na kiosk ako `narezak`; kiosk dostáva
// skutočný plán rezov po ULOŽENÍ plánu. Behaviorálny/source guard — kontroluje ZAPOJENIE
// (ktorá cesta strieľa upload), nie glyfy v PDF (tie pokrýva narezak-pdf.test.ts).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('#511 rozpis→kiosk odpojený, plán-rezov→kiosk zapojený', () => {
	it('odpis hook NENAHRÁVA cenový rozpis ako narezak (starý queueNarezakUpload( odstránený)', () => {
		const hooks = read('../src/hooks.server.ts');
		expect(hooks).not.toMatch(/queueNarezakUpload\(/);
	});

	// #570: #511 odstránil JEDINÝ automatický trigger nárezáku a /plan-rezov save výroba nepoužíva →
	// tablety „Čo rezať" prázdne. Odpis hook znova posiela nárezák, ale BEZ CIEN — zo zdieľaného jadra
	// backfillu (rozpis rezov lines + grafický PDF + cut_plan), nie cenový rozpis materiálu.
	it('#570: odpis hook posiela cenovo-neutrálny nárezák z jadra backfillu', () => {
		const hooks = read('../src/hooks.server.ts');
		expect(hooks).toMatch(/queueNarezakUploadZOdpisu\(/);
		const mod = read('../src/lib/server/odoo-narezak-odpis.ts');
		expect(mod).toMatch(/from '\.\/backfill-narezaky'/);
		expect(mod).not.toMatch(/from ['"]\.\/(ceny|odoo-zakazka|zakazka-ceny|zakazka-pdf)['"]/);
		expect(mod).not.toMatch(/fmtEur|predajVo|cenaSpolu|enrichPolozky|€/);
		expect(mod).not.toMatch(/writeOdpis\s*\(/);
	});

	it('interná mt_note s rozpisom (queueZakazkaPush) na odpis OSTÁVA (leak-kontrakt nedotknutý)', () => {
		const hooks = read('../src/hooks.server.ts');
		expect(hooks).toMatch(/queueZakazkaPush/);
	});

	it('mŕtvy rozpis-narezak modul je zmazaný', () => {
		let exists = true;
		try {
			read('../src/lib/server/odoo-narezak-upload.ts');
		} catch {
			exists = false;
		}
		expect(exists).toBe(false);
	});

	it('plán-rezov upload je zapojený v `ulozit` akcii /plan-rezov', () => {
		const action = read('../src/routes/plan-rezov/+page.server.ts');
		expect(action).toMatch(/queuePlanRezovUpload/);
	});
});
