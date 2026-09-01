// #142 — voľba roly pri založení účtu + zmena roly z UI (predtým sa dalo len
// ručne v DB). Reálny incident: šéf si cez jediný dostupný formulár (len B2B)
// založil účet a dostal orezanú rolu. Každý test vyžaduje NULA console
// errors/warnings (browser-console-zero-errors).
import { test, expect } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	E2E_USER,
	openUserMenu,
	logout
} from './helpers';

test('vytvorenie účtu s rolou Interný, plný prístup, zmena roly späť na B2B cez UI + zmazanie', async ({
	page
}) => {
	// vytvorenie interného účtu je NEZMAZATEĽNÉ z appky (zámerne — pozri
	// deleteB2BUser) — na živom/nasadenom cieli (BASE_URL) by ostal navždy, preto
	// sa tento test spúšťa len proti lokálnemu preview s čerstvou (zahodenou) DB.
	test.skip(!!process.env.BASE_URL, 'nezmazateľný interný účet — len proti čerstvej lokálnej DB');

	const consoleMsgs = collectConsole(page);
	page.on('dialog', (d) => d.accept()); // confirm() pri zmene roly aj pri Zmazať

	const novyUser = `e2e-interny-${Date.now().toString(36)}`;
	const novyPass = 'e2eheslo1';

	// 1. interný založí NOVÝ interný účet cez voľbu roly vo formulári (default je B2B)
	await loginAs(page);
	await goto(page, '/pouzivatelia');
	await expect(page.getByLabel('Rola')).toHaveValue('b2b'); // default
	await page.getByLabel('Prihlasovacie meno').fill(novyUser);
	await page.getByLabel('Heslo (min. 6 znakov)').fill(novyPass);
	await page.getByLabel('Rola').selectOption('internal');
	await page.getByRole('button', { name: 'Pridať účet' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('Interný');
	await expect(page.locator('tr', { hasText: novyUser })).toContainText('Interný');

	// 2. nový účet sa prihlási a má PLNÝ (interný) prístup — nie len Zasklenia
	await logout(page);
	await loginAs(page, novyUser, novyPass);
	await expect(page.getByRole('link', { name: 'Zasklenia' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Pergola' })).toBeVisible();
	await openUserMenu(page); // #392: Používatelia je v user menu
	await expect(page.getByRole('link', { name: 'Používatelia' })).toBeVisible();
	await goto(page, '/pouzivatelia');
	await expect(page).toHaveURL(/\/pouzivatelia/); // nepresmerovaný preč (na rozdiel od b2b)

	// 3. späť ako pôvodný interný — zmena roly nového účtu na B2B cez UI (select + Zmeniť + confirm)
	await logout(page);
	await loginAs(page);
	await goto(page, '/pouzivatelia');
	const row = page.locator('tr', { hasText: novyUser });
	await row.locator('select[name="role"]').selectOption('b2b');
	await row.getByRole('button', { name: 'Zmeniť' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('B2B');
	await expect(row).toContainText('B2B');

	// 4. teraz je B2B → zmazateľný (existujúca cesta) — upratanie
	await row.getByRole('button', { name: 'Zmazať' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('zmazaný');
	await expect(page.locator('tr', { hasText: novyUser })).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});

test('vlastnú rolu si účet nemôže zmeniť — ovládač sa na vlastnom riadku vôbec nezobrazí', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pouzivatelia');

	const vlastnyRiadok = page.locator('tr', { hasText: E2E_USER });
	await expect(vlastnyRiadok).toBeVisible();
	// žiadny select/tlačidlo Zmeniť na vlastnom riadku — len text roly
	await expect(vlastnyRiadok.locator('select[name="role"]')).toHaveCount(0);
	await expect(vlastnyRiadok.getByRole('button', { name: 'Zmeniť' })).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});

test('popisok pri voľbe roly vysvetľuje rozdiel B2B/Interný', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pouzivatelia');
	await waitHydrated(page);
	await expect(page.getByText(/B2B vidí len Zasklenia/)).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});
