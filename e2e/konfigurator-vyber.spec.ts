// #384: výberová obrazovka jednotného verejného konfigurátora (`/konfigurator`) — E2E cez reálny
// prehliadač. Kľúčové: verejný flow BEZ prihlásenia; grid produktových kariet sa vykreslí, pergola
// (live) vedie na svoju podstránku a konfigurátor sa z nej naozaj načíta, „pripravujeme" karty
// vedú externe na montalu.sk (žiadny mŕtvy klik). Money-neutrálne (žiadny zápis) → beží aj proti
// LIVE prode (BASE_URL), bez skipAkLive. Každý test = NULA console chýb.
import { test, expect } from '@playwright/test';
import { goto, collectConsole } from './helpers';

test('výberová obrazovka: grid kariet + pergola & bazén & zasklenie live vedú interne, zimná záhrada „pripravujeme" externe', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator');

	// výberový grid je viditeľný
	await expect(page.getByTestId('konf-vyber')).toBeVisible();

	// pergola = live karta → interná podstránka `/konfigurator/pergola`
	const pergola = page.getByTestId('konf-produkt-pergola');
	await expect(pergola).toBeVisible();
	await expect(pergola).toHaveAttribute('data-stav', 'live');
	await expect(pergola).toHaveAttribute('href', /\/konfigurator\/pergola$/);

	// #385: bazén = live karta → interná podstránka `/konfigurator/bazen` (už nie „pripravujeme")
	const bazen = page.getByTestId('konf-produkt-bazen');
	await expect(bazen).toBeVisible();
	await expect(bazen).toHaveAttribute('data-stav', 'live');
	await expect(bazen).toHaveAttribute('href', /\/konfigurator\/bazen$/);

	// #387: zasklenie = live karta → interná podstránka `/konfigurator/zasklenie` (už nie „pripravujeme")
	const zasklenie = page.getByTestId('konf-produkt-zasklenie');
	await expect(zasklenie).toBeVisible();
	await expect(zasklenie).toHaveAttribute('data-stav', 'live');
	await expect(zasklenie).toHaveAttribute('href', /\/konfigurator\/zasklenie$/);

	// zimná záhrada = stále „pripravujeme" → externý odkaz na montalu.sk (nový tab)
	const zz = page.getByTestId('konf-produkt-zimna-zahrada');
	await expect(zz).toBeVisible();
	await expect(zz).toHaveAttribute('data-stav', 'pripravujeme');
	await expect(zz).toHaveAttribute('href', /montalu\.sk\/produkty\/zimne-zahrady$/);
	await expect(zz).toHaveAttribute('target', '_blank');

	// všetkých 7 produktových kariet je prítomných (parita so 6 kategóriami montalu.sk + prístrešky)
	await expect(page.locator('[data-testid^="konf-produkt-"]')).toHaveCount(7);

	expect(consoleMsgs).toEqual([]);
});

test('klik na pergolu z výberu načíta konfigurátor na /konfigurator/pergola (kontinuita odkazu)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator');

	await page.getByTestId('konf-produkt-pergola').click();
	await expect(page).toHaveURL(/\/konfigurator\/pergola$/);

	// konfigurátor sa naozaj načítal (3D náhľad je READY) — dôkaz, že presun routy funguje
	await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 20000 });

	expect(consoleMsgs).toEqual([]);
});
