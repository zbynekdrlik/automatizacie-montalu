// #338: RAL farba kovania (R9005/R7016) — vyberá farebný Money variant kľučky/krytky
// vložky (Robust) a automatického zámku (Štandard). Do Money ide LEN variant zvolenej
// farby; druhý sa vôbec neobjaví. Všetko READ-ONLY („Spočítať"), nič sa neodosiela.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated } from './helpers';

const RUN = `E2E-FARBA-${Date.now().toString(36).slice(-5)}`;

const riadok = (page: Page, kod: string) =>
	page.getByTestId('kovanie-karta').locator('.row', { hasText: kod });

async function zaklad(page: Page, op: string) {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-${op}`);
	await page.getByLabel('OP/OPDL číslo *').fill(op);
	await page.getByLabel('Zákazník *').fill('E2E Farba');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2200');
}

test('Robust: R7016 pošle len R7016 variant kľučky/krytky, R9005 vôbec', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '01');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByTestId('farba-kovania').selectOption('R7016');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('kovanie-karta')).toBeVisible();
	await expect(riadok(page, 'ZASK202534')).toContainText('4 ks'); // Kľučka R7016
	await expect(riadok(page, 'ZASK202536')).toContainText('4 ks'); // Krytka vložky R7016
	await expect(riadok(page, 'ZASK202533')).toHaveCount(0); // R9005 kľučka NEJDE
	await expect(riadok(page, 'ZASK202535')).toHaveCount(0); // R9005 krytka NEJDE
	expect(errs).toEqual([]);
});

test('Robust: prepnutie na R9005 vymení kód na R9005 variant', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '02');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByTestId('farba-kovania').selectOption('R9005');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(riadok(page, 'ZASK202533')).toContainText('4 ks'); // Kľučka R9005
	await expect(riadok(page, 'ZASK202534')).toHaveCount(0); // R7016 NEJDE
	expect(errs).toEqual([]);
});

test('Štandard: zámok RAL + hláška o neúplnom kovaní (tesnenia/kefy ručne)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '03');
	await page.getByLabel('Systém').selectOption('Štandard');
	await page.getByLabel('Štýl').selectOption('2K');
	// reaktívny sklo-select sa doplní po zmene systému — samostatný krok (race)
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Float sklo 6 mm');
	await page.getByTestId('farba-kovania').selectOption('R9005');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('kovanie-karta')).toBeVisible();
	await expect(riadok(page, 'ZASK202531')).toContainText('ks'); // Automaticky zamok R9005
	await expect(riadok(page, 'ZASK202532')).toHaveCount(0); // R7016 zámok NEJDE
	await expect(riadok(page, 'ZASK00002')).toContainText('ks'); // kladka dvojitá
	// neúplnosť: tesnenia 4/6mm + kefy zatiaľ nie sú v odpise
	await expect(page.getByTestId('plan-warn')).toContainText('tesnenia');
	expect(errs).toEqual([]);
});
