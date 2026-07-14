// E2E: b2b šírkový limit blokuje HNEĎ pri zadávaní (client-side, pred „Spočítať"),
// interný účet ho nevidí vôbec. Beží MONEY_LIVE=0 (žiadny zápis do Money).
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto } from './helpers';

const B2B = 'e2eb2b';
const INTERNAL = 'e2e';
const PASS = 'e2e-heslo-123';

test('b2b: šírka nad limit → okamžitý blok pod poľom + zablokované Spočítať, oprava → odblokuje', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page, B2B, PASS);
	await goto(page, '/zasklenia');

	await page.locator('#system').selectOption('Robust');
	await page.locator('#styl').selectOption('2K');
	// Robust 2K, maxPanel 1500 → 3200/2 = 1600 mm na sklo → nad limit, návrh 3K
	await page.locator('#s').fill('3200');

	// chyba sa zjaví HNEĎ, bez kliknutia na „Spočítať"
	const err = page.getByTestId('b2b-sirka-err');
	await expect(err).toBeVisible();
	await expect(err).toContainText('Zvoľ 3K');
	await expect(page.getByTestId('spocitat')).toBeDisabled();

	// oprava šírky do limitu → chyba zmizne, tlačidlo sa odblokuje
	await page.locator('#s').fill('2800'); // 2800/2 = 1400 ≤ 1500
	await expect(page.getByTestId('b2b-sirka-err')).toHaveCount(0);
	await expect(page.getByTestId('spocitat')).toBeEnabled();

	expect(errs, errs.join('\n')).toEqual([]);
});

test('b2b: výška nad limit → nezáväzné upozornenie, Spočítať ostáva povolené', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page, B2B, PASS);
	await goto(page, '/zasklenia');

	await page.locator('#system').selectOption('Robust');
	await page.locator('#styl').selectOption('2K');
	await page.locator('#s').fill('2800'); // šírka OK
	await page.locator('#v').fill('2700'); // Robust maxHeight 2600 → upozornenie

	await expect(page.getByTestId('b2b-vyska-warn')).toContainText('BEZ ZÁRUKY');
	// výška NEblokuje — tlačidlo ostáva povolené
	await expect(page.getByTestId('spocitat')).toBeEnabled();

	expect(errs, errs.join('\n')).toEqual([]);
});

test('interný účet: rovnaká nadrozmerná šírka NEVIDÍ limit a Spočítať je povolené', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page, INTERNAL, PASS);
	await goto(page, '/zasklenia');

	await page.locator('#system').selectOption('Robust');
	await page.locator('#styl').selectOption('2K');
	await page.locator('#s').fill('3200');

	await expect(page.getByTestId('b2b-sirka-err')).toHaveCount(0);
	await expect(page.getByTestId('spocitat')).toBeEnabled();

	expect(errs, errs.join('\n')).toEqual([]);
});
