// #123 ROZHODNUTÉ — Patrik (Odoo 207, msg #1646652, 2026-08-09): checkbox
// „Prídavná koľajnica" pri zapnutej sieťke na 2K „Štandard +" nič navyše
// nemení — sieťka sama vynúti celú 3K sadu, ktorá spodnú (jediné, čo prídavná
// pridáva) už obsahuje. Tento test overuje cez REÁLNY formulár: (1) hláška vedľa
// sieťky hovorí pravdu namiesto klamúceho sľubu, (2) checkbox OSTÁVA zaškrtnuteľný
// (nezakázaný/neschovaný), (3) nárezák naozaj ukazuje 3K koľajnice (horná aj
// spodná) — Money odpis sa nemení. Náhľad ("Spočítať") nezapisuje do Money → môže
// bežať aj proti LIVE (rovnaký vzor ako e2e/sietka-standard.spec.ts).
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated, vyberFarbuKovania } from './helpers';

const RUN = `E2E-PVS-${Date.now().toString(36).toUpperCase()}`;

test('Štandard + | 2K | sieťka ON | prídavná ON: hláška hovorí pravdu, checkbox ostáva zaškrtnutý, odpis je 3K/3K', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-A`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Prídavná v sieťke');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('1850');

	// zapni prídavnú PRED sieťkou — hláška musí zareagovať na obidve poradia
	await page.getByLabel(/Prídavná koľajnica/).check();
	await page.locator('#sietka-on').check();

	// hláška vedľa sieťky hovorí, že prídavná tu nič navyše nezmení
	const hint = page.getByTestId('sietka-pridavna-v-sietke');
	await expect(hint).toBeVisible();
	await expect(hint).toContainText('3K');
	await expect(hint).toContainText(/[Nn]echaj ju zaškrtnutú/);

	// checkbox OSTÁVA zaškrtnutý a interaktívny — nič ho nezakázalo/neschovalo
	const checkbox = page.getByLabel(/Prídavná koľajnica/);
	await expect(checkbox).toBeVisible();
	await expect(checkbox).toBeEnabled();
	await expect(checkbox).toBeChecked();

	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// preview karta zopakuje tú istú pravdu
	await expect(page.getByTestId('pridavna-v-sietke-karta')).toContainText('3K');

	// odpis: obidve koľajnice na 3K (presne ako len sieťka samotná, bez pridania 4K)
	await expect(page.locator('.row', { hasText: 'ZASP00027' })).toBeVisible(); // horná 3K
	await expect(page.locator('.row', { hasText: 'ZASP00030' })).toBeVisible(); // spodná 3K
	await expect(page.locator('.row', { hasText: 'ZASP00107' })).toHaveCount(0); // horná 2K preč
	await expect(page.locator('.row', { hasText: 'ZASP00104' })).toHaveCount(0); // spodná 2K preč
	await expect(page.locator('.row', { hasText: 'ZASP00033' })).toHaveCount(0); // žiadne 4K

	expect(errs).toEqual([]);
});

test('Štandard + | 2K | sieťka ON | prídavná OFF: hláška existuje aj bez zaškrtnutej prídavnej, iné znenie', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-B`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Prídavná v sieťke bez zaškrtnutia');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('1850');

	await page.locator('#sietka-on').check();

	const hint = page.getByTestId('sietka-pridavna-v-sietke');
	await expect(hint).toBeVisible();
	await expect(hint).toContainText('3K');
	await expect(hint).not.toContainText('Nechaj ju zaškrtnutú');

	const checkbox = page.getByLabel(/Prídavná koľajnica/);
	await expect(checkbox).toBeVisible();
	await expect(checkbox).not.toBeChecked();

	expect(errs).toEqual([]);
});

test('Štandard + | 3K | sieťka ON: žiadna „už zahrnuté" hláška — mimo 2K gate', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('3K');
	await page.locator('#sietka-on').check();

	await expect(page.getByTestId('sietka-pridavna-v-sietke')).toHaveCount(0);

	expect(errs).toEqual([]);
});

test('zimná záhrada: order-level prídavná × sieťka na EXTRA posuve (nie primárnom) — hláška aj náhľad', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-MULTI`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Prídavná multi');
	// primárny posuv = Štandard + (nesie order-level checkbox „prídavná koľajnica")
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('1850');
	await page.getByLabel(/Prídavná koľajnica/).check();

	// extra posuv — tiež Štandard + | 2K, so zapnutou sieťkou
	await page.getByRole('button', { name: /Pridať posuv/ }).click();
	await page.locator('#ps0-sys').selectOption('Štandard +');
	await page.locator('#ps0-styl').selectOption('2K');
	await page.locator('#ps0-s').fill('3000');
	await page.locator('#ps0-v').fill('1850');
	await page.locator('#ps0-sietka-on').check();

	// extra posuv hláška hovorí pravdu — order-level prídavná platí aj preň
	const hint = page.getByTestId('ps0-sietka-pridavna-v-sietke');
	await expect(hint).toBeVisible();
	await expect(hint).toContainText('3K');

	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// spoločný náhľad (multi) zopakuje tú istú pravdu pre posuv 2
	await expect(page.getByTestId('pridavna-v-sietke-multi-1')).toContainText('3K');

	expect(errs).toEqual([]);
});
