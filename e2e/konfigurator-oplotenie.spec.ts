// #388/#410: verejný konfigurátor hliníkového oplotenia a brán (`/konfigurator/oplotenie`) — E2E cez
// reálny prehliadač. Kľúčové: VEREJNÝ flow BEZ prihlásenia; konfigurácia (typ/model/rozmery/farba) sa
// počíta klientsky a zobrazí súhrn; #410 ORIENTAČNÁ cena — server-počítaná (`vypocet` akcia, enhance
// submit) po kliku, s porovnaním modelov; dopyt tok → PDF špecifikácia (s orientačnou cenou) na
// stiahnutie. GET aj `vypocet` sú Money-neutrálne (čítajú sa aj proti LIVE prode — žiadny zápis); dopyt
// je ZÁPIS (audit riadok) → `skipAkLive`. Každý test = NULA console chýb (× = U+00D7 byte-identické).
import { test, expect } from '@playwright/test';
import { goto, collectConsole, skipAkLive } from './helpers';

test('oplotenie konfigurátor: verejná route bez auth — súhrn + ORIENTAČNÁ cena na klik (porovnanie modelov), nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/oplotenie');
	await expect(page).toHaveURL(/\/konfigurator\/oplotenie$/);
	// dokument má SEO titul (#411 shell: <svelte:head> cez `titul` prop, nie prázdna záložka)
	await expect(page).toHaveTitle(/oplotenie a brány.*Montalu/);

	// stránka sa načíta bez prihlásenia (verejná route)
	await expect(page.getByRole('heading', { name: /Navrhni si hliníkové oplotenie/ })).toBeVisible();

	// default konfigurácia → súhrn je hneď viditeľný (výška 1500 × šírka 2000 mm)
	await expect(page.getByTestId('oplotenie-suhrn')).toBeVisible();
	await expect(page.getByTestId('oplotenie-suhrn-rozmery')).toHaveText('1500 × 2000 mm');

	// #410: orientačná cena sa zobrazí AŽ po kliku (server-počítaná, Money-neutrálna — read-only)
	await expect(page.getByTestId('oplotenie-cena')).toHaveCount(0);
	const responsePromise = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('vypocet')
	);
	await page.getByTestId('oplotenie-cena-zobrazit').click();
	await responsePromise;

	// cena + s DPH suma (€) + porovnanie 6 modelov
	await expect(page.getByTestId('oplotenie-cena')).toBeVisible();
	await expect(page.getByTestId('oplotenie-cena-sdph')).toContainText('€');
	await expect(page.getByTestId('oplotenie-porovnanie')).toBeVisible();
	await expect(page.getByTestId('oplotenie-porovnanie-ARIEL')).toBeVisible();
	await expect(page.getByTestId('oplotenie-porovnanie-REA')).toBeVisible();
	// deterministická default cena (diel/ARIEL 1,5×2,0 = MO 1134 net → 1 394,82 € s DPH). Regex kvôli
	// sk-SK tisícovej medzere (úzka nezlomiteľná — `\s` ju pokryje), nie krehký presný string.
	await expect(page.getByTestId('oplotenie-cena-sdph')).toHaveText(/1\s*394,82\s*€/);

	expect(consoleMsgs).toEqual([]);
});

test('oplotenie cena: zmena typu zneaktuálni zobrazenú cenu → „Prepočítať" → nová cena, nula console chýb', async ({
	page
}) => {
	// #410 review 🟡: 5-vstupový cenový kľúč (typ|model|výška|šírka|počet) — over `cenaAktualna` gating,
	// aby sa NIKDY nezobrazila cena pre iný vstup. Read-only (`vypocet`), žiadny zápis → bez skipAkLive.
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/oplotenie');

	// zobraz orientačnú cenu pre default (diel, ARIEL, 1500 × 2000)
	await page.getByTestId('oplotenie-cena-zobrazit').click();
	await expect(page.getByTestId('oplotenie-cena')).toBeVisible();

	// zmeň TYP → cena sa považuje za NEAKTUÁLNU (nikdy neukáž cenu pre iný vstup): blok zmizne,
	// tlačidlo sa vráti ako „Prepočítať" (#410 `cenaAktualna` gating)
	await page.getByTestId('oplotenie-typ-posuvna').click();
	await expect(page.getByTestId('oplotenie-cena')).toHaveCount(0);
	await expect(page.getByTestId('oplotenie-cena-zobrazit')).toContainText('Prepočítať');

	// prepočítaj → nová orientačná cena pre posuvnú bránu
	await page.getByTestId('oplotenie-cena-zobrazit').click();
	await expect(page.getByTestId('oplotenie-cena')).toBeVisible();
	await expect(page.getByTestId('oplotenie-cena-sdph')).toContainText('€');

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

test('oplotenie obálka (#427): cenníkový rozsah per-typ + „mimo rozsah" hláška + ATYP na mieru, nula console chýb', async ({
	page
}) => {
	// #427: per-typ cenníková obálka vystavená do UI (namiesto „nemej steny"). Read-only (žiadny POST →
	// žiadny zápis), takže bez `skipAkLive` — beží aj proti LIVE prode.
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator/oplotenie');

	// default typ = plotový diel → cenníkový rozsah (šírka do 3,5 m) je HNEĎ viditeľný a default rozmery
	// (1,5 × 2,0 m) sú v ňom → žiadna „mimo rozsah" hláška
	const obalka = page.getByTestId('oplotenie-obalka');
	await expect(obalka).toBeVisible();
	await expect(obalka).toContainText('plotový diel');
	await expect(obalka).toContainText('šírka 1,0');
	await expect(obalka).toContainText('3,5 m');
	await expect(page.getByTestId('oplotenie-obalka-mimo')).toHaveCount(0);

	// prepni na vchodovú bránku (užšia obálka, šírka do 1,5 m) → rozsah sa zmení; default šírka 2,0 m je
	// NAD ním → čestná „mimo rozsah = na vyžiadanie" hláška sa zobrazí (namiesto nemej individuálnej steny)
	await page.getByTestId('oplotenie-typ-branka').click();
	await expect(obalka).toContainText('vchodová bránka');
	await expect(obalka).toContainText('1,5 m');
	await expect(page.getByTestId('oplotenie-obalka-mimo')).toBeVisible();

	// ATYP výplň = oplotenie na mieru → obálka sa nahradí hláškou o individuálnej cene (žiadny rozsah)
	await page.getByTestId('oplotenie-model-ATYP').click();
	await expect(obalka).toContainText('na mieru');
	await expect(page.getByTestId('oplotenie-obalka-mimo')).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});
