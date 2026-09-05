// #462 — „Čaká na materiál" checkbox na /pergola, /fix/cad, /clip (zatiaľ testovaný
// len na /zasklenia + /bazen — audit3.spec.ts). Zápisové testy za `skipAkLive`.
// Overuje, že checkbox prežije celý flow a v histórii je ⏳.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, skipAkLive, waitHydrated } from './helpers';

const RUN = `CK-${Date.now().toString(36).toUpperCase()}`;

test('pergola CAD: „⏳ Čaká" prežije kontrolu → odoslanie a zapíše sa do histórie', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/pergola');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-PER`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Pergola Caka');
	await page.getByLabel('Materiál (CAD nárez) *').fill('18004 PRIECKOVY PROFIL 105\t4\t3000');
	await page.getByLabel(/Čaká na materiál/).check();
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// história — riadok s ⏳
	await goto(page, '/odpisy');
	const row = page.locator('tr', { hasText: `${RUN}-PER` });
	await expect(row).toContainText('Pergola');
	await expect(row).toContainText('⏳');

	expect(consoleMsgs).toEqual([]);
});

test('fix/cad: „⏳ Čaká" prežije kontrolu → odoslanie a zapíše sa do histórie', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/fix/cad');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-FIX`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Fix Caka');
	await page.getByLabel('Materiál (CAD nárez) *').fill('18016 PROFIL 110x43 V2\t2\t3000');
	await page.getByLabel(/Čaká na materiál/).check();
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	await goto(page, '/odpisy');
	const row = page.locator('tr', { hasText: `${RUN}-FIX` });
	await expect(row).toContainText('Fix');
	await expect(row).toContainText('⏳');

	expect(consoleMsgs).toEqual([]);
});

test('clip: „⏳ Čaká" prežije kontrolu → odoslanie a zapíše sa do histórie', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/clip');

	await page.locator('#zak').fill(`${RUN}-CLP`);
	await page.locator('#op').fill('01');
	await page.locator('#zakaznik').fill('E2E Clip Caka');
	await page.getByTestId('typ').selectOption('izo');
	await page.getByTestId('variant').selectOption('2');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByLabel(/Čaká na materiál/).check();
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	await goto(page, '/odpisy');
	const row = page.locator('tr', { hasText: `${RUN}-CLP` });
	await expect(row).toContainText('Clip');
	await expect(row).toContainText('⏳');

	expect(consoleMsgs).toEqual([]);
});
