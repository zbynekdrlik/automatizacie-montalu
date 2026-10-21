// #616 (Odoo úloha 1450, príloha att 41003): úvod /sietka citoval človeka
// („(Patrik: „90% si kúpi posuv a sieťku chce až potom")"). Text pre dielňu nesmie menovať
// ľudí ani citovať — vecný obsah ostáva ako neutrálna veta. Plošnú stráž nad zdrojákom drží
// `tests/ui-texty-bez-mien.test.ts`; tento test overuje skutočne vykreslenú stránku v prehliadači.
import { test, expect } from '@playwright/test';
import { collectConsole, goto, loginAs } from './helpers';

test('#616 /sietka: úvod bez mena a citátu, s vecnou vetou o dodatočnej sieťke', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/sietka');

	const karta = page
		.locator('.card')
		.filter({ has: page.getByRole('heading', { name: 'Sieťka — dodatočná objednávka' }) });
	const uvod = karta.locator('p.sub').first();
	await expect(uvod).toContainText('už má posuv namontovaný');
	await expect(uvod).toContainText('Sieťka sa často objednáva až po montáži posuvu.');

	// celý viditeľný text stránky (bez <script>/<style>) — žiadne meno ani citát
	const text = await page.evaluate(() => {
		const klon = document.body.cloneNode(true) as HTMLElement;
		klon.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
		return klon.textContent ?? '';
	});
	expect(text.length).toBeGreaterThan(0);
	expect(text).not.toMatch(/Patrik|Dominik|Špett/);
	expect(text).not.toContain('90%');

	expect(consoleMsgs).toEqual([]);
});
