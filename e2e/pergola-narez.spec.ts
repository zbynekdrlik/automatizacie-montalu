// Pergola — materiál/nárez z rozmerov (#155). Všetko ČÍTACIE — modul do Money nič
// nezapisuje, dá sa pustiť aj proti nasadenej appke (BASE_URL). Zero console errors
// (browser-console-zero-errors) chytí aj $effect self-loop (nova-stranka §3).
import { test, expect } from '@playwright/test';
import { goto, loginAs, collectConsole, waitHydrated } from './helpers';

test('formulár → materiál: Massive (NIE prvý systém) prežije, predná noha 2215, nepodporované', async ({
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
	const consoleMsgs = collectConsole(page);
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
	expect(consoleMsgs).toEqual([]);
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
	const consoleMsgs = collectConsole(page);
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
	expect(consoleMsgs).toEqual([]);
});

// --- Technický výkres z rozmerov (#194) ----------------------------------------
test('výkres: predný pohľad + bokorys + pôdorys sa vykreslia z potvrdených rozmerov, krov → #161, console-zero', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5760');
	await page.locator('#hlbka').fill('3690');
	await page.locator('#pocetPrednychNoh').fill('4');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// výkresový hárok + tri pohľady
	await expect(page.getByTestId('vykresovy-harok')).toBeVisible();
	await expect(page.getByTestId('pnr-predny-pohlad')).toHaveCount(1);
	await expect(page.getByTestId('pnr-bokorys')).toHaveCount(1);
	await expect(page.getByTestId('pnr-podorys')).toHaveCount(1);

	// 4 predné nohy nakreslené v prednom pohľade AJ v pôdoryse (osovo zarovnané rects
	// — počítame prítomnosť, NIE toBeVisible; vykres.md)
	await expect(page.getByTestId(/^pnr-fe-noha-\d+$/)).toHaveCount(4);
	await expect(page.getByTestId(/^pnr-pod-predna-noha-\d+$/)).toHaveCount(4);

	// na stenu (default): pôdorys má čiaru steny, žiadne zadné nohy
	await expect(page.getByTestId('pnr-pod-stena')).toHaveCount(1);
	await expect(page.getByTestId(/^pnr-pod-zadna-noha-\d+$/)).toHaveCount(0);

	// krov je zjednodušený s poznámkou → #161, NIKDY sa nehádže sklon
	await expect(page.getByTestId('pnr-krov-pozn')).toContainText('#161');
	await expect(page.getByTestId('pnr-bok-krov-pozn')).toContainText('#161');

	// spec ukazuje potvrdené hodnoty (systém, rozostup nôh 1920) + display-only
	await expect(page.getByTestId('pnr-spec-nohy')).toContainText('1920');
	await expect(page.getByTestId('pnr-spec-money')).toContainText('/pergola');

	expect(consoleMsgs).toEqual([]);
});

test('výkres samostatne stojaca: zadné nohy sa objavia v bokoryse aj pôdoryse (výška 2900)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5000');
	await page.locator('#pocetPrednychNoh').fill('3');
	await page.locator('#uchytenie').selectOption('samostatne');
	await page.locator('#vyskaZadna').fill('2900');
	await page.locator('#pocetZadnychNoh').fill('3');
	await page.locator('#hornyProfilZadnej').selectOption('140');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// zadné nohy nakreslené: bokorys (1 profil) + pôdorys (3 štvorčeky), žiadna stena
	await expect(page.getByTestId('pnr-bok-zadna-noha')).toHaveCount(1);
	await expect(page.getByTestId(/^pnr-pod-zadna-noha-\d+$/)).toHaveCount(3);
	await expect(page.getByTestId('pnr-pod-stena')).toHaveCount(0);
	// strecha (zjednodušený obrys) sa kreslí len pri samostatne stojacej
	await expect(page.getByTestId('pnr-bok-strecha')).toHaveCount(1);
	// spec ukazuje zadnú nohu 2760 (2900 − 140)
	await expect(page.getByTestId('pnr-spec-uchytenie')).toContainText('2760');

	expect(consoleMsgs).toEqual([]);
});
