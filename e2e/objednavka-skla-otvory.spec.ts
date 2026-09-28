// #578 (Marek Drlík, Odoo úloha 1185): objednávka skla rozlišuje tabule S OTVOROM a BEZ.
// Deluxe má zámkový otvor ⌀46 na krajných sklách — výkres ich kreslí, a ten istý počet tabúľ
// ide na podklad objednávky skla ako samostatný riadok „— s otvorom ⌀46"; zvyšok bez otvoru.
// Asserty sú RELAČNÉ: počet tabúľ s otvorom = počet otvorov vo výkrese, súčet kusov = kusy
// skla z nárezáku, rozmer = rozmer skla z nárezáku (žiadne pevné literály výsledku).
//
// Zápisový tok (objednavka_skla, Money-NEUTRÁLNE) — `skipAkLive` na ostrom nasadení preskočí.
import { test, expect } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	skipAkLive,
	vyberFarbuKovania
} from './helpers';

const RUN = `E2E-OTV-${Date.now().toString(36).slice(-5)}`;

test('Deluxe: tabule s otvorom ⌀46 idú na podklad ako samostatný riadok (počet = výkres)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);

	const zak = `${RUN}-DLX`;
	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Otvory v skle');
	await page.getByLabel('Systém').selectOption('Deluxe');
	await page.getByLabel('Štýl').selectOption('4K');
	await page.getByLabel('Šírka (mm) *').fill('4000');
	await page.getByLabel('Výška (mm) *').fill('2000');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Float kalené 10 mm');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	// výsledok nárezáku: kusy skla, rozmer a počet otvorov vo výkrese
	const skloKarta = page.locator('.card', { has: page.getByTestId('sklo-rozmer') });
	const kusyText = await skloKarta.locator('div:has(> span:text-is("Počet")) > b').innerText();
	const kusy = Number(kusyText.replace(/\D/g, ''));
	const sirka = (await page.getByTestId('sklo-sirka').innerText()).replace(/\D/g, '');
	const vyska = (await page.getByTestId('sklo-vyska').innerText()).replace(/\D/g, '');
	const otvory = await page.getByTestId('nahlad-2d').locator('circle[stroke-dasharray]').count();
	expect(otvory).toBeGreaterThan(0);
	expect(kusy).toBeGreaterThan(otvory);

	await page.getByTestId('pridat-skla').click();
	await waitHydrated(page);
	await expect(page.getByTestId('skla-pridane')).toBeVisible();
	await page.getByTestId('skla-pridane-odkaz').click();
	await page.waitForURL(/\/objednavka-skla\//);
	await waitHydrated(page);

	const riadky = page.locator('tbody tr');
	await expect(riadky).toHaveCount(2);
	const sOtvorom = riadky.filter({ hasText: 'Zasklenie 1 — s otvorom ⌀46' });
	const bez = riadky.filter({ has: page.locator('td', { hasText: /^Zasklenie 1$/ }) });
	await expect(sOtvorom).toHaveCount(1);
	await expect(bez).toHaveCount(1);
	// počet tabúľ s otvorom = počet otvorov vo výkrese; zvyšok bez otvoru
	await expect(sOtvorom.locator('td').nth(3)).toHaveText(String(otvory));
	await expect(bez.locator('td').nth(3)).toHaveText(String(kusy - otvory));
	// oba riadky = to isté sklo z nárezáku
	for (const r of [sOtvorom, bez]) {
		await expect(r.locator('td').nth(1)).toContainText(sirka);
		await expect(r.locator('td').nth(1)).toContainText(vyska);
	}

	expect(consoleMsgs).toEqual([]);
});
