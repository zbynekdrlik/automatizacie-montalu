// Sieťka na posuve (#86–#90) — Patrik 2026-07-31: zaškrtávacie pole „so sieťkou"
// pridá rám navyše na poslednej koľaji + úchyt namiesto kľučky; display-only, do
// Money odpisu zatiaľ nejde (kódy/kusy ešte nie sú potvrdené).
//
// Všetko ČÍTACIE: formulár + „Spočítať" (?/nahlad, ?/nahladMulti) len počítajú,
// nezapisujú odpis → dá sa pustiť aj proti nasadenej appke (BASE_URL).
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated, goto } from './helpers';

async function zaklad(page: Page, zak: string, zakaznik: string, styl = '3K') {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill(zakaznik);
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', styl);
	await page.locator('#s').fill('4645');
	await page.locator('#v').fill('2320');
}

/** riadky karty „Odpis (do Money)" — dôkaz Money-neutrality sieťky */
async function odpisRiadky(page: Page): Promise<string[]> {
	const karta = page.locator('.card', { hasText: 'Odpis (do Money)' }).first();
	return (await karta.locator('.row').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
}

test('sieťka: zapínač je len pri Robust/Slide, na inom systéme zmizne aj vynuluje sa', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.selectOption('#system', 'Robust');
	await expect(page.locator('#sietka-on')).toBeVisible();
	await page.locator('#sietka-on').check();
	await expect(page.getByTestId('sietka-box')).toBeVisible();

	// Deluxe sieťku neponúka — zapínač zmizne a stav sa vynuluje (nezostane
	// „duchom" pri prepnutí späť na Robust)
	await page.selectOption('#system', 'Deluxe');
	await expect(page.locator('#sietka-on')).toHaveCount(0);
	await page.selectOption('#system', 'Robust');
	await expect(page.locator('#sietka-on')).not.toBeChecked();

	expect(errs).toEqual([]);
});

test('jeden posuv: sieťka je v karte plánu, v náhľade a Money odpis je NEZMENENÝ', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	// (1) najprv BEZ sieťky — referenčný odpis
	await zaklad(page, 'E2E-SIETKA', 'E2E Sietka');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	const bezSietky = await odpisRiadky(page);
	expect(bezSietky.length).toBeGreaterThan(0);
	await expect(page.getByTestId('nahlad-sietka')).toHaveCount(0);
	await expect(page.getByTestId('sietka-karta')).toHaveCount(0);

	// (2) to isté zadanie so sieťkou
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.locator('#sietka-on').check();
	await page.locator('#sietka-sirka').fill('1200');
	await page.locator('#sietka-vyska').fill('1450');
	await page.locator('#sietka-uchyt').selectOption('madloVelke');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// sieťka nakreslená v náhľade (orientačný pruh — presná geometria nie je
	// potvrdená, len ktorá strana)
	await expect(page.getByTestId('nahlad-sietka')).toBeVisible();

	// karta plánu nesie stranu + rozmer + úchyt
	const karta = page.getByTestId('sietka-karta');
	await expect(karta).toContainText('pravá'); // P - L → sieťka vpravo
	await expect(karta).toContainText('1200');
	await expect(karta).toContainText('1450');
	await expect(karta).toContainText('vystúpené madlo veľké');

	// MONEY-NEUTRALITA: sieťka nesmie pridať/zmeniť ani jeden odpisový riadok
	expect(await odpisRiadky(page)).toEqual(bezSietky);

	expect(errs).toEqual([]);
});

test('sieťka: kľučka sa neponúka, keď je sieťka zapnutá (#88)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-KOV', 'E2E Sietka kovanie');
	await expect(page.locator('#kovanieL')).toBeVisible();
	await page.locator('#kovanieL').selectOption('Obojstranná kľučka bez FAB');

	await page.locator('#sietka-on').check();
	await expect(page.locator('#kovanieL')).toHaveCount(0);
	await expect(page.locator('#kovanieP')).toHaveCount(0);

	// odškrtnutie sieťky kľučku znova ponúkne (ale hodnota sa nevracia — bola
	// vynulovaná spolu so zapnutím sieťky)
	await page.locator('#sietka-on').uncheck();
	await expect(page.locator('#kovanieL')).toBeVisible();
	await expect(page.locator('#kovanieL')).toHaveValue('');

	expect(errs).toEqual([]);
});

