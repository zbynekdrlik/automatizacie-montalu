// E2E: história odpisov (uvoľnenie dedup kľúča), odhlásenie, login deep-link
// (?next=) a predvyplnenie mena. Trieda navigačných/stavových bugov + Money-
// kritické uvoľnenie. Nula console errors všade.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, waitHydrated, skipAkLive, E2E_USER, E2E_PASS } from './helpers';

const RUN = `E2E-${Date.now().toString(36).toUpperCase()}`;


test('odpisy: uvoľnenie dovolí poslať tú istú ZAK+OP znova (celý UI tok)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	page.on('dialog', (d) => d.accept()); // confirm() pri Uvoľniť
	await loginAs(page);

	const posli = async () => {
		await goto(page, '/zasklenia');
		await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-REL`);
		await page.getByLabel('OP/OPDL číslo *').fill('01');
		await page.getByLabel('Zákazník *').fill('E2E Uvoľniť');
		await page.getByLabel('Šírka (mm) *').fill('2509');
		await page.getByLabel('Výška (mm) *').fill('1930');
		await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
		await page.getByTestId('odoslat').click();
	};

	// 1. prvé odoslanie prejde
	await posli();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// 2. rovnaká ZAK+OP → duplikát
	await posli();
	await expect(page.getByTestId('duplikat')).toContainText('už bola odoslaná');

	// 3. história → Uvoľniť ten záznam
	await goto(page, '/odpisy');
	const row = page.locator('tr', { hasText: `${RUN}-REL` }).first();
	await row.getByRole('button', { name: 'Uvoľniť' }).click();
	await expect(page.getByTestId('uvolnene')).toBeVisible();

	// 4. po uvoľnení sa tá istá ZAK+OP dá poslať znova (nie duplikát)
	await posli();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	expect(consoleMsgs).toEqual([]);
});

test('odhlásenie zmaže session a presmeruje na login', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await page.getByRole('button', { name: 'Odhlásiť' }).click();
	await expect(page).toHaveURL(/\/login/);
	// chránená stránka po odhlásení opäť presmeruje na login
	await goto(page, '/odpisy');
	await expect(page).toHaveURL(/\/login/);
	expect(consoleMsgs).toEqual([]);
});

test('login: deep-link ?next= pristane po prihlásení na PÔVODNEJ ceste', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	// neprihlásený prístup na /odpisy → login s next parametrom
	await goto(page, '/odpisy');
	await expect(page).toHaveURL(/login\?next=%2Fodpisy/);
	await page.getByLabel('Meno').fill(E2E_USER);
	await page.getByLabel('Heslo').fill(E2E_PASS);
	await page.getByRole('button', { name: 'Prihlásiť' }).click();
	// po prihlásení pristane na /odpisy, nie na defaultnom /zasklenia
	await expect(page).toHaveURL(/\/odpisy/);
	await waitHydrated(page);
	expect(consoleMsgs).toEqual([]);
});

test('login: po zlom hesle ostane meno predvyplnené', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/login');
	await page.getByLabel('Meno').fill('e2e');
	await page.getByLabel('Heslo').fill('zle-heslo');
	await page.getByRole('button', { name: 'Prihlásiť' }).click();
	await expect(page.getByTestId('login-error')).toBeVisible();
	// meno sa NEvynuluje (trieda bugu „späť vynuluje formulár")
	await expect(page.getByLabel('Meno')).toHaveValue('e2e');
	expect(consoleMsgs).toEqual([]);
});
