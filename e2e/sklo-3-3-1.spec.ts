// #214 — sklo „3.3.1" (lepené) je vo výbere skla pre Štandard plus a starý Štandard a
// správa sa ako obyčajná 6 mm (basic nárezák, žiadny IZO „U" profil). Read-only tok —
// len „Spočítať nárezový plán", nič sa neodosiela do Money.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated } from './helpers';

const SKLO = 'Sklo (základ — určuje vzorec)';
const RUN = `E2E-331-${Date.now().toString(36).slice(-5)}`;
/** rozširujúci „U" profil — existuje LEN v IZO nárezáku */
const U_PROFIL = 'ZASP202439';

async function hlavicka(page: Page, system: string, op: string) {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-${op}`);
	await page.getByLabel('OP/OPDL číslo *').fill(op);
	await page.getByLabel('Zákazník *').fill('E2E 3.3.1');
	await page.getByLabel('Systém').selectOption(system);
}

test('Štandard plus: „3.3.1" je v ponuke skla a ťahá basic nárezák (ako 6 mm)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'Štandard +', '01');
	await page.getByLabel('Štýl').selectOption('4K');

	// „3.3.1" je v zozname skiel
	const skla = await page.getByLabel(SKLO).locator('option').allTextContents();
	expect(skla).toContain('3.3.1');

	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2400');
	await page.getByLabel(SKLO).selectOption('3.3.1');
	// nie je izolačné → ťahá BASIC nárezák, presne ako „Float sklo 6 mm"
	await expect(page.getByTestId('narezak-hint')).toContainText('Štandard + 4K.');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('plan-badge')).toContainText('Štandard plus 4K ·');
	// basic nárezák nemá rozširujúci „U" profil (ten je len v IZO)
	await expect(page.locator('.row', { hasText: U_PROFIL })).toHaveCount(0);

	expect(errs).toEqual([]);
});

test('starý Štandard: „3.3.1" je v ponuke skla a ťahá basic nárezák', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'Štandard', '02');
	await page.getByLabel('Štýl').selectOption('2K');

	const skla = await page.getByLabel(SKLO).locator('option').allTextContents();
	expect(skla).toContain('3.3.1');

	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2200');
	await page.getByLabel(SKLO).selectOption('3.3.1');
	await expect(page.getByTestId('narezak-hint')).toContainText('Štandard 2K.');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('plan-badge')).toContainText('Starý štandard 2K');
	// basic rám starého Štandardu (ZASP00018) je prítomný, žiadny IZO „U" profil
	await expect(page.locator('.row', { hasText: 'ZASP00018' })).toHaveCount(1);
	await expect(page.locator('.row', { hasText: U_PROFIL })).toHaveCount(0);

	expect(errs).toEqual([]);
});
