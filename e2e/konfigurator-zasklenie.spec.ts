// #387: verejný konfigurátor zasklenia terás a balkónov (`/konfigurator/zasklenie`) — E2E cez reálny
// prehliadač. Kľúčové: VEREJNÝ flow BEZ prihlásenia; konfigurácia (umiestnenie/model/rozmery/počet
// krídel/farba/sklo) sa počíta klientsky a zobrazí súhrn; zmena umiestnenia RE-FILTRUJE modely;
// HONEST-NULL — žiadna orientačná cena (zasklenie nemá cenový zdroj); dopyt tok → PDF špecifikácia
// (bez ceny) na stiahnutie. GET je Money-neutrálny (číta sa aj proti LIVE prode); dopyt je ZÁPIS
// (audit riadok) → `skipAkLive`, nech proti prode nepribúdajú testovacie dopyty. Každý test = NULA
// console chýb (× = U+00D7 byte-identické).
import { test, expect } from '@playwright/test';
import { goto, collectConsole, skipAkLive } from './helpers';

test('zasklenie konfigurátor: verejná route bez auth — súhrn + umiestnenie re-filtruje modely + HONEST-NULL (žiadna cena), nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/zasklenie');
	await expect(page).toHaveURL(/\/konfigurator\/zasklenie$/);
	// dokument má SEO titul (#411 shell: <svelte:head> cez `titul` prop, nie prázdna záložka)
	await expect(page).toHaveTitle(/zasklenie terasy alebo balkóna.*Montalu/);

	// stránka sa načíta bez prihlásenia (verejná route)
	await expect(page.getByRole('heading', { name: /Navrhni si zasklenie/ })).toBeVisible();

	// default (Terasa) → terasový model ROBUST je viditeľný, balkónový LUX NIE
	await expect(page.getByTestId('zasklenie-model-ROBUST')).toBeVisible();
	await expect(page.getByTestId('zasklenie-model-LUX')).toHaveCount(0);

	// default konfigurácia → súhrn je hneď viditeľný (4000 × 2500 mm)
	await expect(page.getByTestId('zasklenie-suhrn')).toBeVisible();
	await expect(page.getByTestId('zasklenie-suhrn-rozmery')).toHaveText('4000 × 2500 mm');

	// prepni umiestnenie na Balkón → modely sa RE-FILTRUJÚ (LUX sa objaví, terasový ROBUST zmizne)
	await page.getByTestId('zasklenie-umiestnenie-Balkón').click();
	await expect(page.getByTestId('zasklenie-umiestnenie-Balkón')).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.getByTestId('zasklenie-model-LUX')).toBeVisible();
	await expect(page.getByTestId('zasklenie-model-ROBUST')).toHaveCount(0);
	// model sa RESETUJE na default balkóna (STANDARD, aria-pressed) — page-specific reaktívne pravidlo
	await expect(page.getByTestId('zasklenie-model-STANDARD')).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	// súhrn „Systém" riadok nasleduje reset (STANDARD rámový posuvný)
	await expect(page.getByTestId('zasklenie-suhrn')).toContainText('STANDARD (Rámový posuvný)');

	// HONEST-NULL: žiadna orientačná cena — „Cena na vyžiadanie" + NIKDE na stránke € symbol
	await expect(page.getByTestId('zasklenie-cena-info')).toContainText('Cena na vyžiadanie');
	await expect(page.locator('body')).not.toContainText('€');

	expect(consoleMsgs).toEqual([]);
});

test('zasklenie konfigurátor: zmena modelu + rozmeru → súhrn sa aktualizuje → dopyt → PDF na stiahnutie, nula console chýb', async ({
	page
}) => {
	// zápisový tok (audit riadok do `dopyt`) — proti LIVE prode preskočiť (vzor pergola/bazén dopyt test).
	await skipAkLive(page);

	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/zasklenie');

	// zmeň model na SLIDE (terasový systém) → aria-pressed sa prepne
	await page.getByTestId('zasklenie-model-SLIDE').click();
	await expect(page.getByTestId('zasklenie-model-SLIDE')).toHaveAttribute('aria-pressed', 'true');

	// zmeň rozmery → súhrn LIVE reaguje (klientsky $derived). Rozmerové polia sú METROVÉ steppery
	// (#333 RozmerStepper): fill je v METROCH („5" = 5000 mm), súhrn ostáva v mm.
	await page.getByTestId('zasklenie-sirka').fill('5');
	await page.getByTestId('zasklenie-sirka').blur();
	await page.getByTestId('zasklenie-vyska').fill('3');
	await page.getByTestId('zasklenie-vyska').blur();
	await expect(page.getByTestId('zasklenie-suhrn-rozmery')).toHaveText('5000 × 3000 mm');

	// dopyt formulár je viditeľný (súhrn platný)
	const dopyt = page.getByTestId('dopyt');
	await expect(dopyt).toBeVisible();
	await expect(dopyt.getByRole('heading', { name: /Máš záujem/i })).toBeVisible();

	// vyplň kontakt — JASNE OZNAČENÝ testovací dopyt (honeypot `firma_web` prázdny)
	await dopyt.getByLabel(/Meno a priezvisko/).fill('TEST E2E — ignorovať');
	await dopyt.getByLabel(/^E-mail/).fill('test-e2e@example.com');
	await dopyt.getByLabel(/Telefón/).fill('+421900000000');
	await dopyt.getByLabel(/Miesto stavby/).fill('83101 Bratislava');
	await dopyt.getByLabel(/Poznámka/).fill('TEST E2E — automatický test, prosím ignorovať.');

	// odošli → server vráti PDF (base64) → komponent spustí stiahnutie
	const responsePromise = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('dopyt')
	);
	const downloadPromise = page.waitForEvent('download');
	await dopyt.getByRole('button', { name: /Odoslať dopyt/i }).click();

	const response = await responsePromise;
	expect(response.ok()).toBe(true); // POST akcie prešiel (2xx)

	const download = await downloadPromise; // PDF sa reálne stiahol
	expect(download.suggestedFilename()).toMatch(/^Montalu-ponuka-\d{4}-\d{2}-\d{2}\.pdf$/);

	expect(consoleMsgs).toEqual([]);
});
