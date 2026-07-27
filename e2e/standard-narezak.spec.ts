// Štandard +: nárezák (basic vs IZO) vyberá SKLO, nie štýl (Patrik 2026-07-27:
// „zvolím počet okien a podľa výberu skla mi určí, ktorý nárezák to bude ťahať").
//
// Všetko READ-ONLY — len „Spočítať nárezový plán", žiadne odoslanie do Money.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated } from './helpers';

const RUN = `E2E-NRZ-${Date.now().toString(36).slice(-5)}`;
const SKLO = 'Sklo (základ — určuje vzorec)';
/** rozširujúci „U" profil — existuje LEN v IZO nárezáku */
const U_PROFIL = 'ZASP202439';

async function hlavicka(page: Page, op: string) {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-${op}`);
	await page.getByLabel('OP/OPDL číslo *').fill(op);
	await page.getByLabel('Zákazník *').fill('E2E Narezak');
	await page.getByLabel('Systém').selectOption('Štandard +');
}

test('štýl ponúka len počty krídel — IZO variant sa v zozname nevyskytuje', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, '01');

	const styly = await page.getByLabel('Štýl').locator('option').allTextContents();
	expect(styly).toEqual(expect.arrayContaining(['2K', '3K', '4K', '5K', '6K', '2x2K']));
	expect(styly.filter((s) => /IZO/i.test(s))).toEqual([]);

	expect(errs).toEqual([]);
});

test('4K + izolačné sklo ťahá nárezák „4K IZO"; 4K + float ťahá basic', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, '02');
	await page.getByLabel('Štýl').selectOption('4K');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2400');
	await page.getByLabel(SKLO).selectOption('Izolačné sklo 4.8.4');
	// formulár rovno povie, ktorý nárezák sa podľa skla ťahá
	await expect(page.getByTestId('narezak-hint')).toContainText('4K IZO');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('plan-badge')).toContainText('Štandard + 4K IZO');
	await expect(page.locator('.row', { hasText: U_PROFIL })).toHaveCount(1);

	// to isté zadanie, len float sklo → basic nárezák bez „U" profilu
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await expect(page.getByLabel('Štýl')).toHaveValue('4K'); // štýl ostal počtom krídel
	await page.getByLabel(SKLO).selectOption('Float sklo 6 mm');
	await expect(page.getByTestId('narezak-hint')).toContainText('Štandard + 4K.');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('plan-badge')).toContainText('Štandard + 4K ·');
	await expect(page.locator('.row', { hasText: U_PROFIL })).toHaveCount(0);

	expect(errs).toEqual([]);
});

test('zmena počtu krídel nezmaže zvolené sklo; opona izolačné sklo neponúka', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, '03');
	await page.getByLabel('Štýl').selectOption('3K');
	await page.getByLabel(SKLO).selectOption('Izolačné sklo 4.8.4');
	// 3K → 5K: voľba skla ostáva, nárezák sa prepne na 5K IZO
	await page.getByLabel('Štýl').selectOption('5K');
	await expect(page.getByLabel(SKLO)).toHaveValue('Izolačné sklo 4.8.4');
	await expect(page.getByTestId('narezak-hint')).toContainText('5K IZO');

	// opona nemá izolačnú skladbu → sklo sa prepne na float a IZO nie je v ponuke
	await page.getByLabel('Štýl').selectOption('2x3K');
	const skla = await page.getByLabel(SKLO).locator('option').allTextContents();
	expect(skla.filter((s) => /Izola/i.test(s))).toEqual([]);
	await expect(page.getByTestId('narezak-hint')).toContainText('Štandard + 2x3K.');

	expect(errs).toEqual([]);
});
