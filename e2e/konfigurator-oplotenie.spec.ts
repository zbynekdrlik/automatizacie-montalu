// #388: verejný konfigurátor hliníkového oplotenia a brán (`/konfigurator/oplotenie`) — E2E cez reálny
// prehliadač. Kľúčové: VEREJNÝ flow BEZ prihlásenia; konfigurácia (typ/model/rozmery/farba) sa počíta
// klientsky a zobrazí súhrn; HONEST-NULL — žiadna orientačná cena (oplotenie nemá cenový zdroj); dopyt
// tok → PDF špecifikácia (bez ceny) na stiahnutie. GET je Money-neutrálny (číta sa aj proti LIVE prode);
// dopyt je ZÁPIS (audit riadok) → `skipAkLive`, nech proti prode nepribúdajú testovacie dopyty. Každý
// test = NULA console chýb (× = U+00D7 byte-identické).
import { test, expect } from '@playwright/test';
import { goto, collectConsole, skipAkLive } from './helpers';

test('oplotenie konfigurátor: verejná route bez auth — súhrn + HONEST-NULL (žiadna cena), nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/oplotenie');
	await expect(page).toHaveURL(/\/konfigurator\/oplotenie$/);

	// stránka sa načíta bez prihlásenia (verejná route)
	await expect(page.getByRole('heading', { name: /Navrhni si hliníkové oplotenie/ })).toBeVisible();

	// default konfigurácia → súhrn je hneď viditeľný (výška 1500 × šírka 2000 mm)
	await expect(page.getByTestId('oplotenie-suhrn')).toBeVisible();
	await expect(page.getByTestId('oplotenie-suhrn-rozmery')).toHaveText('1500 × 2000 mm');

	// HONEST-NULL: žiadna orientačná cena — „Cena na vyžiadanie" + NIKDE na stránke € symbol
	await expect(page.getByTestId('oplotenie-cena-info')).toContainText('Cena na vyžiadanie');
	await expect(page.locator('body')).not.toContainText('€');

	expect(consoleMsgs).toEqual([]);
});

test('oplotenie konfigurátor: zmena typu + modelu + rozmeru → súhrn sa aktualizuje → dopyt → PDF na stiahnutie, nula console chýb', async ({
	page
}) => {
	// zápisový tok (audit riadok do `dopyt`) — proti LIVE prode preskočiť (vzor bazén dopyt test).
	await skipAkLive(page);

	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/oplotenie');

	// zmeň typ na posuvnú bránu → aria-pressed sa prepne
	await page.getByTestId('oplotenie-typ-posuvna').click();
	await expect(page.getByTestId('oplotenie-typ-posuvna')).toHaveAttribute('aria-pressed', 'true');

	// zmeň model na PANDORA
	await page.getByTestId('oplotenie-model-PANDORA').click();
	await expect(page.getByTestId('oplotenie-model-PANDORA')).toHaveAttribute('aria-pressed', 'true');

	// zmeň rozmery → súhrn LIVE reaguje (klientsky $derived). Rozmerové polia sú METROVÉ steppery
	// (#333 RozmerStepper): fill je v METROCH („2" = 2000 mm), súhrn ostáva v mm.
	await page.getByTestId('oplotenie-vyska').fill('2');
	await page.getByTestId('oplotenie-vyska').blur();
	await page.getByTestId('oplotenie-sirka').fill('4');
	await page.getByTestId('oplotenie-sirka').blur();
	await expect(page.getByTestId('oplotenie-suhrn-rozmery')).toHaveText('2000 × 4000 mm');

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
