// #385/#404/#405/#422: verejný konfigurátor bazénových zastrešení (`/konfigurator/bazen`) — E2E cez
// reálny prehliadač. Kľúčové: VEREJNÝ flow BEZ prihlásenia; konfigurácia (model/rozmery/koľaj/farba/
// výplň) sa počíta klientsky a zobrazí súhrn; #404 ORIENTAČNÁ CENA na klik (server-počítaná `vypocet`,
// Money-neutrálna — bez zápisu); dopyt tok → PDF špecifikácia s orientačnou cenou na stiahnutie; #422
// ZÁVÄZNÁ OBJEDNÁVKA (vzor pergolovej #319, MIMO dopyt formu) → fakturačné údaje + súhlas → PDF na
// stiahnutie. GET aj `vypocet` sú Money-neutrálne (číta sa aj proti LIVE prode); dopyt/objednávka sú
// ZÁPIS (audit riadok) → `skipAkLive`, nech proti prode nepribúdajú testovacie dopyty/objednávky.
// Každý test = NULA console chýb (× = U+00D7 byte-identické).
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

// #422 (vzor pergolovej #319): ZÁVÄZNÁ OBJEDNÁVKA (MO, neprihlásený). Súhrn → objednávková sekcia
// (MIMO dopyt formu) → kontakt + fakturačné údaje + súhlas → PDF na stiahnutie + potvrdenie.
// Zápisový tok (uloží objednávku) → proti LIVE prode preskočiť (skipAkLive), nech nepribúdajú
// testovacie objednávky. Money-neutrálne (žiadna platobná brána, žiadny odpis), nula console chýb.
test('bazén konfigurátor: objednávka (MO) — súhrn → záväzná objednávka → PDF na stiahnutie, nula console chýb', async ({
	page
}) => {
	await skipAkLive(page);
	const consoleMsgs = collectConsole(page);
	await bazenReady(page);

	// zmeň model + rozmery → súhrn LIVE reaguje (klientsky $derived)
	await page.getByTestId('bazen-model-Exclusive').click();
	await page.getByTestId('bazen-dlzka').fill('9');
	await page.getByTestId('bazen-dlzka').blur();
	await page.getByTestId('bazen-sirka').fill('5');
	await page.getByTestId('bazen-sirka').blur();
	await expect(page.getByTestId('bazen-suhrn-rozmery')).toHaveText('9000 × 5000 mm');

	// objednávková sekcia (voliteľný krok „záväzne objednať", mimo dopyt formu)
	const objednavka = page.getByTestId('objednavka');
	await expect(objednavka).toBeVisible();
	await expect(objednavka.getByRole('heading', { name: /záväzne objednať/i })).toBeVisible();

	// kontakt — JASNE OZNAČENÁ testovacia objednávka (honeypot `firma_web` nechávame prázdny)
	await objednavka.getByLabel(/Meno a priezvisko/).fill('TEST E2E — ignorovať');
	await objednavka.getByLabel(/^E-mail/).fill('test-e2e@example.com');
	await objednavka.getByLabel(/Telefón/).fill('+421900000000');
	await objednavka.getByLabel(/Miesto stavby/).fill('83101 Bratislava');
	// fakturačné údaje
	await objednavka.getByLabel(/Meno alebo firma/).fill('TEST E2E s.r.o.');
	await objednavka.getByLabel(/Fakturačná adresa/).fill('Testovacia 1, 83101 Bratislava');
	await objednavka.getByLabel(/^IČO/).fill('12345678');
	await objednavka.getByLabel(/DIČ/).fill('SK1234567890');
	// súhlas s podmienkami je POVINNÝ — bez neho server objednávku odmietne
	await objednavka.getByTestId('objednavka-suhlas').check();

	const responsePromise = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('objednavka')
	);
	const downloadPromise = page.waitForEvent('download');
	await objednavka.getByTestId('objednavka-odoslat').click();

	const response = await responsePromise;
	expect(response.ok()).toBe(true);
	const download = await downloadPromise; // PDF špecifikácia objednávky sa reálne stiahla
	expect(download.suggestedFilename()).toMatch(/^Montalu-objednavka-\d{4}-\d{2}-\d{2}\.pdf$/);

	// potvrdenie úspechu (formulár nahradený poďakovaním)
	await expect(page.getByTestId('objednavka-ok')).toBeVisible();
	await expect(page.getByText('Ďakujeme! Objednávku sme prijali.')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

test('bazén obálka (#427): cenníkový rozsah per-model + „mimo rozsah" hláška, nula console chýb', async ({
	page
}) => {
	// #427: per-model cenníková obálka vystavená do UI (namiesto „nemej steny"). Read-only (žiadny POST),
	// takže bez `skipAkLive`. `bazenReady` = sync-point na 3D viz (split-screen), inak interakcia preteká.
	const consoleMsgs = collectConsole(page);
	await bazenReady(page);

	// default model = Premier → cenníkový rozsah (šírka do 6,0 m) je HNEĎ viditeľný; default rozmery
	// (6,0 × 4,0 m) sú v ňom → žiadna „mimo rozsah" hláška
	const obalka = page.getByTestId('bazen-obalka');
	await expect(obalka).toBeVisible();
	await expect(obalka).toContainText('Premier');
	await expect(obalka).toContainText('šírka 2,0');
	await expect(obalka).toContainText('6,0 m');
	await expect(page.getByTestId('bazen-obalka-mimo')).toHaveCount(0);
	// info vetva (v rozsahu) — celá veta vrátane oddeľovacej medzery pred inline spanom
	// (stráži {#if}-whitespace pascu, testing.md: „Svelte prehltne medzeru okolo {#if}")
	await expect(obalka).toContainText('m. Väčšie rozmery pripravíme ako cenu na vyžiadanie.');

	// prepni na Star (užšia obálka, šírka do 4,5 m) → rozsah sa zmení
	await page.getByTestId('bazen-model-Star').click();
	await expect(obalka).toContainText('Star');
	await expect(obalka).toContainText('4,5 m');

	// zadaj šírku 5,0 m (NAD Star obálku 4,5 m) → čestná „mimo rozsah = na vyžiadanie" hláška
	await page.getByTestId('bazen-sirka').fill('5');
	await page.getByTestId('bazen-sirka').blur();
	await expect(page.getByTestId('bazen-obalka-mimo')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});
