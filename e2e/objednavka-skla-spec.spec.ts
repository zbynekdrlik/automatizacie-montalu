// #521/#546: objednávka skla — obsluha nastaví „Hrana" (jediné spec pole, ktoré výroba používa)
// na podklade a „Odoslať objednávku skla do Odoo" jej ukáže PAYLOAD (to, čo pôjde do Odoo) s
// edge_finish. #546 skryl ostatných 8 IZOS príplatkov z UI (výroba ich nechce) — test overuje, že
// „Hrana" ostáva funkčná A že skryté polia (napr. teplá hrana) v UI UŽ NIE SÚ. Zápisový tok (píše
// spec do objednavka_skla) → skipAkLive na ostrom nasadení preskočí. Zero-console.
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

test('podklad: nastav Hrana → Odoslať → payload obsahuje edge_finish; skryté polia nie sú v UI', async ({
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

	// otvor „Hrana skla (opracovanie)" na prvom riadku a nastav Hrana (jediné pole, ktoré ostalo)
	const specForm = page.locator('form[action="?/ulozitSpec"]').first();
	await page.locator('details').filter({ has: specForm }).locator('summary').first().click();
	// #546: skryté IZOS príplatky UŽ NIE SÚ v UI (výroba ich nechce)
	await expect(specForm.locator('input[name="spec_warm_edge"]')).toHaveCount(0);
	await expect(specForm.locator('input[name="spec_holes_qty"]')).toHaveCount(0);
	await expect(specForm.locator('input[name="spec_hst"]')).toHaveCount(0);
	// „Hrana" ostáva a funguje
	await specForm.locator('select[name="spec_edge_finish"]').selectOption('ksr');
	await specForm.getByRole('button', { name: 'Uložiť špecifikáciu' }).click();
	await waitHydrated(page);

	// odošli objednávku skla → náhľad payloadu (ODOO upload je v tomto prostredí vypnutý)
	await page.getByTestId('odoslat-odoo').click();
	await waitHydrated(page);

	const payload = page.getByTestId('glass-order-payload');
	await expect(payload).toBeVisible();
	// spec kľúč, ktorý obsluha zadala, je v payloade
	await expect(payload).toContainText('"edge_finish": "ksr"');
	// skryté (default) spec kľúče sa NEPOSIELAJÚ (payload byte-identický pre default riadok)
	await expect(payload).not.toContainText('"warm_edge"');
	await expect(payload).not.toContainText('"holes_qty"');
	// základné kľúče ostávajú
	await expect(payload).toContainText('"glass_type"');
	await expect(payload).toContainText('"width_mm"');

	expect(consoleMsgs).toEqual([]);
});
