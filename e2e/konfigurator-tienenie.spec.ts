// #389: verejný konfigurátor tienenia — markízy + screenové rolety (`/konfigurator/tienenie`) — E2E
// cez reálny prehliadač. Kľúčové: VEREJNÝ flow BEZ prihlásenia; konfigurácia (typ/rozmery/ovládanie/
// farba) sa počíta klientsky a zobrazí súhrn; druhý rozmer je VÝSUN (markíza) / VÝŠKA (roleta) — label
// AJ stepper aria-label sa menia podľa typu; ovládanie je PER MODEL (XLIGHT ručné+motorické, XLINE/
// ZIPLINE len motorické); limity sú PER MODEL (ZIPLINE šírka do 4000/výška do 3000); HONEST-NULL —
// žiadna orientačná cena (tienenie nemá cenový zdroj); dopyt tok → PDF špecifikácia (bez ceny) na
// stiahnutie. GET je Money-neutrálny (číta sa aj proti LIVE prode); dopyt je ZÁPIS (audit riadok) →
// `skipAkLive`. Každý test = NULA console chýb.
import { test, expect } from '@playwright/test';
import { goto, collectConsole, skipAkLive } from './helpers';

test('tienenie: verejná route bez auth — XLINE markíza (Výsun, len motorické) + HONEST-NULL, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/tienenie');
	await expect(page).toHaveURL(/\/konfigurator\/tienenie$/);
	// dokument má SEO titul (#411 shell: <svelte:head> cez `titul` prop, nie prázdna záložka)
	await expect(page).toHaveTitle(/Navrhni si tienenie.*Montalu/);

	// stránka sa načíta bez prihlásenia (verejná route)
	await expect(
		page.getByRole('heading', { name: /Navrhni si markízu alebo roletu/ })
	).toBeVisible();

	// default konfigurácia (XLINE markíza) → súhrn je hneď viditeľný, druhý rozmer = „Výsun"
	await expect(page.getByTestId('tienenie-suhrn')).toBeVisible();
	await expect(page.getByTestId('tienenie-suhrn-sirka')).toHaveText('4000 mm');
	await expect(page.getByTestId('tienenie-suhrn-rozmer2')).toHaveText('3000 mm');
	await expect(page.getByTestId('tienenie-suhrn')).toContainText('Výsun');

	// adaptívny label je aj na stepperi (aria-label), nielen v súhrne
	await expect(page.getByRole('button', { name: 'Zväčšiť výsun' })).toBeVisible();

	// XLINE ponúka LEN motorické ovládanie (montalu.sk) — práve jedna ovládanie karta, „Ručné" nie je
	await expect(page.getByTestId('tienenie-ovladanie-elektricke')).toBeVisible();
	await expect(page.getByTestId('tienenie-ovladanie-rucne')).toHaveCount(0);

	// HONEST-NULL: žiadna orientačná cena — „Cena na vyžiadanie" + NIKDE na stránke € symbol
	await expect(page.getByTestId('tienenie-cena-info')).toContainText('Cena na vyžiadanie');
	await expect(page.locator('body')).not.toContainText('€');

	expect(consoleMsgs).toEqual([]);
});

