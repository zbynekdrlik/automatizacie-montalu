// #386/#408/#429: verejný konfigurátor zimných záhrad (`/konfigurator/zimna-zahrada`) — E2E cez
// reálny prehliadač. Kľúčové: VEREJNÝ flow BEZ prihlásenia; konfigurácia
// (model/rozmery/farba/zasklenie/systém stien) sa počíta klientsky a zobrazí súhrn; #408/#429
// ORIENTAČNÁ CENA na klik (server-počítaná `vypocet`, matica montalu.sk, Money-neutrálna — bez
// zápisu) — #429 systém stien je TERAZ reálna cenotvorná voľba; dopyt tok → PDF špecifikácia s
// orientačnou cenou na stiahnutie. GET aj `vypocet` sú Money-neutrálne (číta sa aj proti LIVE prode);
// dopyt je ZÁPIS (audit riadok) → `skipAkLive`, nech proti prode nepribúdajú testovacie dopyty. Každý
// test = NULA console chýb (× = U+00D7 byte-identické).
import { test, expect } from '@playwright/test';
import { goto, collectConsole, skipAkLive } from './helpers';

test('zimná záhrada konfigurátor: verejná route bez auth — súhrn + orientačná cena po kliku, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/zimna-zahrada');
	await expect(page).toHaveURL(/\/konfigurator\/zimna-zahrada$/);
	// dokument má SEO titul (#411 shell: <svelte:head> cez `titul` prop, nie prázdna záložka)
	await expect(page).toHaveTitle(/zimnú záhradu.*Montalu/);

	// stránka sa načíta bez prihlásenia (verejná route)
	await expect(page.getByRole('heading', { name: /Navrhni si zimnú záhradu/ })).toBeVisible();

	// default konfigurácia → súhrn je hneď viditeľný (4000 × 3500 mm)
	await expect(page.getByTestId('zz-suhrn')).toBeVisible();
	await expect(page.getByTestId('zz-suhrn-rozmery')).toHaveText('4000 × 3500 mm');
	// #434: redizajn #376/#421 dokončený aj na verejnej karte — číselná rozmerová hodnota nesie .mono
	await expect(page.getByTestId('zz-suhrn-rozmery')).toHaveClass(/mono/);

	// #408: orientačná cena je na KLIK (server-počítaná) — pred klikom je len tlačidlo, žiadny € na stránke
	await expect(page.getByTestId('zz-cena-zobrazit')).toBeVisible();
	await expect(page.locator('body')).not.toContainText('€');

	// klik → server vráti orientačnú MO cenu → cena (s DPH, €) sa zobrazí
	await page.getByTestId('zz-cena-zobrazit').click();
	await expect(page.getByTestId('zz-cena')).toBeVisible();
	await expect(page.getByTestId('zz-cena')).toContainText('Orientačná cena');
	await expect(page.getByTestId('zz-cena-sdph')).toContainText('€');
	await expect(page.getByTestId('zz-cena-sdph')).toHaveClass(/mono/);

	expect(consoleMsgs).toEqual([]);
});

test('zimná záhrada cena: zmena zasklenia/systému stien/rozmeru zneaktuálni zobrazenú cenu → „Prepočítať" → nová cena, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/zimna-zahrada');

	// zobraz orientačnú cenu pre default (4000 × 3500, Izolačné sklo, báza Slide 16mm systém stien)
	await page.getByTestId('zz-cena-zobrazit').click();
	await expect(page.getByTestId('zz-cena')).toBeVisible();

	// zmeň ZASKLENIE → cena sa považuje za NEAKTUÁLNU (cenaKluc obsahuje zasklenie): blok zmizne,
	// tlačidlo sa vráti ako „Prepočítať" (#408 `cenaAktualna` gating — nikdy neukáž cenu pre iný config)
	await page.getByTestId('zz-zasklenie').selectOption('Polykarbonát');
	await expect(page.getByTestId('zz-cena')).toHaveCount(0);
	await expect(page.getByTestId('zz-cena-zobrazit')).toContainText('Prepočítať');

	// prepočítaj → nová orientačná cena pre Polykarbonát (báza Slide 16mm systém stien)
	await page.getByTestId('zz-cena-zobrazit').click();
	await expect(page.getByTestId('zz-cena')).toBeVisible();
	await expect(page.getByTestId('zz-cena-sdph')).toContainText('€');
	const polykarbonatBazaCena = await page.getByTestId('zz-cena-sdph').innerText();

	// #429: zmena SYSTÉMU STIEN (rovnaké rozmery+zasklenie) tiež zneaktuálni cenu (cenaKluc ho
	// obsahuje) → prepočítaj → INÁ cena (systém stien JE TERAZ cenotvorný, nie len display)
	await page.getByTestId('zz-system-stien').selectOption('Robust - 24mm IZO sklo');
	await expect(page.getByTestId('zz-cena')).toHaveCount(0);
	await expect(page.getByTestId('zz-cena-zobrazit')).toContainText('Prepočítať');
	await page.getByTestId('zz-cena-zobrazit').click();
	await expect(page.getByTestId('zz-cena')).toBeVisible();
	const robustCena = await page.getByTestId('zz-cena-sdph').innerText();
	expect(robustCena).not.toBe(polykarbonatBazaCena);

	// aj zmena rozmeru zneaktuálni cenu (cenaKluc obsahuje hĺbku aj šírku)
	await page.getByTestId('zz-hlbka').fill('5');
	await page.getByTestId('zz-hlbka').blur();
	await expect(page.getByTestId('zz-cena')).toHaveCount(0);
	await expect(page.getByTestId('zz-cena-zobrazit')).toContainText('Prepočítať');

	expect(consoleMsgs).toEqual([]);
});

