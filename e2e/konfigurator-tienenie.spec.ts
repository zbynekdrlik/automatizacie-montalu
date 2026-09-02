// #389: verejný konfigurátor tienenia — markízy + screenové rolety (`/konfigurator/tienenie`) — E2E
// cez reálny prehliadač. Kľúčové: VEREJNÝ flow BEZ prihlásenia; konfigurácia (typ/rozmery/ovládanie/
// farba) sa počíta klientsky a zobrazí súhrn; druhý rozmer je VÝSUN (markíza) / VÝŠKA (roleta) — label
// sa mení podľa typu; HONEST-NULL — žiadna orientačná cena (tienenie nemá cenový zdroj); dopyt tok →
// PDF špecifikácia (bez ceny) na stiahnutie. GET je Money-neutrálny (číta sa aj proti LIVE prode);
// dopyt je ZÁPIS (audit riadok) → `skipAkLive`, nech proti prode nepribúdajú testovacie dopyty. Každý
// test = NULA console chýb.
import { test, expect } from '@playwright/test';
import { goto, collectConsole, skipAkLive } from './helpers';

test('tienenie konfigurátor: verejná route bez auth — súhrn (markíza = Výsun) + HONEST-NULL (žiadna cena), nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/tienenie');
	await expect(page).toHaveURL(/\/konfigurator\/tienenie$/);

	// stránka sa načíta bez prihlásenia (verejná route)
	await expect(
		page.getByRole('heading', { name: /Navrhni si markízu alebo roletu/ })
	).toBeVisible();

	// default konfigurácia (XLINE markíza) → súhrn je hneď viditeľný, druhý rozmer = „Výsun"
	await expect(page.getByTestId('tienenie-suhrn')).toBeVisible();
	await expect(page.getByTestId('tienenie-suhrn-sirka')).toHaveText('4000 mm');
	await expect(page.getByTestId('tienenie-suhrn-rozmer2')).toHaveText('3000 mm');
	await expect(page.getByTestId('tienenie-suhrn')).toContainText('Výsun');

	// HONEST-NULL: žiadna orientačná cena — „Cena na vyžiadanie" + NIKDE na stránke € symbol
	await expect(page.getByTestId('tienenie-cena-info')).toContainText('Cena na vyžiadanie');
	await expect(page.locator('body')).not.toContainText('€');

	expect(consoleMsgs).toEqual([]);
});

test('tienenie konfigurátor: prepnutie na roletu (Výška) + zmena rozmerov → súhrn sa aktualizuje → dopyt → PDF na stiahnutie, nula console chýb', async ({
	page
}) => {
	// zápisový tok (audit riadok do `dopyt`) — proti LIVE prode preskočiť (vzor bazén/pergola dopyt test).
	await skipAkLive(page);

	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/tienenie');

	// prepni typ na screenovú roletu ZIPLINE → druhý rozmer sa zmení na „Výška" (druh = roleta)
	await page.getByTestId('tienenie-model-ZIPLINE').click();
	await expect(page.getByTestId('tienenie-model-ZIPLINE')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('tienenie-suhrn')).toContainText('Výška');

	// zmeň rozmery → súhrn LIVE reaguje (klientsky $derived). Rozmerové polia sú METROVÉ steppery
	// (#333 RozmerStepper): fill je v METROCH („6" = 6000 mm), súhrn ostáva v mm.
	await page.getByTestId('tienenie-sirka').fill('6');
	await page.getByTestId('tienenie-sirka').blur();
	await page.getByTestId('tienenie-rozmer2').fill('2.5');
	await page.getByTestId('tienenie-rozmer2').blur();
	await expect(page.getByTestId('tienenie-suhrn-sirka')).toHaveText('6000 mm');
	await expect(page.getByTestId('tienenie-suhrn-rozmer2')).toHaveText('2500 mm');

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