test('tienenie: XLIGHT ovládanie (Ručné) → ZIPLINE (Výška, motorické-only reset) + ZIPLINE-platné rozmery → dopyt → PDF, nula console chýb', async ({
	page
}) => {
	// zápisový tok (audit riadok do `dopyt`) — proti LIVE prode preskočiť (vzor bazén/pergola dopyt test).
	await skipAkLive(page);

	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/tienenie');

	// XLIGHT ponúka aj ručné ovládanie → prepni a over v súhrne
	await page.getByTestId('tienenie-model-XLIGHT').click();
	await expect(page.getByTestId('tienenie-model-XLIGHT')).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('tienenie-ovladanie-rucne').click();
	await expect(page.getByTestId('tienenie-suhrn')).toContainText('Ručné');

	// prepni na screenovú roletu ZIPLINE → druhý rozmer „Výška", ovládanie sa RESETNE na motorické
	// (ZIPLINE „Ručné" neponúka — žiadny vymyslený variant), stepper aria-label sa zmení na „výšku"
	await page.getByTestId('tienenie-model-ZIPLINE').click();
	await expect(page.getByTestId('tienenie-model-ZIPLINE')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('tienenie-suhrn')).toContainText('Výška');
	await expect(page.getByTestId('tienenie-suhrn')).toContainText('Elektrické'); // ovládanie resetnuté
	await expect(page.getByTestId('tienenie-ovladanie-rucne')).toHaveCount(0); // ZIPLINE ho neponúka
	await expect(page.getByRole('button', { name: 'Zväčšiť výšku' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Zväčšiť výsun' })).toHaveCount(0);

	// zmeň rozmery na ZIPLINE-platné (šírka do 4000, výška do 3000). Rozmerové polia sú METROVÉ steppery
	// (#333): fill je v METROCH; súhrn ostáva v mm.
	await page.getByTestId('tienenie-sirka').fill('4');
	await page.getByTestId('tienenie-sirka').blur();
	await page.getByTestId('tienenie-rozmer2').fill('2.5');
	await page.getByTestId('tienenie-rozmer2').blur();
	await expect(page.getByTestId('tienenie-suhrn-sirka')).toHaveText('4000 mm');
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

test('tienenie: farba select + stepper +/− KLIKNUTIE + default XLINE tam-späť + scroll-CTA, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/tienenie');

	// farba select
	const farbaSelect = page.getByTestId('tienenie-farba');
	await expect(farbaSelect).toBeVisible();
	const farbaOpts = await farbaSelect
		.locator('option')
		.evaluateAll((els) => els.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
	expect(farbaOpts.length).toBeGreaterThan(1);
	await farbaSelect.selectOption(farbaOpts[1]!);
	await expect(farbaSelect).toHaveValue(farbaOpts[1]!);

	// stepper +/− KLIK (doteraz len visibility, nikdy kliknuté) — šírka
	const sirkaInput = page.getByTestId('tienenie-sirka');
	const initialSirka = await sirkaInput.inputValue();
	await page.getByRole('button', { name: 'Zväčšiť šírku' }).click();
	const afterIncSirka = await sirkaInput.inputValue();
	expect(afterIncSirka).not.toBe(initialSirka);
	await page.getByRole('button', { name: 'Zmenšiť šírku' }).click();
	await expect(sirkaInput).toHaveValue(initialSirka);

	// výsun/výška stepper (adaptívny label podľa modelu — XLINE default = „Výsun")
	const vysunBtn = page.getByRole('button', { name: /Zväčšiť (výsun|výšku)/ });
	const zmenBtn = page.getByRole('button', { name: /Zmenšiť (výsun|výšku)/ });
	const rozmer2Input = page.getByTestId('tienenie-rozmer2');
	const initialRozmer2 = await rozmer2Input.inputValue();
	await vysunBtn.click();
	const afterIncRozmer2 = await rozmer2Input.inputValue();
	expect(afterIncRozmer2).not.toBe(initialRozmer2);
	await zmenBtn.click();
	await expect(rozmer2Input).toHaveValue(initialRozmer2);

	// default XLINE tam-späť (PARTIAL requirement #463)
	await page.getByTestId('tienenie-model-XLIGHT').click();
	await expect(page.getByTestId('tienenie-model-XLIGHT')).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('tienenie-model-XLINE').click();
	await expect(page.getByTestId('tienenie-model-XLINE')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('tienenie-model-XLIGHT')).toHaveAttribute('aria-pressed', 'false');

	// scroll-CTA „Nezáväzný dopyt →"
	const scrollCta = page.getByText(/Nezáväzný dopyt/).first();
	await expect(scrollCta).toBeVisible();
	await scrollCta.click();
	await expect(page.getByTestId('dopyt')).toBeInViewport();

	expect(consoleMsgs).toEqual([]);
});