test('zimná záhrada konfigurátor: zmena modelu + rozmeru → súhrn sa aktualizuje → dopyt → PDF na stiahnutie, nula console chýb', async ({
	page
}) => {
	// zápisový tok (audit riadok do `dopyt`) — proti LIVE prode preskočiť (vzor pergola/bazén dopyt test).
	await skipAkLive(page);

	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/zimna-zahrada');

	// zmeň model na MASSIVE (karta) → aria-pressed sa prepne
	await page.getByTestId('zz-model-MASSIVE').click();
	await expect(page.getByTestId('zz-model-MASSIVE')).toHaveAttribute('aria-pressed', 'true');

	// zmeň rozmery → súhrn LIVE reaguje (klientsky $derived). Rozmerové polia sú METROVÉ steppery
	// (#333 RozmerStepper): fill je v METROCH („6" = 6000 mm), súhrn ostáva v mm.
	await page.getByTestId('zz-sirka').fill('6');
	await page.getByTestId('zz-sirka').blur();
	await page.getByTestId('zz-hlbka').fill('4');
	await page.getByTestId('zz-hlbka').blur();
	await expect(page.getByTestId('zz-suhrn-rozmery')).toHaveText('6000 × 4000 mm');

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

test('zimná záhrada: farba select + výška stepper +/− + default ROBUST tam-späť + scroll-CTA, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/zimna-zahrada');

	// farba select
	const farbaSelect = page.getByTestId('zz-farba');
	await expect(farbaSelect).toBeVisible();
	const farbaOpts = await farbaSelect
		.locator('option')
		.evaluateAll((els) => els.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
	expect(farbaOpts.length).toBeGreaterThan(1);
	await farbaSelect.selectOption(farbaOpts[1]!);
	await expect(farbaSelect).toHaveValue(farbaOpts[1]!);

	// výška stepper +/−
	const vyskaInput = page.getByTestId('zz-vyska');
	await expect(vyskaInput).toBeVisible();
	const initialVyska = await vyskaInput.inputValue();
	await page.getByRole('button', { name: 'Zväčšiť výšku' }).click();
	const afterIncVyska = await vyskaInput.inputValue();
	expect(afterIncVyska).not.toBe(initialVyska);
	await page.getByRole('button', { name: 'Zmenšiť výšku' }).click();
	await expect(vyskaInput).toHaveValue(initialVyska);

	// default ROBUST tam-späť (PARTIAL requirement #463)
	await page.getByTestId('zz-model-MASSIVE').click();
	await expect(page.getByTestId('zz-model-MASSIVE')).toHaveAttribute('aria-pressed', 'true');
	await page.getByTestId('zz-model-ROBUST').click();
	await expect(page.getByTestId('zz-model-ROBUST')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('zz-model-MASSIVE')).toHaveAttribute('aria-pressed', 'false');

	// scroll-CTA „Nezáväzný dopyt →"
	const scrollCta = page.getByText(/Nezáväzný dopyt/).first();
	await expect(scrollCta).toBeVisible();
	await scrollCta.click();
	await expect(page.getByTestId('dopyt')).toBeInViewport();

	expect(consoleMsgs).toEqual([]);
});
