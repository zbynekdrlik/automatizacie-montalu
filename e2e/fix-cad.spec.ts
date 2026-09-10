import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, skipAkLive } from './helpers';

// FIX z CADu (#380) — prepínač režimov „Fix z appky" / „Fix z cadu" + CAD → Money tok.
// #500 (2026-09-10): FIX CAD kódy sú PRIAMO Money kódy (16xxx/26xxx, `fix-catalog.ts`),
// BEZ mapovania cez pergola CODE_MAP (18xxx). Fixtúra nižšie preto používa REÁLNE FIX
// kódy (rovnaký tvar ako `tests/fix-cad.test.ts`), nie pergola 18xxx.
// Odoslanie do Money je zatiaľ TRVALO BLOKOVANÉ pre všetky FIX kódy (bar_mm — dĺžka tyče —
// nie je od dodávateľa potvrdená, honest-null) — „hotovo" krok (a teda aj ✏️ marker/
// kopiruj-tyce, ktoré sa renderujú LEN na ňom) je preto na /fix/cad momentálne
// nedosiahnuteľný; ten istý zdieľaný cad-odpis.ts tok JE plne overený na /pergola
// (`e2e/parita.spec.ts`, vrátane ✏️ markeru aj kopiruj-tyce tlačidla).
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

test('Fix z cadu — CAD nárez dá Money rozpis (16xxx), odoslať je blokované (bar_mm honest-null, #500)', async ({
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

	// Money rozpis sa zobrazil s resolvnutými FIX kódmi (priamy 16xxx match, bez CODE_MAP)
	await expect(page.getByTestId('odoslat')).toBeVisible();
	await expect(page.getByLabel('Množstvo 16101')).toBeVisible();
	await expect(page.getByLabel('Množstvo 16104')).toBeVisible();

	// odoslanie zostáva na náhľade s honest-null blok hláškou — do Money sa NIČ nezapíše
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('nahlad-error')).toContainText('Odpis pozastavený');
	await expect(page.getByTestId('nahlad-error')).toContainText('bar_mm');
	await expect(page.getByTestId('vysledok')).toHaveCount(0);

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

// ── #462 fix/cad: qty_ ručná editácia prežije aj cez blokovaný odoslat ──────
// Plný „upraviť → odoslať → ✏️ marker v hotovo" tok (ako predtým testovaný tu) sa dá
// overiť LEN na module, kde odoslat naozaj prejde — to je od #500 /pergola
// (`e2e/parita.spec.ts`). Tu overujeme, čo je na /fix/cad reálne dosiahnuteľné: ručne
// upravená hodnota sa echo-uje späť do poľa aj po (blokovanom) odoslaní.
test('#462 fix/cad: qty_ ručná úprava sa echo-uje späť aj pri blokovanom odoslaní', async ({
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

	const qty = page.locator('input[name^="qty_"]').first();
	const povodna = await qty.inputValue();
	const nova = String(Number(povodna) + 3);
	await qty.fill(nova);

	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('nahlad-error')).toContainText('Odpis pozastavený');
	await expect(page.locator('input[name^="qty_"]').first()).toHaveValue(nova);

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
