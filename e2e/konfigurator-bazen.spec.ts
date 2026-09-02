// #385/#404/#405: verejný konfigurátor bazénových zastrešení (`/konfigurator/bazen`) — E2E cez reálny
// prehliadač. Kľúčové: VEREJNÝ flow BEZ prihlásenia; konfigurácia (model/rozmery/koľaj/farba/výplň)
// sa počíta klientsky a zobrazí súhrn; #404 ORIENTAČNÁ CENA na klik (server-počítaná `vypocet`,
// Money-neutrálna — bez zápisu); dopyt tok → PDF špecifikácia s orientačnou cenou na stiahnutie. GET
// aj `vypocet` sú Money-neutrálne (číta sa aj proti LIVE prode); dopyt je ZÁPIS (audit riadok) →
// `skipAkLive`, nech proti prode nepribúdajú testovacie dopyty. Každý test = NULA console chýb
// (× = U+00D7 byte-identické).
//
// #405: pribudol ŽIVÝ 3D náhľad oblúkových segmentov (split-screen, ľavý sticky stĺpec). Form-testy
// čakajú na `[data-viz-ready="true"]` (helper `bazenReady`) PRED interakciou — sync-point ako pri
// pergole (softvérový CI WebGL je ~2.5× ťažší). Zero-console drží cez filtre v `helpers.ts`
// (GL-driver stall / net::ERR_ABORTED / CONTEXT_LOST_WEBGL loseContext — sankcionovaný teardown).
import { test, expect } from '@playwright/test';
import { goto, collectConsole, skipAkLive } from './helpers';

/** goto na bazén konfigurátor + počkaj na hydratáciu a pripravený 3D náhľad (rovnaký
 *  sync-point ako `konfReady` v pergolovom spec-e) — inak enhance/interakcia preteká s
 *  ešte-stavajúcou 3D scénou. */
async function bazenReady(page: import('@playwright/test').Page) {
	await goto(page, '/konfigurator/bazen');
	await expect(page.getByTestId('konf-baz-viz')).toBeVisible();
	await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 20000 });
}

