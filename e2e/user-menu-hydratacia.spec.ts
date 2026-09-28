// #583: post-deploy E2E 0.25.50 padol pri `logout()` po dlhom náhľade zasklení — `<div class="card">
// intercepts pointer events` a potom `element is not visible`. Koreň NEBOL z-index: „Spočítať" je
// plný (non-enhanced) POST → nový dokument, test klikol na user menu ešte PRED hydratáciou, natívny
// `<details>` sa otvoril a hydratácia ho `bind:open` efektom (open = false) hneď zavrela. To isté
// zažije reálny používateľ na pomalom pripojení. Test JS appky DETERMINISTICKY zadrží (route), aby
// klik určite padol pred hydratáciu, a overí, že menu po hydratácii OSTANE otvorené a odhlási.
// Compute-only (žiadny Money zápis) → beží aj post-deploy proti PROD.
import { test, expect } from '@playwright/test';
import { collectConsole, goto, loginAs, vyberFarbuKovania, waitHydrated } from './helpers';

test('user menu otvorené PRED hydratáciou ostane otvorené — odhlásenie po dlhom náhľade (#583)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-583-MENU');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E menu po náhľade');
	await page.getByLabel('Systém').selectOption('Deluxe');
	await page.getByLabel('Štýl').selectOption('3K');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2700');
	await vyberFarbuKovania(page);

	// zadrž JS appky pre NASLEDUJÚCI dokument (výsledok Spočítať je plný POST → nová stránka)
	let pustitJs!: () => void;
	const jsPusteny = new Promise<void>((r) => (pustitJs = r));
	await page.route('**/*', async (route) => {
		if (route.request().resourceType() === 'script') await jsPusteny;
		await route.continue();
	});
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await expect(page.getByTestId('sklo-sirka')).toBeVisible(); // dlhý náhľad (SSR)
	await expect(page.locator('html')).not.toHaveAttribute('data-hydrated', '1'); // ešte PRED hydratáciou

	const odhlasit = page.getByRole('button', { name: 'Odhlásiť' });
	await page.getByTestId('user-menu-toggle').click();
	await expect(odhlasit).toBeVisible();

	pustitJs();
	await waitHydrated(page);
	await page.evaluate(
		() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
	);
	// hydratácia menu NESMIE zavrieť
	await expect(odhlasit).toBeVisible({ timeout: 2000 });
	await odhlasit.click();
	await expect(page).toHaveURL(/\/login/);
	expect(consoleMsgs).toEqual([]);
});
