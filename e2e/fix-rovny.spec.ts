// Rovný (pravouhlý) fix — Patrik 2026-07-31: „kolónku šikmé fixe zmenil by som na FIXE
// prípadne pevné zasklenie, tam by som ďalej išiel rozbaľovacie menu na šikmé a rovné
// (pravouhlé)".
//
// Cez REÁLNY prehliadač: vybrať tvar, zadať JEDNU výšku, dostať výkres obdĺžnika bez
// popiskov sklonu a bez dvakrát vypísaných 90°. Modul do Money nezapisuje nič — v teste
// sa preto ani nemá čo odoslať.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated } from './helpers';

test('rovný fix: jedna výška, výkres bez sklonu a bez uhlov', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await page.goto('/fix');
	await waitHydrated(page);

	await expect(page.getByRole('heading', { name: 'Fixy — pevné zasklenie' })).toBeVisible();

	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-ROVNY');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Rovny');
	await page.getByLabel('Tvar').selectOption('rovny');

	// pri rovnom tvare zmizne druhá výška a ostane jedno pole „Výška"
	await expect(page.locator('#v2')).toHaveCount(0);
	await expect(page.getByLabel('Výška (mm) *')).toBeVisible();

	await page.locator('#s').fill('2000');
	await page.locator('#v1').fill('1500');
	await page.getByTestId('nakreslit').click();

	await expect(page.getByTestId('fix-badge')).toContainText('Fix rovný (pravouhlý)');

	// sklon, šikmá hrana ani uhly sa pri obdĺžniku nekótujú
	await expect(page.getByTestId('fix-sikma')).toHaveCount(0);
	await expect(page.getByTestId('fix-sikma-pole')).toHaveCount(0);
	await expect(page.getByTestId('fix-uhol')).toHaveCount(0);
	await expect(page.getByTestId('fix-uhol-tupy')).toHaveCount(0);
	await expect(page.getByTestId('uhol-sklonu')).toHaveCount(0);

	// šírka sa kótuje aj naďalej
	await expect(page.getByTestId('fix-sirka')).toContainText('2000');

	// popis výkresu pre čítačku obrazovky hovorí „rovného", nie „šikmého", a nesie
	// jednu výšku (nález pri živom overení v0.9.7)
	await expect(page.getByTestId('fix-vykres')).toHaveAttribute(
		'aria-label',
		'Výkres rovného fixu 2000×1500 mm, 1 polí'
	);

	// tabuľka polí má jednu výšku, nie „vľavo/vpravo/šikmá hrana"
	const tab = page.getByTestId('fix-tabulka');
	await expect(tab).toContainText('1500 mm');
	await expect(tab).not.toContainText('Šikmá hrana');

	// modul do Money nezapisuje nič — na stránke nesmie byť odpisová akcia
	await expect(page.getByRole('button', { name: /Money/i })).toHaveCount(0);

	expect(errs).toEqual([]);
});

test('rovný fix na 3 polia: každé pole má tú istú výšku', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await page.goto('/fix');
	await waitHydrated(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-ROVNY3');
	await page.getByLabel('OP/OPDL číslo *').fill('02');
	await page.getByLabel('Zákazník *').fill('E2E Rovny 3');
	await page.getByLabel('Tvar').selectOption('rovny');
	await page.locator('#s').fill('3000');
	await page.locator('#v1').fill('2000');
	await page.getByLabel('Počet polí (stĺpiky medzi nimi)').selectOption('3');
	await expect(page.getByTestId('sucet-poli')).toContainText('3000');
	await page.getByTestId('nakreslit').click();

	const riadky = page.getByTestId('fix-tabulka').locator('tbody tr');
	await expect(riadky).toHaveCount(3);
	for (let i = 0; i < 3; i++) await expect(riadky.nth(i)).toContainText('2000 mm');

	expect(errs).toEqual([]);
});

test('šikmý fix ostal nezmenený — rovnaké výšky navedú na nový tvar', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await page.goto('/fix');
	await waitHydrated(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-SIKMY');
	await page.getByLabel('OP/OPDL číslo *').fill('03');
	await page.getByLabel('Zákazník *').fill('E2E Sikmy');
	await page.locator('#s').fill('2000');
	await page.locator('#v1').fill('800');
	await page.locator('#v2').fill('800');
	await page.getByTestId('nakreslit').click();

	const chyba = page.getByTestId('form-error');
	await expect(chyba).toContainText('rovnaké');
	await expect(chyba).toContainText('rovný');

	expect(errs).toEqual([]);
});
