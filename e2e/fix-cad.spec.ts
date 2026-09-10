import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, skipAkLive } from './helpers';

// FIX z CADu (#380) — prepínač režimov „Fix z appky" / „Fix z cadu" + CAD → Money tok.
// #500 round 2 (2026-09-10): FIX CAD kódy (16xxx) sa mapujú na Money ZASP skladové
// karty cez pole „Dominikov kód" (`fix-catalog.ts`) — NIE priamo ako Money kódy
// (round 1 defekt). Všetky potvrdené karty majú `bar_mm: 7500` (Dominik msg 1818224),
// takže „Odpis pozastavený" honest-null blok je preč a odoslat prechádza rovnako ako
// na /pergola — ten istý zdieľaný `cad-odpis.ts` tok (`e2e/parita.spec.ts`).
const FIX_CAD = [
	'16101 RAMOVY PROFIL 1 109.80',
	'16101 RAMOVY PROFIL 1 301.00',
	'16101 RAMOVY PROFIL 1 2072.48',
	'16101 RAMOVY PROFIL 1 2060.00',
	'16104 ZASKLIEVACI PROFIL 36mm 2 212.00'
].join('\n');

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

test('Fix z cadu — CAD nárez dá Money rozpis (16xxx→ZASP) a odoslanie do Money prejde (#500 round 2)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/fix/cad');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-FIX');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Fix');
	await page.getByLabel('Materiál (CAD nárez) *').fill(FIX_CAD);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();

	// Money rozpis sa zobrazil s resolvnutými ZASP kódmi (CAD 16xxx → Money cez Dominikov kód)
	await expect(page.getByTestId('odoslat')).toBeVisible();
	await expect(page.getByLabel('Množstvo ZASP00116')).toBeVisible();
	await expect(page.getByLabel('Množstvo ZASP202413')).toBeVisible();

	// odoslanie PREJDE (bar_mm=7500 potvrdené) → hotovo krok, rovnaký tok ako /pergola
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.getByTestId('kopiruj-tyce')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

test('Fix z cadu — nenamapovaný CAD kód → „Nenamapované CAD kódy" chyba, žiadny rozpis', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/fix/cad');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-FIX-BAD');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Fix Bad');
	await page.getByLabel('Materiál (CAD nárez) *').fill('99999 NEEXISTUJE 1 1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();

	await expect(page.getByTestId('form-error')).toContainText('Nenamapované CAD kódy');
	await expect(page.getByTestId('form-error')).toContainText('99999');
	await expect(page.getByTestId('odoslat')).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});

// ── #462 fix/cad: qty_ ručná editácia prežije cez ÚSPEŠNÉ odoslanie (#500 round 2) ──
// Round 1 malo odoslat trvalo blokované (bar_mm honest-null), takže sa dala overiť len
// echo-hodnota na náhľade. Round 2 (bar_mm=7500 potvrdené) odoslat prechádza — tok teraz
// mirroruje /clip (`e2e/clip.spec.ts`) a /pergola (`e2e/parita.spec.ts`): ručne upravené
// qty_ pred odoslaním sa premietne do odpisu a je označené ✏️ v „hotovo" kroku.
test('#462 fix/cad: qty_ ručná úprava pred odoslaním sa premietne do odpisu (✏️)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/fix/cad');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`E2E-FIX-QTY-${Date.now().toString(36)}`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Fix Qty');
	await page.getByLabel('Materiál (CAD nárez) *').fill(FIX_CAD);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();

	const qtyInput = page.locator('input[name="qty_ZASP00116"]');
	const povodna = await qtyInput.inputValue();
	const nova = String(Number(povodna) + 3);
	await qtyInput.fill(nova);
	await expect(qtyInput).toHaveValue(nova);

	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.locator('.row', { hasText: 'ZASP00116' })).toContainText('✏️');

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