test('bazén konfigurátor: verejná route bez auth — súhrn + orientačná cena po kliku + 3D náhľad, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await bazenReady(page);
	await expect(page).toHaveURL(/\/konfigurator\/bazen$/);

	// stránka sa načíta bez prihlásenia (verejná route)
	await expect(
		page.getByRole('heading', { name: /Navrhni si bazénové zastrešenie/ })
	).toBeVisible();

	// default konfigurácia → súhrn je hneď viditeľný (6000 × 4000 mm)
	await expect(page.getByTestId('bazen-suhrn')).toBeVisible();
	await expect(page.getByTestId('bazen-suhrn-rozmery')).toHaveText('6000 × 4000 mm');

	// #405: 3D náhľad je pripravený a deterministický signál odráža default rozmery (dĺžka×šírka)
	await expect(page.getByTestId('konf-baz-viz')).toHaveAttribute('data-viz-rozmer', '6000×4000');
	await expect(page.getByTestId('bazen-caption-rozmer')).toHaveText(
		'Bazénové zastrešenie 6000 × 4000 mm'
	);

	// #404: orientačná cena je na KLIK (server-počítaná) — pred klikom je len tlačidlo, žiadny € na stránke
	await expect(page.getByTestId('bazen-cena-zobrazit')).toBeVisible();
	await expect(page.locator('body')).not.toContainText('€');

	// klik → server vráti orientačnú MO cenu → cena (s DPH, €) + porovnanie modelov sa zobrazia
	await page.getByTestId('bazen-cena-zobrazit').click();
	await expect(page.getByTestId('bazen-cena')).toBeVisible();
	await expect(page.getByTestId('bazen-cena')).toContainText('Orientačná cena');
	await expect(page.getByTestId('bazen-cena-sdph')).toContainText('€');
	await expect(page.getByTestId('bazen-porovnanie')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

test('bazén cena: zmena rozmeru zneaktuálni zobrazenú cenu → „Prepočítať" → nová cena, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	// klik na cenu až po viz-ready (split-screen 3D beží aj tu — enhance inak preteká s 3D scénou)
	await bazenReady(page);

	// zobraz orientačnú cenu pre default (6000 × 4000)
	await page.getByTestId('bazen-cena-zobrazit').click();
	await expect(page.getByTestId('bazen-cena')).toBeVisible();

	// zmeň dĺžku → cena sa považuje za NEAKTUÁLNU (nikdy neukáž cenu pre iný rozmer): blok zmizne,
	// tlačidlo sa vráti ako „Prepočítať" (#404 `cenaAktualna` gating)
	await page.getByTestId('bazen-dlzka').fill('9');
	await page.getByTestId('bazen-dlzka').blur();
	await expect(page.getByTestId('bazen-cena')).toHaveCount(0);
	await expect(page.getByTestId('bazen-cena-zobrazit')).toContainText('Prepočítať');

	// prepočítaj → nová orientačná cena pre 9000 × 4000
	await page.getByTestId('bazen-cena-zobrazit').click();
	await expect(page.getByTestId('bazen-cena')).toBeVisible();
	await expect(page.getByTestId('bazen-cena-sdph')).toContainText('€');

	expect(consoleMsgs).toEqual([]);
});

test('bazén konfigurátor: zmena rozmerov → ŽIVÝ 3D náhľad sa aktualizuje (debounced signál + caption), nula console chýb', async ({
	page
}) => {
	test.setTimeout(60000); // softvérový CI WebGL rebuild pri {#key} remounte je pomalý

	const consoleMsgs = collectConsole(page);
	await bazenReady(page);

	// štartová hodnota deterministického signálu (dĺžka×šírka, × = U+00D7)
	await expect(page.getByTestId('konf-baz-viz')).toHaveAttribute('data-viz-rozmer', '6000×4000');

	// zmeň dĺžku → 3D sa DEBOUNCED (~320 ms) prekreslí. Rozmerové pole je METROVÝ stepper
	// (#333 RozmerStepper): fill je v METROCH („9" = 9000 mm).
	await page.getByTestId('bazen-dlzka').fill('9');
	await page.getByTestId('bazen-dlzka').blur();

	// súhrn (klientsky $derived) reaguje hneď
	await expect(page.getByTestId('bazen-suhrn-rozmery')).toHaveText('9000 × 4000 mm');

	// #361 vzor: čakáme na DETERMINISTICKÝ, od-GL-frame ODPOJENÝ signál `data-viz-rozmer` na
	// STABILNOM `konf-baz-viz` uzle (mimo `{#key}` bloku) + caption vnútri remountu, oboje s
	// veľkorysým budgetom (nie arbitrárny fixný poll).
	await expect(page.getByTestId('konf-baz-viz')).toHaveAttribute('data-viz-rozmer', '9000×4000', {
		timeout: 30000
	});
	await expect(page.getByTestId('bazen-caption-rozmer')).toHaveText(
		'Bazénové zastrešenie 9000 × 4000 mm',
		{ timeout: 30000 }
	);
	// 3D ostáva pripravený po refit-remounte
	await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 20000 });

	// #405 in-place update (bez remountu): zmena počtu segmentov mení GEOMETRIU (počet oblúkov) →
	// caption sa aktualizuje cez geometrickyPodpis prestavbu; zmena výplne mení len materiál.
	await page.getByTestId('bazen-segmenty').selectOption('6');
	await expect(page.getByTestId('bazen-caption')).toContainText('6 segmentov', { timeout: 30000 });
	await page.getByTestId('bazen-vypln').selectOption('Opálový (mliečny) polykarbonát');
	await expect(page.getByTestId('bazen-caption')).toContainText('Opálový', { timeout: 30000 });

	// leak guard: presne 1 živý WebGL kontext po {#key} remounte + in-place zmenách — priamy dôkaz,
	// že reštrukturalizovaný wall-disposal blok (zobrazStena gate) + nová rodina nenechajú kontext unikať.
	const vizKontexty = await page.evaluate(
		() => (window as unknown as { __VIZ_CONTEXTS?: number }).__VIZ_CONTEXTS
	);
	expect(vizKontexty).toBe(1);

	expect(consoleMsgs).toEqual([]);
});

test('bazén konfigurátor: zmena modelu + rozmeru → súhrn sa aktualizuje → dopyt → PDF na stiahnutie, nula console chýb', async ({
	page
}) => {
	// zápisový tok (audit riadok do `dopyt`) — proti LIVE prode preskočiť (vzor pergola dopyt test).
	await skipAkLive(page);

	const consoleMsgs = collectConsole(page);
	await bazenReady(page);

	// zmeň model na Exclusive (segmentová karta) → aria-pressed sa prepne
	await page.getByTestId('bazen-model-Exclusive').click();
	await expect(page.getByTestId('bazen-model-Exclusive')).toHaveAttribute('aria-pressed', 'true');

	// zmeň rozmery → súhrn LIVE reaguje (klientsky $derived). Rozmerové polia sú METROVÉ steppery
	// (#333 RozmerStepper): fill je v METROCH („9" = 9000 mm), súhrn ostáva v mm.
	await page.getByTestId('bazen-dlzka').fill('9');
	await page.getByTestId('bazen-dlzka').blur();
	await page.getByTestId('bazen-sirka').fill('5');
	await page.getByTestId('bazen-sirka').blur();
	await expect(page.getByTestId('bazen-suhrn-rozmery')).toHaveText('9000 × 5000 mm');

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
