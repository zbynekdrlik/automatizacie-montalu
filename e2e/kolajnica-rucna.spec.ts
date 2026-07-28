// Ručná dĺžka koľajnice (Patrik 2026-07-28) v prehliadači: polia sa ukážu len tam, kde
// majú zmysel (Štandard / Štandard + / Deluxe — NIE Robust/Slide), zadaná dĺžka sa
// naozaj objaví v rezoch nárezového plánu.
//
// Všetko READ-ONLY — len „Spočítať", nič sa neodosiela do Money.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated } from './helpers';

const RUN = `E2E-KOL-${Date.now().toString(36).slice(-5)}`;
const HORNA = 'Koľajnica horná (mm) — prázdne = podľa šírky';
const SPODNA = 'Koľajnica spodná (mm) — prázdne = podľa šírky';

async function zaklad(page: Page, op: string) {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-${op}`);
	await page.getByLabel('OP/OPDL číslo *').fill(op);
	await page.getByLabel('Zákazník *').fill('E2E Kolajnica');
	await page.getByLabel('Šírka (mm) *').fill('3447');
	await page.getByLabel('Výška (mm) *').fill('2097');
}

const riadok = (page: Page, kod: string) => page.locator('.row', { hasText: kod });

test('polia na ručnú koľajnicu sú len pri systémoch s hornou+spodnou', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	// Robust a Slide majú jednu obvodovú koľajnicu → polia nie sú
	await page.getByLabel('Systém').selectOption('Robust');
	await expect(page.getByTestId('kolajnica-polia')).toHaveCount(0);
	await page.getByLabel('Systém').selectOption('Slide');
	await expect(page.getByTestId('kolajnica-polia')).toHaveCount(0);

	// Štandard +, Štandard, Deluxe ich majú
	for (const sys of ['Štandard +', 'Štandard', 'Deluxe']) {
		await page.getByLabel('Systém').selectOption(sys);
		await expect(page.getByTestId('kolajnica-polia')).toBeVisible();
	}

	expect(errs).toEqual([]);
});

test('Štandard + 4K: horná 2690 / spodná 2695 sa objaví v rezoch plánu', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '01');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('4K');
	await page.getByLabel(HORNA).fill('2690');
	await page.getByLabel(SPODNA).fill('2695');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	// karta Rozmery pripomenie, že koľajnice sú ručné
	await expect(page.getByTestId('kolajnica-horna')).toHaveText('2690 mm');
	await expect(page.getByTestId('kolajnica-spodna')).toHaveText('2695 mm');
	// a hlavne: dielňa reže 2690 / 2695, nie šírku 3447
	await expect(page.locator('tr', { hasText: 'ZASP00036' })).toContainText('2690 mm');
	await expect(page.locator('tr', { hasText: 'ZASP00033' })).toContainText('2695 mm');
	await expect(page.locator('tr', { hasText: 'ZASP00036' })).not.toContainText('3447 mm');
	// ostatné profily podľa rozmeru otvoru (nedotknuté) + odpis stále 7,5 m (jedna tyč)
	await expect(riadok(page, 'ZASP00036')).toContainText(/(^|\D)7,5 m/);
	// sklo sa ručnou koľajnicou NEMENÍ — 826 mm je basic 4K nárezák pre šírku 3447
	// (predvolené sklo je float; IZO by dalo 803, viď tests/kolajnica-rucna.test.ts)
	await expect(page.getByTestId('sklo-sirka')).toHaveText('826');

	expect(errs).toEqual([]);
});

test('prázdne polia = pôvodný výpočet zo šírky', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '02');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('4K');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('kolajnica-horna')).toHaveCount(0);
	await expect(page.locator('tr', { hasText: 'ZASP00036' })).toContainText('3447 mm');

	expect(errs).toEqual([]);
});

test('preklep (26 mm) formulár odmietne so slovenskou chybou', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '03');
	await page.getByLabel('Systém').selectOption('Štandard +');
	// natívna min validácia by submit zablokovala → obídeme ju ako skriptovaný POST
	await page.getByLabel(HORNA).evaluate((el: HTMLInputElement) => {
		el.removeAttribute('min');
		el.value = '26';
		el.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.locator('.err')).toContainText('Koľajnica horná');
	expect(errs).toEqual([]);
});

test('zimná záhrada: ručná koľajnica je per posuv a je vidieť pri posuve', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zaklad(page, '04');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel(HORNA).fill('2690');
	await page.getByLabel(SPODNA).fill('2695');
	await page.getByRole('button', { name: /Pridať posuv/ }).click();
	await page.locator('#ps0-s').fill('3980');
	await page.locator('#ps0-v').fill('2162');
	await page.getByRole('button', { name: /Spočítať spoločný plán/ }).click();
	await waitHydrated(page);

	// posuv 1 má ručné koľajnice, posuv 2 nie
	await expect(page.getByTestId('kolajnica-rucne-0')).toContainText('horná 2690 mm');
	await expect(page.getByTestId('kolajnica-rucne-0')).toContainText('spodná 2695 mm');
	await expect(page.getByTestId('kolajnica-rucne-1')).toHaveCount(0);
	// rezy: 2690 (posuv 1, ručne) + 3980 (posuv 2, zo šírky) na tom istom profile
	const horna = page.locator('tr', { hasText: 'Koľajnica horná' }).first();
	await expect(horna).toContainText('2690 mm');
	await expect(horna).toContainText('3980 mm');

	expect(errs).toEqual([]);
});
