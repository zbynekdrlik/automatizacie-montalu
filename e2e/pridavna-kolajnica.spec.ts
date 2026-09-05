// #456 — checkbox „Prídavná koľajnica" — viditeľnosť per systém a efekt v Kontrole.
// Slide/Deluxe/Robust musia mať checkbox aj výmenu koľajnice v odpise.
import { test, expect } from '@playwright/test';
import { goto, loginAs, collectConsole, waitHydrated } from './helpers';

test('checkbox viditeľný pre Slide 2K, skrytý pre Slide 3K', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/zasklenia');
	await waitHydrated(page);

	await page.getByLabel('Systém').selectOption('Slide');
	await page.getByLabel('Štýl').selectOption('2K');
	const cb = page.locator('input[name="pridavnaKolajnica"]');
	await expect(cb).toBeVisible();
	// label hovorí "koľajnica" (nie "spodná koľajnica" — Slide má obvodovú)
	const labelLoc = page.locator('label', { hasText: 'koľajnica o veľkosť väčšia' });
	await expect(labelLoc).toBeVisible();
	// 🟡 review nález: substring-match by prešiel aj pre "spodná koľajnica" — falsifikovať
	await expect(labelLoc).not.toContainText('spodná');

	// 3K = max pre Slide → checkbox sa skryje
	await page.getByLabel('Štýl').selectOption('3K');
	await expect(cb).not.toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

test('checkbox viditeľný pre Robust 2K a 3K, skrytý pre 4K', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/zasklenia');
	await waitHydrated(page);

	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	const cb = page.locator('input[name="pridavnaKolajnica"]');
	await expect(cb).toBeVisible();

	await page.getByLabel('Štýl').selectOption('3K');
	await expect(cb).toBeVisible();

	// 4K = max pre Robust → checkbox sa skryje
	await page.getByLabel('Štýl').selectOption('4K');
	await expect(cb).not.toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

test('checkbox viditeľný pre Deluxe 2K, label hovorí "spodná koľajnica"', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/zasklenia');
	await waitHydrated(page);

	await page.getByLabel('Systém').selectOption('Deluxe');
	await page.getByLabel('Štýl').selectOption('2K');
	const cb = page.locator('input[name="pridavnaKolajnica"]');
	await expect(cb).toBeVisible();
	// Deluxe má hornú + spodnú → label hovorí "spodná koľajnica"
	await expect(page.getByText('spodná koľajnica o veľkosť väčšia')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

test('Slide 2K + pridavna ON → Kontrola ukazuje 3K koľajnicu (ZASP00100)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/zasklenia');
	await waitHydrated(page);

	await page.getByLabel('Systém').selectOption('Slide');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.locator('#s').fill('3000');
	await page.locator('#v').fill('2000');
	await page.locator('input[name="pridavnaKolajnica"]').check();
	// Slide vyžaduje RAL farbu kovania — vyber prvú dostupnú (unconditional, #456 review 🔵)
	const farbaOpts = page.locator('#farbaKovania option[value]:not([value=""])');
	await expect(farbaOpts.first()).toBeAttached();
	const farbaVal = await farbaOpts.first().getAttribute('value');
	await page.locator('#farbaKovania').selectOption(farbaVal!);
	await page.getByLabel('Číslo objednávky').fill('ZAK-TEST456');
	await page.getByLabel('OP/OPDL').fill('01');
	await page.getByLabel('Zákazník').fill('Test 456');
	await page.getByRole('button', { name: 'Spočítať' }).click();

	// Kontrola krok — odpis karta musí obsahovať ZASP00100 (3K Slide)
	// a NIE ZASP00097 (2K Slide)
	const odpisCard = page.locator('.card', { hasText: 'Odpis (do Money)' });
	await expect(odpisCard).toContainText('ZASP00100');
	await expect(odpisCard).not.toContainText('ZASP00097');

	expect(consoleMsgs).toEqual([]);
});
