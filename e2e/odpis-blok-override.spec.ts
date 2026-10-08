// #462 — OdpisBlok override klik na /pergola + /clip (mimo /zasklenia).
// #608: druhý odpis tej istej ZAK+OP → zdieľaný OdpisBlok „už bola odpísaná" → vedomé
// „🔁 Odoslať ako dorobenie" (po automat. confirm) → dorobenie naozaj prejde (TEST režim).
// Zápisové testy za `skipAkLive`. Deterministicky — žiadna vetva „blok ALEBO duplikát".
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, skipAkLive, waitHydrated, vyberSklo } from './helpers';

const RUN = `OB-${Date.now().toString(36).toUpperCase()}`;

test('pergola CAD: druhý odpis → OdpisBlok „Odoslať ako dorobenie" prejde (TEST, #608)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	const zak = `${RUN}-PER`;
	const cadText = '18004 PRIECKOVY PROFIL 105\t4\t3000';

	// 1. prvý odpis — musí prejsť normálne
	await goto(page, '/pergola');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Pergola Override');
	await page.getByLabel('Materiál (CAD nárez) *').fill(cadText);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// 2. druhý odpis s tou istou ZAK+OP → „už bola odpísaná" blok
	await goto(page, '/pergola');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Pergola Override');
	await page.getByLabel('Materiál (CAD nárez) *').fill(cadText);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await page.getByTestId('odoslat').click();

	// #608: „už bola odpísaná" blok → vedomé „Odoslať ako dorobenie" (confirm) → dorobenie prejde
	await expect(page.getByTestId('blok')).toContainText('už bola odpísaná');
	page.on('dialog', (d) => d.accept());
	await page.getByTestId('odoslat-ako-dorobenie').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	expect(consoleMsgs).toEqual([]);
});

test('clip: druhý odpis → OdpisBlok „Odoslať ako dorobenie" prejde (TEST, #608)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	const zak = `${RUN}-CLP`;

	// 1. prvý odpis
	await goto(page, '/clip');
	await page.locator('#zak').fill(zak);
	await page.locator('#op').fill('01');
	await page.locator('#zakaznik').fill('E2E Clip Override');
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.getByTestId('variant').selectOption('2');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// 2. druhý odpis → „už bola odpísaná" blok
	await goto(page, '/clip');
	await page.locator('#zak').fill(zak);
	await page.locator('#op').fill('01');
	await page.locator('#zakaznik').fill('E2E Clip Override');
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.getByTestId('variant').selectOption('2');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);
	await page.getByTestId('odoslat').click();

	// #608: „už bola odpísaná" blok → vedomé „Odoslať ako dorobenie" (confirm) → dorobenie prejde
	await expect(page.getByTestId('blok')).toContainText('už bola odpísaná');
	page.on('dialog', (d) => d.accept());
	await page.getByTestId('odoslat-ako-dorobenie').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	expect(consoleMsgs).toEqual([]);
});
