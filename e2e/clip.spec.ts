// CLIP zábradlie (#372) — nárez + Money odpis. Formulár → kontrola (odpis počtu
// tyčí + nárez per profil) → odoslať (TEST režim, auto-skip na LIVE). Nová stránka
// + nula console errors/warnings (e2e-console guard).
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, skipAkLive, waitHydrated } from './helpers';

async function hlavicka(page: import('@playwright/test').Page, zak: string) {
	await goto(page, '/clip');
	await page.locator('#zak').fill(zak);
	await page.locator('#op').fill('OP1');
	await page.locator('#zakaznik').fill('E2E CLIP');
}

test('izo B1 3000×1000 — kontrola: odpis (počet tyčí) + nárez per profil', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-CLIP-1');
	await page.getByTestId('typ').selectOption('izo');
	await page.getByTestId('variant').selectOption('2');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page); // po natívnej POST navigácii na krok „kontrola"

	// odpis = kontraktný vektor izo B1 3000×1000: ZASP00116=2, ZASP00125=1, ZASP00119=2
	await expect(page.getByTestId('kontrola-tabulka')).toBeVisible();
	await expect(page.locator('input[name="qty_ZASP00116"]')).toHaveValue('2');
	await expect(page.locator('input[name="qty_ZASP00125"]')).toHaveValue('1');
	await expect(page.locator('input[name="qty_ZASP00119"]')).toHaveValue('2');

	// nárez per profil: 5 profilových riadkov + 4 drobné (kod: null, „neodpisuje sa")
	const narez = page.getByTestId('narez-tabulka').locator('tbody tr');
	await expect(narez).toHaveCount(9);
	await expect(page.getByTestId('narez-tabulka')).toContainText('vnútorné tesnenie');
	await expect(page.getByTestId('narez-tabulka')).toContainText('neodpisuje sa');

	expect(errs).toEqual([]);
});

test('izo B1 — odoslať zapíše odpis (TEST režim; na LIVE sa preskočí)', async ({ page }) => {
	const errs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-CLIP-SEND');
	await page.getByTestId('typ').selectOption('izo');
	await page.getByTestId('variant').selectOption('2');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await expect(page.getByTestId('odoslat')).toBeVisible();
	await page.getByTestId('odoslat').click();

	// TEST režim → doklad do TEST priečinka, nie do ostrého Money
	await expect(page.getByTestId('vysledok')).toBeVisible();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.getByTestId('vysledok')).toContainText('.xlsx');

	expect(errs).toEqual([]);
});

test('klasika B3 (N=4) — kontrola: ZASP kódy (nie KM12), Patrik #372 potvrdil', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-CLIP-KL');
	await page.getByTestId('typ').selectOption('klasika');
	await page.getByTestId('variant').selectOption('4');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1000');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page); // po natívnej POST navigácii na krok „kontrola"

	// odpis = kontraktný vektor klasika B3 3000×1000: ZASP00116=2, ZASP00125=1, ZASP202413=2
	await expect(page.getByTestId('kontrola-tabulka')).toBeVisible();
	await expect(page.locator('input[name="qty_ZASP00116"]')).toHaveValue('2');
	await expect(page.locator('input[name="qty_ZASP00125"]')).toHaveValue('1');
	await expect(page.locator('input[name="qty_ZASP202413"]')).toHaveValue('2');
	// KM12* kódy zo šablóny sa nepoužívajú (Patrik #372: „Ano tie kody sú všade rovnaké")
	await expect(page.getByTestId('kontrola-tabulka')).not.toContainText('KM12');

	expect(errs).toEqual([]);
});
