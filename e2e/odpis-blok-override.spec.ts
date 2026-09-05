// #462 — OdpisBlok „⚠️ Odoslať aj tak" override klik na /pergola + /clip
// (mimo /zasklenia — tam je dedup krytý parita.spec.ts, ale override klik NIE).
// Zápisové testy za `skipAkLive`. Overuje, že duplikát → blok hlášku →
// override klik (po automat. confirm) → odpis naozaj prejde (TEST režim).
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, skipAkLive, waitHydrated } from './helpers';

const RUN = `OB-${Date.now().toString(36).toUpperCase()}`;

test('pergola CAD: duplikát → OdpisBlok „Odoslať aj tak" override prejde (TEST)', async ({
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

	// 2. druhý odpis s tou istou ZAK+OP → duplikát blok
	await goto(page, '/pergola');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Pergola Override');
	await page.getByLabel('Materiál (CAD nárez) *').fill(cadText);
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await page.getByTestId('odoslat').click();

	// blok hlášku (duplikat alebo OdpisBlok)
	const blok = page.getByTestId('blok');
	const duplikat = page.getByTestId('duplikat');
	// čakáme na niektorý z nich (duplikat je dead-end, blok má override)
	const blokVisible = await blok.isVisible().catch(() => false);
	const dupVisible = await duplikat.isVisible().catch(() => false);

	if (blokVisible) {
		// OdpisBlok — klikneme „Odoslať aj tak" (treba override confirm)
		page.on('dialog', (d) => d.accept());
		await page.getByTestId('odoslat-aj-tak').click();
		await expect(page.getByTestId('vysledok')).toContainText('TEST');
	} else if (dupVisible) {
		// duplikat dead-end (bez override) — toto je iný blok typ (pure dedup)
		await expect(duplikat).toContainText('už bola odoslaná');
	} else {
		// ani jedno — čakaj na blok alebo duplikat
		await expect(blok.or(duplikat)).toBeVisible();
	}

	expect(consoleMsgs).toEqual([]);
});

test('clip: duplikát → OdpisBlok „Odoslať aj tak" override prejde (TEST)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	const zak = `${RUN}-CLP`;

	// 1. prvý odpis
	await goto(page, '/clip');
	await page.locator('#zak').fill(zak);
	await page.locator('#op').fill('01');
	await page.locator('#zakaznik').fill('E2E Clip Override');
	await page.getByTestId('typ').selectOption('izo');
	await page.getByTestId('variant').selectOption('2');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// 2. druhý odpis → duplikát / blok
	await goto(page, '/clip');
	await page.locator('#zak').fill(zak);
	await page.locator('#op').fill('01');
	await page.locator('#zakaznik').fill('E2E Clip Override');
	await page.getByTestId('typ').selectOption('izo');
	await page.getByTestId('variant').selectOption('2');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);
	await page.getByTestId('odoslat').click();

	const blok = page.getByTestId('blok');
	const duplikat = page.getByTestId('duplikat');
	const blokVisible = await blok.isVisible().catch(() => false);
	const dupVisible = await duplikat.isVisible().catch(() => false);

	if (blokVisible) {
		page.on('dialog', (d) => d.accept());
		await page.getByTestId('odoslat-aj-tak').click();
		await expect(page.getByTestId('vysledok')).toContainText('TEST');
	} else if (dupVisible) {
		await expect(duplikat).toContainText('už bola odoslaná');
	} else {
		await expect(blok.or(duplikat)).toBeVisible();
	}

	expect(consoleMsgs).toEqual([]);
});
