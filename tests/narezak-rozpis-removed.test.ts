// #511: rozpis materiálu (s cenami) prestal ísť na kiosk ako `narezak`; kiosk dostáva
// skutočný plán rezov po ULOŽENÍ plánu. Behaviorálny/source guard — kontroluje ZAPOJENIE
// (ktorá cesta strieľa upload), nie glyfy v PDF (tie pokrýva plan-rezov-pdf.test.ts).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('#511 rozpis→kiosk odpojený, plán-rezov→kiosk zapojený', () => {
	it('odpis hook UŽ NENAHRÁVA rozpis ako narezak (queueNarezakUpload odstránené)', () => {
		const hooks = read('../src/hooks.server.ts');
		expect(hooks).not.toMatch(/queueNarezakUpload/);
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
