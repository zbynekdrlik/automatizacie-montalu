// Patrik 2026-07-31: „minimálne v hlavičke by nebolo štandard + ale štandard plus"
// + „do budúcna budem používať názvy štandard + a starý štandard".
//
// Test ide cez REÁLNY prehliadač a stráži OBE strany zmeny:
//   1. človek vidí „Štandard plus" / „Starý štandard" v ponuke aj v hlavičke plánu,
//   2. HODNOTA, ktorá odchádza na server (`<option value>`), je stále pôvodný KĽÚČ
//      konfigurácie — na ňom visia nárezáky, b2b limity aj história odpisov.
//
// Všetko ČÍTACIE („Spočítať"), do Money nejde nič.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated } from './helpers';

test('ponuka systémov: text je nový, hodnota ostáva pôvodný kľúč', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await waitHydrated(page);

	const vyber = page.getByLabel('Systém');
	const moznosti = await vyber
		.locator('option')
		.evaluateAll((os) =>
			os.map((o) => ({ value: (o as HTMLOptionElement).value, text: (o.textContent ?? '').trim() }))
		);

	const plus = moznosti.find((o) => o.value === 'Štandard +');
	const stary = moznosti.find((o) => o.value === 'Štandard');
	expect(plus, 'kľúč „Štandard +" musí v ponuke ostať').toBeTruthy();
	expect(stary, 'kľúč „Štandard" musí v ponuke ostať').toBeTruthy();
	expect(plus?.text).toBe('Štandard plus');
	expect(stary?.text).toBe('Starý štandard');

	// starý názov sa už nikde v ponuke nezobrazuje
	expect(moznosti.map((o) => o.text)).not.toContain('Štandard +');
	// Robust/Slide/Deluxe sa nepremenovali
	expect(moznosti.map((o) => o.text)).toContain('Robust');

	expect(errs).toEqual([]);
});

test('hlavička nárezového plánu píše „Štandard plus", odpis sa neposiela', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await waitHydrated(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-NAZVY');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Nazvy');
	// hodnota = pôvodný kľúč; keby ju premenovanie rozbilo, tento krok padne
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('3K');
	await page.locator('#s').fill('3000');
	await page.locator('#v').fill('2400');
	await page.getByRole('button', { name: 'Spočítať' }).click();

	const badge = page.getByTestId('plan-badge').first();
	await expect(badge).toContainText('Štandard plus 3K');
	await expect(badge).not.toContainText('Štandard + 3K');

	expect(errs).toEqual([]);
});
