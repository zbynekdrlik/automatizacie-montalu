// Odoo úloha 1459 (Patrik 22.10.2026): „Aj keď nemám koľajnicu navyše aj tak mi ju tam dáva" —
// starý „Štandard" IZO mal prídavnú spodnú koľajnicu natvrdo a checkbox „Prídavná koľajnica" pri
// ňom chýbal. Teraz sa správa ako Štandard +: checkbox je viditeľný, pri IZO skle predvolene
// zaškrtnutý (odpis ako doteraz — spodná o veľkosť väčšia), odškrtnutím spodná = horná.
//
// READ-ONLY: len „Spočítať nárezový plán" (náhľad) a „Späť a upraviť" — nič sa neodosiela do
// Money, preto beží aj proti PROD. Overujú sa Money KÓDY koľajníc (nie mm z výpočtu).
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated, vyberFarbuKovania, vyberSklo } from './helpers';

const IZO = 'Izolačné sklo 4/8/4 číre';
const FLOAT = 'Float sklo 6 mm';
const SKLO = 'Sklo (základ — určuje vzorec)';
const RUN = `E2E-1459-${Date.now().toString(36).slice(-5)}`;

const riadok = (page: Page, kod: string) => page.locator('.row', { hasText: kod });

async function hlavicka(page: Page, op: string) {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-${op}`);
	await page.getByLabel('OP/OPDL číslo *').fill(op);
	await page.getByLabel('Zákazník *').fill('E2E starý Štandard prídavná');
}

async function stary(page: Page, styl: string, sklo: string) {
	await page.getByLabel('Systém').selectOption('Štandard');
	await page.getByLabel('Štýl').selectOption(styl);
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2400');
	await vyberSklo(page.getByLabel(SKLO), sklo);
}

async function spocitat(page: Page) {
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
}

async function spat(page: Page) {
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
}

test('starý Štandard 3K IZO: checkbox viditeľný a zaškrtnutý → spodná 4K; odškrtnutý → spodná 3K', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, '01');
	await stary(page, '3K', IZO);

	const checkbox = page.getByLabel(/Prídavná koľajnica/);
	await expect(checkbox).toBeVisible();
	await expect(checkbox).toBeChecked();

	await spocitat(page);
	await expect(page.getByTestId('plan-badge')).toContainText('Starý štandard 3K IZO');
	await expect(riadok(page, 'ZASP00027')).toBeVisible(); // horná 3K
	await expect(riadok(page, 'ZASP00033')).toBeVisible(); // spodná 4K (prídavná)
	await expect(riadok(page, 'ZASP00030')).toHaveCount(0);

	await spat(page);
	await expect(checkbox).toBeChecked(); // „Späť a upraviť" zachová voľbu
	await checkbox.uncheck();
	await expect(checkbox).not.toBeChecked();

	await spocitat(page);
	await expect(riadok(page, 'ZASP00027')).toBeVisible(); // horná 3K
	await expect(riadok(page, 'ZASP00030')).toBeVisible(); // spodná 3K = horná
	await expect(riadok(page, 'ZASP00033')).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});

test('starý Štandard 3K s obyčajným sklom: checkbox viditeľný, predvolene NEzaškrtnutý → spodná 3K', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, '02');
	await stary(page, '3K', FLOAT);

	const checkbox = page.getByLabel(/Prídavná koľajnica/);
	await expect(checkbox).toBeVisible();
	await expect(checkbox).not.toBeChecked();

	await spocitat(page);
	await expect(riadok(page, 'ZASP00030')).toBeVisible();
	await expect(riadok(page, 'ZASP00033')).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});

test('zimná záhrada starý Štandard 3K IZO + 2K IZO: zaškrtnuté → 4K + 3K spodná; odškrtnuté → 3K + 2K', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, '03');
	await stary(page, '3K', IZO);

	await page.getByRole('button', { name: /Pridať zasklenie/ }).click();
	await page.locator('#ps0-sys').selectOption('Štandard');
	await page.locator('#ps0-styl').selectOption('2K');
	await vyberSklo(page.locator('#ps0-sklo'), IZO);
	await page.locator('#ps0-s').fill('2600');
	await page.locator('#ps0-v').fill('2400');

	const checkbox = page.getByLabel(/Prídavná koľajnica/);
	await expect(checkbox).toBeVisible();
	await expect(checkbox).toBeChecked();

	await spocitat(page);
	await expect(riadok(page, 'ZASP00033')).toBeVisible(); // spodná 4K (3K IZO + prídavná)
	await expect(riadok(page, 'ZASP00030')).toBeVisible(); // spodná 3K (2K IZO + prídavná)
	await expect(riadok(page, 'ZASP00104')).toHaveCount(0); // spodná 2K nikde

	await spat(page);
	await expect(checkbox).toBeChecked();
	await checkbox.uncheck();
	await expect(checkbox).not.toBeChecked();

	await spocitat(page);
	await expect(riadok(page, 'ZASP00030')).toBeVisible(); // spodná 3K pri 3K IZO
	await expect(riadok(page, 'ZASP00104')).toBeVisible(); // spodná 2K pri 2K IZO
	await expect(riadok(page, 'ZASP00033')).toHaveCount(0); // 4K nikde

	expect(consoleMsgs).toEqual([]);
});
