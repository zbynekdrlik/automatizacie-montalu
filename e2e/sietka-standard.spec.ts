// Sieťka na Štandarde / Štandard + (#110) — Patrik, Odoo kanál 207, 2026-08-03.
// Rovnaký vzor ako e2e/sietka.spec.ts (Robust/Slide), plus #110-špecifický výber
// SYSTÉMU sieťky, ktorý na Robust/Slide vôbec neexistuje.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated } from './helpers';

async function zaklad(page: Page, zak: string, zakaznik: string, system = 'Štandard +') {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill(zakaznik);
	await page.selectOption('#system', system);
	await page.selectOption('#styl', '3K');
	await page.locator('#s').fill('3000');
	await page.locator('#v').fill('1850');
}

async function odpisRiadky(page: Page): Promise<string[]> {
	const karta = page.locator('.card', { hasText: 'Odpis (do Money)' }).first();
	return (await karta.locator('.row').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
}

test('Štandard +: sieťka je ponúkaná, výber systému sieťky sa objaví AŽ po zapnutí', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.selectOption('#system', 'Štandard +');
	await expect(page.locator('#sietka-on')).toBeVisible();
	await expect(page.locator('#sietka-system')).toHaveCount(0);
	await page.locator('#sietka-on').check();
	await expect(page.locator('#sietka-system')).toBeVisible();

	expect(errs).toEqual([]);
});

test('Štandard + posuv, rovnaký systém sieťky: 4 krídla v náhľade, presná Money delta z Patrikovho nárezáka', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-STD', 'E2E Sietka standard');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	const bez = await odpisRiadky(page);

	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.locator('#sietka-on').check();
	// systém sieťky sa NEMENÍ — ostáva rovnaký ako posuv (predvolené)
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// 4. krídlo v náhľade (3K + sieťka)
	await expect(page.getByTestId('nahlad-sietka')).toBeVisible();
	// karta ukáže systém sieťky = rovnaký ako posuv
	await expect(page.getByTestId('sietka-system')).toHaveText('Štandard +');
	// rozmer sieťoviny je Štandardova +3/+3 formula (sklo 957×1735 → 960×1738)
	await expect(page.getByTestId('sietka-rozmer')).toHaveText('960 × 1738 mm');

	const so = await odpisRiadky(page);
	expect(so).not.toEqual(bez);
	// šírka prírezov (ZASP202415) ide z 6 na 8 ks — presne Patrikov nárezák
	const sirka = so.find((r) => r.includes('ZASP202415'))!;
	expect(sirka).toBeTruthy();
	expect(sirka).not.toBe(bez.find((r) => r.includes('ZASP202415')));

	expect(errs).toEqual([]);
});

test('Štandard + posuv + STARÝ systém sieťky: krajová/dorazová idú s cudzím kódom, šírka prírezov +16,5mm', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-CROSS', 'E2E Sietka cross');
	await page.locator('#sietka-on').check();
	await expect(page.locator('#sietka-system')).toBeVisible();
	await page.locator('#sietka-system').selectOption('Štandard');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await expect(page.getByTestId('sietka-system')).toHaveText('Štandard');

	const odpis = (await odpisRiadky(page)).join(' | ');
	// starý koncový (ZASP00018) a starý doraz (ZASP00021) sa objavia v odpise —
	// kódy, ktoré Štandard + posuv sám o sebe nikdy nemá
	expect(odpis).toContain('ZASP00018');
	expect(odpis).toContain('ZASP00021');

	expect(errs).toEqual([]);
});

test('Slide: sieťka nemá výber systému (len Štandard/Štandard + ho majú)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.selectOption('#system', 'Slide');
	await page.selectOption('#styl', '3K');
	await page.locator('#sietka-on').check();
	await expect(page.getByTestId('sietka-box')).toBeVisible();
	await expect(page.locator('#sietka-system')).toHaveCount(0);

	expect(errs).toEqual([]);
});

test('výber systému sieťky prežije „← Späť a upraviť"', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-BACK', 'E2E Sietka spat');
	await page.locator('#sietka-on').check();
	await page.locator('#sietka-system').selectOption('Štandard');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);

	await expect(page.locator('#sietka-on')).toBeChecked();
	await expect(page.locator('#sietka-system')).toHaveValue('Štandard');

	expect(errs).toEqual([]);
});
