// „Použiť znova" z histórie — Patrik 2026-07-31: „môže znova zavolať to, čo použil
// minule, len zmení zákazníka, viacerí zákazníci si objednávajú to isté".
//
// Cez REÁLNY prehliadač: odošli odpis (v testovom režime — do Money nejde nič), potom
// z histórie klikni „Použiť znova" a over, že sa zadanie predvyplnilo a že ZAK/OP/
// zákazník ostali PRÁZDNE. Test sa preskočí, ak beží proti LIVE inštancii.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated, skipAkLive, vyberFarbuKovania } from './helpers';

test('odpis z histórie predvyplní formulár, ale ZAK/OP/zákazník ostanú prázdne', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);
	await waitHydrated(page);

	const zak = `E2E-ZNOVA-${Date.now()}`;

	// 1. zadaj a odošli (TEST režim — súbor ide do ODPIS EXPORT, nie do Money)
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('Prvý zákazník');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('3K');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2400');
	await page.locator('#poznamka').fill('poznámka z prvej zákazky');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// 2. v histórii nájdi záznam a klikni „Použiť znova"
	await page.goto('/odpisy');
	const riadok = page.locator('tbody tr', { hasText: zak }).first();
	await expect(riadok).toBeVisible();
	await riadok.getByRole('link', { name: /Použiť znova/ }).click();

	// 3. formulár je predvyplnený, ale identifikácia zákazky je prázdna
	await expect(page.getByTestId('znova-info')).toContainText(zak);
	await expect(page.getByLabel('Číslo objednávky (ZAK) *')).toHaveValue('');
	await expect(page.getByLabel('OP/OPDL číslo *')).toHaveValue('');
	await expect(page.getByLabel('Zákazník *')).toHaveValue('');

	await expect(page.getByLabel('Systém')).toHaveValue('Robust');
	await expect(page.getByLabel('Štýl')).toHaveValue('3K');
	await expect(page.locator('#s')).toHaveValue('3000');
	await expect(page.locator('#v')).toHaveValue('2400');
	await expect(page.locator('#poznamka')).toHaveValue('poznámka z prvej zákazky');

	// 4. nič sa tým neodpísalo — v histórii je stále len jeden záznam s týmto ZAK
	await page.goto('/odpisy');
	await expect(page.locator('tbody tr', { hasText: zak })).toHaveCount(1);

	expect(errs).toEqual([]);
});

test('neexistujúce ?znova= nezhodí stránku a nič nepredvyplní', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await page.goto('/zasklenia?znova=999999');
	await waitHydrated(page);

	await expect(page.getByTestId('znova-info')).toHaveCount(0);
	await expect(page.getByLabel('Číslo objednávky (ZAK) *')).toHaveValue('');
	await expect(page.getByRole('button', { name: 'Spočítať nárezový plán' })).toBeVisible();

	expect(errs).toEqual([]);
});

test('Robust už neponúka kalené sklá 8/10 mm (je IZO-only)', async ({ page }) => {
	// Patrik 2026-07-31: „pri robuste mi ponúka kalené sklá 8-10mm" — hlásené ako chyba
	const errs = collectConsole(page);
	await loginAs(page);
	await waitHydrated(page);

	await page.getByLabel('Systém').selectOption('Robust');
	const skla = await page
		.getByLabel('Sklo (základ — určuje vzorec)')
		.locator('option')
		.allTextContents();

	expect(skla.join(' ')).not.toMatch(/Kalené 8mm|Kalené 10mm/);
	expect(skla.some((g) => /Izolačné sklo 4\/16\/4/.test(g))).toBe(true);

	expect(errs).toEqual([]);
});
