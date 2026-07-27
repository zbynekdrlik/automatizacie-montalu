// Klín nad posuvom — Patrik 2026-07-27: „Posuv 1 → kliknem že chcem klín, zadám
// výšku 1, výšku 2 a šírku; nemusí to nič meniť, len čísla nech tam sú a ideálne
// nech sa zobrazia vizuálne pri sklách." + „možnosť pridať klín a nakliknúť koľko
// potrebujem" (počet ks).
//
// Všetko ČÍTACIE: formulár + „Spočítať" (?/nahlad, ?/nahladMulti) len počítajú,
// nezapisujú odpis ani nemenia konfiguráciu → dá sa pustiť aj proti nasadenej
// appke (BASE_URL). „Odoslať odpis" tu nikdy nepadne.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated } from './helpers';

async function zaklad(page: Page, zak: string, zakaznik: string) {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill(zakaznik);
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '3K');
	await page.locator('#s').fill('4645');
	await page.locator('#v').fill('2320');
}

/** riadky karty „Odpis (do Money)" — dôkaz Money-neutrality klina */
async function odpisRiadky(page: Page): Promise<string[]> {
	const karta = page.locator('.card', { hasText: 'Odpis (do Money)' }).first();
	return (await karta.locator('.row').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
}

test('klín: zapnutie predvyplní dĺžku šírkou posuvu, polia sa dajú prepísať', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	// vypnutý klín = žiadne polia (dielňa ho väčšinou nepotrebuje)
	await expect(page.getByTestId('klin-box')).toHaveCount(0);

	await page.locator('#s').fill('4645');
	await page.locator('#klin-on').check();
	await expect(page.getByTestId('klin-box')).toBeVisible();
	// klín zvyčajne beží po celej šírke posuvu → predvolená dĺžka = šírka
	await expect(page.locator('#klin-dlzka')).toHaveValue('4645');
	await expect(page.locator('#klin-ks')).toHaveValue('1');

	// kratší klín sa dá zadať ručne
	await page.locator('#klin-dlzka').fill('3000');
	await expect(page.locator('#klin-dlzka')).toHaveValue('3000');

	// vypnutie polia skryje
	await page.locator('#klin-on').uncheck();
	await expect(page.getByTestId('klin-box')).toHaveCount(0);

	expect(errs).toEqual([]);
});

test('jeden posuv: klín je v náhľade aj v karte plánu a Money odpis je NEZMENENÝ', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	// (1) najprv BEZ klina — referenčný odpis
	await zaklad(page, 'E2E-KLIN', 'E2E Klin');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	const bezKlina = await odpisRiadky(page);
	expect(bezKlina.length).toBeGreaterThan(0);
	await expect(page.getByTestId('nahlad-klin')).toHaveCount(0);
	await expect(page.getByTestId('klin-karta')).toHaveCount(0);

	// (2) to isté zadanie s klinom
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.locator('#klin-on').check();
	await page.locator('#klin-dlzka').fill('4645');
	await page.locator('#klin-sirka').fill('250');
	await page.locator('#klin-v1').fill('350');
	await page.locator('#klin-v2').fill('120');
	await page.locator('#klin-ks').fill('2');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// klín nakreslený v náhľade, s číslami (Patrik: „len čísla nech tam sú")
	const kresba = page.getByTestId('nahlad-klin');
	await expect(kresba).toBeVisible();
	await expect(kresba).toContainText('4645');
	await expect(kresba).toContainText('350');
	await expect(kresba).toContainText('120');
	await expect(kresba).toContainText('250');
	await expect(kresba).toContainText('2 ks');

	// karta plánu (ide aj do tlače) nesie všetky štyri kóty + počet
	const karta = page.getByTestId('klin-karta');
	await expect(karta).toContainText('4645 mm');
	await expect(karta).toContainText('250 mm');
	await expect(karta).toContainText('350 mm');
	await expect(karta).toContainText('120 mm');
	await expect(karta).toContainText('2 ks');

	// MONEY-NEUTRALITA: klín nesmie pridať/zmeniť ani jeden odpisový riadok
	expect(await odpisRiadky(page)).toEqual(bezKlina);

	expect(errs).toEqual([]);
});

test('klín prežije „← Späť a upraviť" (vrátane počtu kusov)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-KLIN-B', 'E2E Klin spat');
	await page.locator('#klin-on').check();
	await page.locator('#klin-sirka').fill('250');
	await page.locator('#klin-v1').fill('400');
	await page.locator('#klin-v2').fill('0');
	await page.locator('#klin-ks').fill('3');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);

	await expect(page.locator('#klin-on')).toBeChecked();
	await expect(page.locator('#klin-dlzka')).toHaveValue('4645');
	await expect(page.locator('#klin-sirka')).toHaveValue('250');
	await expect(page.locator('#klin-v1')).toHaveValue('400');
	await expect(page.locator('#klin-v2')).toHaveValue('0');
	await expect(page.locator('#klin-ks')).toHaveValue('3');

	expect(errs).toEqual([]);
});

test('viac posuvov: klín má len ten posuv, ktorý ho má zapnutý', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-KLIN-M', 'E2E Klin multi');
	await page.getByRole('button', { name: '➕ Pridať posuv' }).click();
	await page.locator('#ps0-s').fill('4365');
	await page.locator('#ps0-v').fill('2320');
	// klín len na DRUHOM posuve (primárny ostáva bez klina)
	await page.locator('#ps0-klin-on').check();
	await expect(page.locator('#ps0-klin-dlzka')).toHaveValue('4365');
	await page.locator('#ps0-klin-sirka').fill('200');
	await page.locator('#ps0-klin-v1').fill('300');
	await page.locator('#ps0-klin-v2').fill('80');
	await page.locator('#ps0-klin-ks').fill('2');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// jeden náhľad s klinom (druhý posuv), primárny bez neho
	await expect(page.getByTestId('nahlad-klin')).toHaveCount(1);
	await expect(page.getByTestId('nahlad-klin')).toContainText('4365');

	// súhrnná karta klinov pomenuje posuv
	const karta = page.getByTestId('klin-karta-multi');
	await expect(karta).toContainText('Posuv 2');
	await expect(karta).not.toContainText('Posuv 1');
	await expect(karta).toContainText('2× klín 4365 × 200 mm, výška 300 → 80 mm');

	expect(errs).toEqual([]);
});

test('klín: obídená HTML5 validácia → serverová chyba, plán sa nespočíta', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-KLIN-VAL', 'E2E Klin validacia');
	await page.locator('#klin-on').check();
	await page.locator('#klin-sirka').fill('250');
	// obe výšky 0 = to nie je klín; klon poľa bez min/max obíde HTML5 validáciu
	for (const id of ['#klin-v1', '#klin-v2']) {
		const el = page.locator(id);
		await el.evaluate((n) => {
			n.removeAttribute('min');
			n.removeAttribute('max');
		});
		await el.fill('0');
	}
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await expect(page.getByTestId('form-error')).toContainText('Klín');
	await expect(page.getByTestId('form-error')).toContainText('aspoň jednu výšku');
	// plán sa nezobrazil (ostávame vo formulári)
	await expect(page.getByTestId('klin-karta')).toHaveCount(0);
	await expect(page.locator('.card', { hasText: 'Odpis (do Money)' })).toHaveCount(0);

	expect(errs).toEqual([]);
});
