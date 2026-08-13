// Pergola — materiál/nárez z rozmerov (#155). Všetko ČÍTACIE — modul do Money nič
// nezapisuje, dá sa pustiť aj proti nasadenej appke (BASE_URL). Zero console errors
// (browser-console-zero-errors) chytí aj $effect self-loop (nova-stranka §3).
import { test, expect } from '@playwright/test';
import { goto, loginAs, collectConsole, waitHydrated } from './helpers';

test('formulár → materiál: Massive (NIE prvý systém) prežije, predná noha 2215, schéma, nepodporované', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	// §3 (nova-stranka): vyber NEPRVÝ systém (Massive; prvý je Robust) — ak by
	// reštart-effect ticho revertoval, materiál by vyšiel na Robust 18013, nie 18017
	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5760');
	await page.locator('#pocetPrednychNoh').fill('4');
	// predná svetlosť ostáva default 2200
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// systém prežil výber (Massive stĺp 18017, nie Robust 18013)
	await expect(page.getByTestId('narez-nadpis')).toContainText('Massive');
	const massiveNoha = page.getByTestId('polozka-18017');
	await expect(massiveNoha).toBeVisible();
	await expect(massiveNoha).toContainText('2215'); // 2200 + 15 (ZAK2026302)
	await expect(massiveNoha).toContainText('predná noha');
	await expect(page.getByTestId('polozka-18013')).toHaveCount(0);

	// priečka (18004) prítomná s počtom, dĺžka „čaká na výkres"
	await expect(page.getByTestId('polozka-18004')).toContainText('čaká na výkres');

	// informatívne: výstuha = 5760 − 280 = 5480
	await expect(page.getByTestId('vystuha-rez')).toContainText('5480');

	// schéma čelného pohľadu — 4 predné nohy
	await expect(page.getByTestId('narez-schema')).toBeVisible();
	await expect(page.getByTestId('schema-noha')).toHaveCount(4);

	// zatiaľ nepodporované — krov (ticket 161), žľab, sklá vypísané, nič sa nehádže
	const nepodp = page.getByTestId('narez-nepodporovane');
	await expect(nepodp).toContainText('Krov');
	await expect(nepodp).toContainText('161');
	await expect(nepodp).toContainText('Sklá');

	expect(consoleMsgs).toEqual([]);
});

test('samostatne stojaca: zobrazí zadné nohy, výsledok = zadná noha (výška 2900 − 140 = 2760)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	// na stenu (default) → zadné-nohy polia skryté
	await expect(page.getByTestId('zadne-nohy-box')).toHaveCount(0);

	await page.locator('#system').selectOption('Massive');
	await page.locator('#uchytenie').selectOption('samostatne');
	await expect(page.getByTestId('zadne-nohy-box')).toBeVisible();
	await page.locator('#vyskaZadna').fill('2900');
	await page.locator('#pocetZadnychNoh').fill('4');
	await page.locator('#hornyProfilZadnej').selectOption('140');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// dve položky s kódom 18017 (predná + zadná noha) — zadná = 2760
	await expect(page.getByTestId('narez-tabulka')).toContainText('zadná noha');
	await expect(page.getByTestId('narez-tabulka')).toContainText('2760 mm');
	await expect(page.getByTestId('narez-informativne')).toContainText('2760');

	expect(consoleMsgs).toEqual([]);
});

test('← Späť a upraviť: vstup prežije (systém aj šírka), nevynuluje sa (nova-stranka §4)', async ({
	page
}) => {
	await loginAs(page);
	await goto(page, '/pergola/narez');
	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5760');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await page.getByTestId('upravit').click();
	await waitHydrated(page);
	await expect(page.locator('#system')).toHaveValue('Massive');
	await expect(page.locator('#sirka')).toHaveValue('5760');
});

test('neplatná šírka cez UI: prejdeme priamo (HTML5), ale server chytí extrémnu hodnotu', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');
	await page.locator('#sirka').fill('10'); // pod SIRKA_MIN
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	await expect(page.getByTestId('form-error')).toContainText(/šírka/i);
	expect(consoleMsgs).toEqual([]);
});

test('odkaz z /pergola → /pergola/narez funguje, Money odpis formulár ostáva nedotknutý', async ({
	page
}) => {
	await loginAs(page);
	await goto(page, '/pergola');
	// pôvodný CAD nárez → Money formulár je stále na svojom mieste
	await expect(page.getByLabel('Materiál (CAD nárez) *')).toBeVisible();
	const link = page.getByTestId('link-narez');
	await expect(link).toBeVisible();
	await link.click();
	await waitHydrated(page);
	await expect(page).toHaveURL(/\/pergola\/narez$/);
	await expect(
		page.getByRole('heading', { name: 'Pergola — materiál/nárez z rozmerov' })
	).toBeVisible();
});
