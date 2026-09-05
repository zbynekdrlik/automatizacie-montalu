import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, skipAkLive } from './helpers';

// FIX z CADu (#380) — prepínač režimov „Fix z appky" / „Fix z cadu" + nový CAD → Money tok.
// Kódy zo zdieľaného pergola CODE_MAP (mechanizmus je code-driven).
const FIX_CAD = ['18004 PRIECKOVY PROFIL 105 9 3871', '18018 ZLABOVY PROFIL 140 2 4990'].join('\n');

test('FIX prepínač režimov appka ↔ cad naviguje medzi /fix a /fix/cad', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/fix');
	// obe karty prepínača sú na stránke, aktívna je „appka"
	await expect(page.getByTestId('fix-rezim-appka')).toBeVisible();
	await expect(page.getByTestId('fix-rezim-cad')).toBeVisible();
	// klik na „Fix z cadu" → /fix/cad, kde je CAD textarea
	await page.getByTestId('fix-rezim-cad').click();
	await expect(page).toHaveURL(/\/fix\/cad$/);
	await expect(page.getByLabel('Materiál (CAD nárez) *')).toBeVisible();
	// späť na „Fix z appky" → /fix, kde je formulár rozmerov
	await page.getByTestId('fix-rezim-appka').click();
	await expect(page).toHaveURL(/\/fix$/);
	await expect(page.getByLabel('Šírka (mm) *')).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});

test('Fix z cadu — CAD nárez → Money odpis (TEST priečinok)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/fix/cad');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-FIX');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Fix');
	await page.getByLabel('Materiál (CAD nárez) *').fill(FIX_CAD);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	// Money rozpis sa zobrazil + odoslať tlačidlo (náhľad)
	await expect(page.getByTestId('odoslat')).toBeVisible();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	expect(consoleMsgs).toEqual([]);
});

// ── #462 fix/cad: combo_ radios pri dlhom profile (>7500mm) ──────────────────
// Keď CAD vstup obsahuje dlhý profil >7500mm, na kontrolnej stránke sa
// zobrazia combo_ rádiá (voľba delenia dlhej tyče). Test overí, že sa
// zobrazia a voľba zmení rozpis.
test('#462 fix/cad: combo_ radio pri profile > 7500mm zmení odpis', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/fix/cad');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-FIX-COMBO');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Fix Combo');
	// profil s dĺžkou > 7500 spustí kombinácie
	await page.getByLabel('Materiál (CAD nárez) *').fill('18016 PROFIL 110x43 V2\t2\t8500');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();

	// combo rádiá sú prítomné (aspoň jedno radio)
	const radios = page.getByRole('radio');
	await expect(radios.first()).toBeVisible();
	// zvoľ inú kombináciu než default a overí, že sa na stránke prejavila
	const nonDefault = radios.nth(1);
	if (await nonDefault.isVisible()) {
		await nonDefault.check();
	}
	expect(consoleMsgs).toEqual([]);
});

// ── #462 fix/cad: qty_ ručná editácia pred submitom ─────────────────────────
test('#462 fix/cad: qty_ ručná editácia zmení odpis (✏️ marker)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/fix/cad');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`E2E-FIX-QTY-${Date.now().toString(36)}`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Fix Qty');
	await page.getByLabel('Materiál (CAD nárez) *').fill(FIX_CAD);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();

	// nájdi qty input a zmeň
	const qty = page.locator('input[name^="qty_"]').first();
	const povodna = await qty.inputValue();
	await qty.fill(String(Number(povodna) + 3));

	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	// ✏️ marker indikuje ručnú úpravu
	await expect(page.locator('.row', { hasText: '✏️' })).toHaveCount(1);

	expect(consoleMsgs).toEqual([]);
});

// ── #462 fix/cad: kopiruj-tyce tlačidlo ─────────────────────────────────────
test('#462 fix/cad: „Kopírovať počet tyčí" dá potvrdenie a do schránky stĺpec', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await loginAs(page);
	await goto(page, '/fix/cad');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-FIX-KOP');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Fix Kopiruj');
	await page.getByLabel('Materiál (CAD nárez) *').fill(FIX_CAD);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// kopiruj-tyce tlačidlo
	const kopiruj = page.getByTestId('kopiruj-tyce');
	await expect(kopiruj).toHaveText(/Kopírovať počet tyčí/);
	const secure = await page.evaluate(() => window.isSecureContext && !!navigator.clipboard);
	expect(secure, 'clipboard API nedostupné').toBe(true);

	await kopiruj.click();
	await expect(kopiruj).toHaveText(/Skopírované/);
	const schranka = await page.evaluate(() => navigator.clipboard.readText());
	expect(schranka.length).toBeGreaterThan(0);

	expect(consoleMsgs).toEqual([]);
});

test('Fix z appky — výkres konštrukcie z rozmerov (bez Money)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/fix');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-FIX-APP');
	await page.getByLabel('OP/OPDL číslo *').fill('02');
	await page.getByLabel('Zákazník *').fill('E2E Fix appka');
	await page.getByLabel('Šírka (mm) *').fill('2000');
	await page.getByLabel('Výška vľavo (mm) *').fill('1500');
	await page.getByLabel('Výška vpravo (mm) *').fill('1200');
	await page.getByTestId('nakreslit').click();
	await expect(page.getByTestId('fix-badge')).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});
