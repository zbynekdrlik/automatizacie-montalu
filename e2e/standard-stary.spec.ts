// Starší systém „Štandard" (bez plus) — Patrik 2026-07-27. Kompletný tok cez prehliadač:
// systém sa dá vybrať, sklo vyberá basic/IZO nárezák a plán ukazuje presne tie profily,
// ktoré má nárezák dielne (rám ZASP00018 + dorazový ZASP00021, IZO navyše „U" ZASP202439).
//
// Všetko READ-ONLY — len „Spočítať nárezový plán", nič sa neodosiela do Money.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated, vyberFarbuKovania } from './helpers';

const RUN = `E2E-STD-${Date.now().toString(36).slice(-5)}`;
const SKLO = 'Sklo (základ — určuje vzorec)';

async function zadanie(page: Page, op: string, styl: string, sklo: string) {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-${op}`);
	await page.getByLabel('OP/OPDL číslo *').fill(op);
	await page.getByLabel('Zákazník *').fill('E2E Standard stary');
	await page.getByLabel('Systém').selectOption('Štandard');
	await page.getByLabel('Štýl').selectOption(styl);
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2400');
	await page.getByLabel(SKLO).selectOption(sklo);
}

const riadok = (page: Page, kod: string) => page.locator('.row', { hasText: kod });

test('Štandard je v ponuke systémov a má štýly 2K/3K/4K + oponu', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await page.getByLabel('Systém').selectOption('Štandard');

	const styly = await page.getByLabel('Štýl').locator('option').allTextContents();
	expect(styly.sort()).toEqual(['2K', '2x2K', '2x3K', '2x4K', '3K', '4K']);
	// sklá zdieľa so Štandard + (Float 4/6/10 + izolačné)
	const skla = await page.getByLabel(SKLO).locator('option').allTextContents();
	expect(skla).toEqual([
		'Float sklo 4 mm',
		'Float sklo 6 mm',
		'3.3.1',
		'Float sklo 10 mm',
		'Izolačné sklo 4.8.4'
	]);

	expect(errs).toEqual([]);
});

test('2K + float: basic nárezák s rámom ZASP00018 a dorazovým ZASP00021', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zadanie(page, '01', '2K', 'Float sklo 6 mm');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('plan-badge')).toContainText('Starý štandard 2K');
	await expect(riadok(page, 'ZASP00107')).toContainText(/(^|\D)7,5 m/);
	await expect(riadok(page, 'ZASP00104')).toContainText(/(^|\D)7,5 m/);
	await expect(riadok(page, 'ZASP202415')).toContainText(/(^|\D)7,2 m/);
	await expect(riadok(page, 'ZASP00018')).toContainText(/(^|\D)7,5 m/);
	await expect(riadok(page, 'ZASP00021')).toContainText(/(^|\D)7,5 m/);
	// PLUS profily patria inému systému a v starom Štandarde nemajú čo hľadať
	await expect(riadok(page, 'ZASP20244')).toHaveCount(0);
	await expect(riadok(page, 'ZASP202419')).toHaveCount(0);
	// sklo z nárezáka: G+14 × V−115 = 1456 × 2285
	await expect(page.getByTestId('sklo-sirka')).toHaveText('1456');
	await expect(page.getByTestId('sklo-vyska')).toHaveText('2285');

	expect(errs).toEqual([]);
});

test('2K + izolačné: IZO nárezák — U profil 21,6 m a spodná koľajnica o veľkosť vyššie', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zadanie(page, '02', '2K', 'Izolačné sklo 4.8.4');
	await expect(page.getByTestId('narezak-hint')).toContainText('Štandard 2K IZO');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('plan-badge')).toContainText('Starý štandard 2K IZO');
	await expect(riadok(page, 'ZASP202439')).toContainText(/(^|\D)21,6 m/);
	// spodná koľajnica 2K IZO = 3K profil (ZASP00030), nie ZASP00104
	await expect(riadok(page, 'ZASP00030')).toContainText(/(^|\D)7,5 m/);
	await expect(riadok(page, 'ZASP00104')).toHaveCount(0);
	// IZO sklo je o 23 × 20 mm menšie
	await expect(page.getByTestId('sklo-sirka')).toHaveText('1433');
	await expect(page.getByTestId('sklo-vyska')).toHaveText('2265');

	expect(errs).toEqual([]);
});

test('opona 2x3K + izolačné: starý Štandard IZO oponu MÁ (na rozdiel od Štandard +)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zadanie(page, '03', '2x3K', 'Izolačné sklo 4.8.4');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('plan-badge')).toContainText('Starý štandard 2x3K IZO');
	await expect(riadok(page, 'ZASP202439')).toContainText(/(^|\D)43,2 m/);
	await expect(riadok(page, 'ZASP00024')).toContainText(/(^|\D)22,5 m/);

	// pre porovnanie: Štandard + IZO oponu nemá → izolačné sklo tam nie je v ponuke
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2x3K');
	const skla = await page.getByLabel(SKLO).locator('option').allTextContents();
	expect(skla.filter((s) => /Izola/i.test(s))).toEqual([]);

	expect(errs).toEqual([]);
});
