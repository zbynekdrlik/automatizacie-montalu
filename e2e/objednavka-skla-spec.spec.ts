// #521: objednávka skla — obsluha nastaví voliteľnú špecifikáciu tabule (teplá hrana, otvory,
// hrana) na podklade a „Odoslať objednávku skla do Odoo" jej ukáže PAYLOAD (to, čo pôjde do Odoo)
// so spec kľúčmi. Zápisový tok (píše spec do objednavka_skla) → skipAkLive na ostrom nasadení
// preskočí. Zero-console.
import { test, expect } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	skipAkLive,
	vyberFarbuKovania
} from './helpers';

const RUN = `E2E-SKLASPEC-${Date.now().toString(36).slice(-5)}`;

test('podklad: nastav špecifikáciu tabule → Odoslať → payload obsahuje spec kľúče', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);
	await goto(page, '/zasklenia');

	const zak = `${RUN}-01`;
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Spec skla');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2200');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await page.getByTestId('pridat-skla').click();
	await waitHydrated(page);
	await expect(page.getByTestId('skla-pridane')).toBeVisible();
	await page.getByTestId('skla-pridane-odkaz').click();
	await page.waitForURL(/\/objednavka-skla\//);
	await waitHydrated(page);

	await expect(page.getByRole('heading', { name: `Objednávka skla — ${zak}` })).toBeVisible();

	// otvor „Ďalšie možnosti (zriedkavé)" na prvom riadku a nastav spec
	const specForm = page.locator('form[action="?/ulozitSpec"]').first();
	await page.locator('details').filter({ has: specForm }).locator('summary').first().click();
	await specForm.locator('input[name="spec_warm_edge"]').check();
	await specForm.locator('input[name="spec_holes_qty"]').fill('2');
	await specForm.locator('select[name="spec_edge_finish"]').selectOption('ksr');
	await specForm.getByRole('button', { name: 'Uložiť špecifikáciu' }).click();
	await waitHydrated(page);

	// odošli objednávku skla → náhľad payloadu (ODOO upload je v tomto prostredí vypnutý)
	await page.getByTestId('odoslat-odoo').click();
	await waitHydrated(page);

	const payload = page.getByTestId('glass-order-payload');
	await expect(payload).toBeVisible();
	// spec kľúče, ktoré obsluha zadala, sú v payloade
	await expect(payload).toContainText('"warm_edge": true');
	await expect(payload).toContainText('"holes_qty": 2');
	await expect(payload).toContainText('"hole_size": "d30"');
	await expect(payload).toContainText('"edge_finish": "ksr"');
	// základné kľúče ostávajú
	await expect(payload).toContainText('"glass_type"');
	await expect(payload).toContainText('"width_mm"');

	expect(consoleMsgs).toEqual([]);
});
