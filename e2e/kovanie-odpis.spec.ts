// Kovanie do Money odpisu (Dominik 2026-07-28) v prehliadači: dielňa musí vidieť
// kusy pred odoslaním a jednostranná FAB musí naozaj zmeniť počty.
//
// Väčšina testov je READ-ONLY („Spočítať" / „Späť"); posledný odosiela v TEST režime
// (MONEY_LIVE nie je 1), takže súbor ide do testovacieho priečinka, nikdy do Money.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated } from './helpers';

const RUN = `E2E-KOV-${Date.now().toString(36).slice(-5)}`;
const FAB = '🔑 Jednostranná FAB (menej kľučiek a krytiek vložky v odpise)';

async function zaklad(page: Page, op: string) {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-${op}`);
	await page.getByLabel('OP/OPDL číslo *').fill(op);
	await page.getByLabel('Zákazník *').fill('E2E Kovanie');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2200');
}

const riadok = (page: Page, kod: string) =>
	page.getByTestId('kovanie-karta').locator('.row', { hasText: kod });

test('Robust 2K: kovanie je v náhľade s kusmi aj tesneniami', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '01');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('kovanie-karta')).toBeVisible();
	// 2 krídla → 4 kladky; 2 uzávery → 4 kľučky (obojstranná FAB je predvolená)
	await expect(riadok(page, 'ZASK00027')).toContainText('4 ks');
	await expect(riadok(page, 'ZASK00029')).toContainText('2 ks');
	await expect(riadok(page, 'ZASK00030')).toContainText('4 ks');
	// rohovník obvodový podľa 2K koľajnice
	await expect(riadok(page, 'ZASK00037')).toContainText('8 ks');
	// tesnenie je metrážové
	await expect(riadok(page, 'ZASK20242')).toContainText(' m');

	expect(errs).toEqual([]);
});

test('jednostranná FAB zníži kľučky a krytky, ostatné počty nechá', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '02');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('3K');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);
	await expect(riadok(page, 'ZASK00030')).toContainText('4 ks');
	const kladky = await riadok(page, 'ZASK00027').textContent();

	await page.getByRole('button', { name: /Späť a upraviť/ }).click();
	await waitHydrated(page);
	await page.getByLabel(FAB).check();
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(riadok(page, 'ZASK00030')).toContainText('2 ks');
	await expect(riadok(page, 'ZASK00035')).toContainText('2 ks');
	expect(await riadok(page, 'ZASK00027').textContent()).toBe(kladky);

	expect(errs).toEqual([]);
});

test('zaškrtnutá FAB prežije „Späť a upraviť"', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '03');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel(FAB).check();
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);
	await page.getByRole('button', { name: /Späť a upraviť/ }).click();
	await waitHydrated(page);

	await expect(page.getByLabel(FAB)).toBeChecked();
	expect(errs).toEqual([]);
});

test('systémy bez kovania: pole FAB ani karta kovania nie sú', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '04');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await expect(page.getByTestId('jednostranna-fab')).toHaveCount(0);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('kovanie-karta')).toHaveCount(0);
	// profily sa odpisujú ako doteraz
	await expect(page.getByText('Odpis (do Money)')).toBeVisible();

	expect(errs).toEqual([]);
});

test('zimná záhrada: kusy sa sčítajú za oba posuvy', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '05');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByRole('button', { name: /Pridať posuv/ }).click();
	await page.locator('#ps0-s').fill('3500');
	await page.locator('#ps0-v').fill('2100');
	await page.getByRole('button', { name: /Spočítať spoločný plán/ }).click();
	await waitHydrated(page);

	// 2 posuvy × 2 krídla × 2 ks = 8 kladiek, 2 × 8 = 16 rohovníkov obvodových
	await expect(riadok(page, 'ZASK00027')).toContainText('8 ks');
	await expect(riadok(page, 'ZASK00037')).toContainText('16 ks');

	expect(errs).toEqual([]);
});

test('po odoslaní vidno kovanie aj na potvrdzovacej obrazovke', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '06');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);
	// TEST režim (MONEY_LIVE nie je 1) — zapisuje sa do testovacieho priečinka, nie do Money
	await page.getByRole('button', { name: /Odoslať odpis/ }).click();
	await waitHydrated(page);

	// to, čo odišlo do súboru, musí byť vidieť aj tu — inak dielňa nevie, že kusy odišli
	await expect(page.getByTestId('kovanie-karta')).toBeVisible();
	await expect(riadok(page, 'ZASK00027')).toContainText('4 ks');

	expect(errs).toEqual([]);
});
