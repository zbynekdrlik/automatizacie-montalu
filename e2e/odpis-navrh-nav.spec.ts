// #423 — prepínač režimov (veľké kachličky) na zaskleniach a bazéne, parita s
// pergolou/fixom: „Zápis do Money" vs. „Návrhový výkres" namiesto malého redirect
// odkazu (owner 2.9.). Všetko ČÍTACIE (len navigácia + kontrola UI), nič do Money
// nezapisuje → dá sa pustiť aj proti nasadenej appke (BASE_URL). Overuje obe voľby
// na OBOCH stránkach rodiny, prepínanie oboma smermi, že aktívna kachlička nie je
// odkaz, a že návrhová cesta neponúka žiadne odoslanie do Money.
import { test, expect, type Page } from '@playwright/test';
import { goto, loginAs, collectConsole, waitHydrated } from './helpers';

async function tagName(page: Page, testid: string): Promise<string> {
	return page.getByTestId(testid).evaluate((el) => el.tagName);
}

test('#423 zasklenia — kachličky „Zápis do Money" / „Návrhový výkres" na oboch stránkach, prepínanie oboma smermi', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	// /zasklenia: aktívna = „Zápis do Money" (non-link), návrh je odkaz
	await goto(page, '/zasklenia');
	await expect(page.getByTestId('zasklenia-rezimy')).toBeVisible();
	await expect(page.getByTestId('zasklenia-rezim-odpis')).toContainText('Zápis do Money');
	await expect(page.getByTestId('zasklenia-rezim-navrh')).toContainText('Návrhový výkres');
	await expect(page.getByTestId('zasklenia-rezim-odpis')).toHaveClass(/active/);
	await expect(page.getByTestId('zasklenia-rezim-odpis')).not.toContainText('Otvoriť');
	expect(await tagName(page, 'zasklenia-rezim-odpis')).toBe('DIV');
	expect(await tagName(page, 'zasklenia-rezim-navrh')).toBe('A');

	// klik na návrhovú kachličku → /zasklenia/navrh; tam sa role otočia
	await page.getByTestId('zasklenia-rezim-navrh').click();
	await waitHydrated(page);
	await expect(page).toHaveURL(/\/zasklenia\/navrh$/);
	await expect(page.getByTestId('zasklenia-rezim-navrh')).toHaveClass(/active/);
	expect(await tagName(page, 'zasklenia-rezim-navrh')).toBe('DIV');
	expect(await tagName(page, 'zasklenia-rezim-odpis')).toBe('A');
	// „iba návrhový výkres" nesmie ponúkať žiadne odoslanie do Money
	await expect(page.getByRole('button', { name: /odoslať/i })).toHaveCount(0);

	// klik späť na „Zápis do Money" → /zasklenia
	await page.getByTestId('zasklenia-rezim-odpis').click();
	await waitHydrated(page);
	await expect(page).toHaveURL(/\/zasklenia$/);
	await expect(page.getByTestId('zasklenia-rezim-odpis')).toHaveClass(/active/);

	expect(consoleMsgs).toEqual([]);
});

test('#423 bazén — kachličky „Zápis do Money" / „Návrhový výkres" na oboch stránkach, prepínanie oboma smermi', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	// /bazen: aktívna = „Zápis do Money" (non-link), návrh je odkaz
	await goto(page, '/bazen');
	await expect(page.getByTestId('bazen-rezimy')).toBeVisible();
	await expect(page.getByTestId('bazen-rezim-odpis')).toContainText('Zápis do Money');
	await expect(page.getByTestId('bazen-rezim-navrh')).toContainText('Návrhový výkres');
	await expect(page.getByTestId('bazen-rezim-odpis')).toHaveClass(/active/);
	await expect(page.getByTestId('bazen-rezim-odpis')).not.toContainText('Otvoriť');
	expect(await tagName(page, 'bazen-rezim-odpis')).toBe('DIV');
	expect(await tagName(page, 'bazen-rezim-navrh')).toBe('A');

	// klik na návrhovú kachličku → /bazen/navrh; tam sa role otočia
	await page.getByTestId('bazen-rezim-navrh').click();
	await waitHydrated(page);
	await expect(page).toHaveURL(/\/bazen\/navrh$/);
	await expect(page.getByTestId('bazen-rezim-navrh')).toHaveClass(/active/);
	expect(await tagName(page, 'bazen-rezim-navrh')).toBe('DIV');
	expect(await tagName(page, 'bazen-rezim-odpis')).toBe('A');
	// „iba návrhový výkres" nesmie ponúkať žiadne odoslanie do Money
	await expect(page.getByRole('button', { name: /odoslať/i })).toHaveCount(0);

	// klik späť na „Zápis do Money" → /bazen
	await page.getByTestId('bazen-rezim-odpis').click();
	await waitHydrated(page);
	await expect(page).toHaveURL(/\/bazen$/);
	await expect(page.getByTestId('bazen-rezim-odpis')).toHaveClass(/active/);

	expect(consoleMsgs).toEqual([]);
});