test('sieťka na 2K posuve ukáže upozornenie na 3K koľajnicu (#87), Money sa nemení', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-2K', 'E2E Sietka 2K', '2K');
	await page.locator('#sietka-on').check();
	await expect(page.getByTestId('sietka-2k-warn')).toContainText('3K koľajnica');

	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	await expect(page.getByTestId('sietka-2k-warn-karta')).toContainText('3K');
	// odpisová karta neobsahuje žiadnu zmienku o zámene — dôkaz Money-neutrality
	const odpis = (await odpisRiadky(page)).join(' ');
	expect(odpis).not.toMatch(/3K/);

	expect(errs).toEqual([]);
});

test('sieťka prežije „← Späť a upraviť" (rozmer aj úchyt)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-B', 'E2E Sietka spat');
	await page.locator('#sietka-on').check();
	await page.locator('#sietka-sirka').fill('1180');
	await page.locator('#sietka-vyska').fill('1420');
	await page.locator('#sietka-uchyt').selectOption('zamok');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);

	await expect(page.locator('#sietka-on')).toBeChecked();
	await expect(page.locator('#sietka-sirka')).toHaveValue('1180');
	await expect(page.locator('#sietka-vyska')).toHaveValue('1420');
	await expect(page.locator('#sietka-uchyt')).toHaveValue('zamok');

	expect(errs).toEqual([]);
});

test('viac posuvov: sieťka má len ten posuv, ktorý ju má zapnutú', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-M', 'E2E Sietka multi');
	await page.getByRole('button', { name: '➕ Pridať posuv' }).click();
	await page.locator('#ps0-s').fill('4365');
	await page.locator('#ps0-v').fill('2320');
	// sieťka len na DRUHOM posuve (primárny ostáva bez nej)
	await page.locator('#ps0-sietka-on').check();
	await page.locator('#ps0-sietka-sirka').fill('1300');
	await page.locator('#ps0-sietka-vyska').fill('1500');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await expect(page.getByTestId('nahlad-sietka')).toHaveCount(1);
	const karta = page.getByTestId('sietka-karta-multi');
	await expect(karta).toContainText('Posuv 2');
	await expect(karta).not.toContainText('Posuv 1 ');
	await expect(karta).toContainText('1300 × 1500 mm');

	expect(errs).toEqual([]);
});

test('samostatná stránka /sietka: dodatočná sieťka bez posuvu, rám 2 ks + 2 ks, žiadne Odoslať do Money', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await goto(page, '/sietka');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-SIETKA-SOLO');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Sietka solo');
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '2K');
	await page.locator('#otvorS').fill('1500');
	await page.locator('#otvorV').fill('1400');
	await page.getByTestId('spocitat-sietku').click();
	await waitHydrated(page);

	await expect(page.getByTestId('ram-profil')).toHaveText('2 ks + 2 ks');
	// 2K posuv → tabuľka upozornenia na 3K koľajnicu
	await expect(page.getByTestId('sietka-2k-tabulka')).toContainText('3K');
	// žiadne tlačidlo pre zápis do Money nikde na stránke
	await expect(page.getByRole('button', { name: /Odoslať/ })).toHaveCount(0);

	expect(errs).toEqual([]);
});

test('/sietka je v nav odkazoch a b2b naň nie je presmerovaný preč', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await expect(page.getByRole('link', { name: 'Sieťka' })).toBeVisible();

	// b2b throwaway účet (rovnaký vzor ako app.spec.ts B2B test) — over, že /sietka
	// nepresmeruje preč (Patrik #89: „hlavne pre externých")
	page.on('dialog', (d) => d.accept());
	const b2bUser = `e2e-sietka-b2b-${Date.now().toString(36)}`;
	const b2bPass = 'e2eheslo1';
	await goto(page, '/pouzivatelia');
	await page.getByLabel('Prihlasovacie meno').fill(b2bUser);
	await page.getByLabel('Heslo (min. 6 znakov)').fill(b2bPass);
	await page.getByRole('button', { name: 'Pridať B2B účet' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('vytvorený');

	await page.getByRole('button', { name: 'Odhlásiť' }).click();
	await expect(page).toHaveURL(/\/login/);
	await loginAs(page, b2bUser, b2bPass);
	await expect(page.getByRole('link', { name: 'Sieťka' })).toBeVisible();
	await goto(page, '/sietka');
	await expect(page).toHaveURL(/\/sietka/);

	// upratanie
	await page.getByRole('button', { name: 'Odhlásiť' }).click();
	await expect(page).toHaveURL(/\/login/);
	await loginAs(page);
	await goto(page, '/pouzivatelia');
	await page.locator('tr', { hasText: b2bUser }).getByRole('button', { name: 'Zmazať' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('zmazaný');

	expect(errs).toEqual([]);
});
