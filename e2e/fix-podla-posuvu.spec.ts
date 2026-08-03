// #85 — rozpočítanie polí fixu PODĽA POSUVU (Robust/Slide/Štandard), Patrikovo
// rozpočítanie (Odoo 207, msg #1614896 + výkres #1614897). Modul do Money nezapisuje
// nič, takže sa to dá overiť aj proti nasadenej appke (BASE_URL).
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated } from './helpers';

async function hlavicka(page: import('@playwright/test').Page, zak: string, op: string) {
	await page.goto('/fix');
	await waitHydrated(page);
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill(op);
	await page.getByLabel('Zákazník *').fill('E2E FIX POSUV');
}

test('rozpočítanie „podľa posuvu" (Robust): nerovnomerné polia, drawing sedí, 0 chýb v konzole', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-FIX-POSUV', 'OP-POSUV1');

	// rovný tvar = jedna výška, netreba riešiť sklon — tu ide o delenie polí
	await page.selectOption('#tvar', 'rovny');
	await page.locator('#s').fill('2000');
	await page.locator('#v1').fill('1500');
	await page.selectOption('#pocet', '3');

	// default je rovnomerne — prepneme na podľa posuvu + Robust
	await expect(page.locator('#system')).toHaveCount(0);
	await page.selectOption('#delenie', 'posuv');
	await expect(page.locator('#system')).toBeVisible();
	await page.selectOption('#system', 'Robust');

	// polia sa prepočítali AUTOMATICKY (bez klikania na "Rozdeliť")
	await expect(page.locator('#pole0')).toHaveValue('106.6');
	await expect(page.locator('#pole1')).toHaveValue('1786.8');
	await expect(page.locator('#pole2')).toHaveValue('106.6');
	await expect(page.getByTestId('sucet-poli')).toContainText('2000');
	await expect(page.getByText(/nesedí/)).toHaveCount(0);
	await expect(page.getByTestId('posuv-info')).toContainText('106,6');
	await expect(page.getByTestId('posuv-info')).toContainText('78,5');

	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('fix-vykres')).toBeVisible();
	await expect(page.getByTestId('delenie-badge')).toContainText('Robust');
	await expect(page.getByTestId('posuv-info-vykres')).toContainText('106,6');
	await expect(page.getByTestId('posuv-info-vykres')).toContainText('78,5');

	const riadky = page.getByTestId('fix-tabulka').locator('tbody tr');
	await expect(riadky).toHaveCount(3);
	await expect(riadky.nth(0)).toContainText('106,6 mm');
	await expect(riadky.nth(1)).toContainText('1786,8 mm');
	await expect(riadky.nth(2)).toContainText('106,6 mm');

	expect(errs).toEqual([]);
});

test('„← Späť a upraviť" zachová delenie „podľa posuvu" + zvolený systém', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-FIX-POSUV-B', 'OP-POSUV2');

	await page.locator('#s').fill('1000');
	await page.locator('#v1').fill('800');
	await page.locator('#v2').fill('600');
	await page.selectOption('#pocet', '3');
	await page.selectOption('#delenie', 'posuv');
	await page.selectOption('#system', 'Štandard');
	await expect(page.locator('#pole0')).toHaveValue('59');

	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);

	await expect(page.locator('#delenie')).toHaveValue('posuv');
	await expect(page.locator('#system')).toHaveValue('Štandard');
	await expect(page.locator('#pole0')).toHaveValue('59');
	await expect(page.locator('#pole2')).toHaveValue('59');

	expect(errs).toEqual([]);
});

test('prepnutie späť na „rovnomerne" prepočíta polia rovnomerne (systém select zmizne)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-FIX-POSUV-C', 'OP-POSUV3');

	await page.locator('#s').fill('3000');
	await page.locator('#v1').fill('1000');
	await page.locator('#v2').fill('900');
	await page.selectOption('#pocet', '3');
	await page.selectOption('#delenie', 'posuv');
	await page.selectOption('#system', 'Slide');
	await expect(page.locator('#pole0')).toHaveValue('82.5');

	await page.selectOption('#delenie', 'rovnomerne');
	await expect(page.locator('#system')).toHaveCount(0);
	await expect(page.locator('#pole0')).toHaveValue('1000');
	await expect(page.locator('#pole1')).toHaveValue('1000');
	await expect(page.locator('#pole2')).toHaveValue('1000');

	expect(errs).toEqual([]);
});

// #85 review (Important, PR #112): Robust krajny (106,6) sa nezmestí dvakrát do
// príliš úzkej šírky — súčet by aj tak sedel na S (krajné pole by vyšlo záporné),
// takže treba samostatnú hlášku + zablokovanie tlačidla, nie len spoliehať na
// generickú serverovú kontrolu súčtu. n>=3, pretože pri n=2 sa systém/KRAJNY od
// #85-follow-up vôbec nepoužíva (viď test nižšie).
test('príliš úzka šírka pre zvolený systém (n=3): konkrétna hláška, tlačidlo zablokované', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-FIX-POSUV-D', 'OP-POSUV4');

	await page.selectOption('#tvar', 'rovny');
	await page.locator('#s').fill('100');
	await page.locator('#v1').fill('500');
	await page.selectOption('#pocet', '3');
	await page.selectOption('#delenie', 'posuv');
	await page.selectOption('#system', 'Robust');

	await expect(page.getByTestId('pole-mimo-rozsahu')).toBeVisible();
	await expect(page.getByTestId('pole-mimo-rozsahu')).toContainText('Robust');
	await expect(page.getByTestId('nakreslit')).toBeDisabled();

	expect(errs).toEqual([]);
});

// #85 follow-up (Patrik potvrdil, Odoo 207 #1618564): n=2 delí sa VŽDY presne na
// stred (50/50), systém sa ignoruje — takže hláška o príliš úzkej šírke NESMIE
// spomínať systém ani KRAJNY (to by bolo zavádzajúce, keď sa nepoužíva).
test('príliš úzka šírka pre 2 polia: hláška NESPOMÍNA systém/KRAJNY, tlačidlo zablokované', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-FIX-POSUV-E', 'OP-POSUV5');

	await page.selectOption('#tvar', 'rovny');
	await page.locator('#s').fill('100');
	await page.locator('#v1').fill('500');
	await page.selectOption('#pocet', '2');
	await page.selectOption('#delenie', 'posuv');
	await page.selectOption('#system', 'Robust');

	await expect(page.getByTestId('pole-mimo-rozsahu')).toBeVisible();
	await expect(page.getByTestId('pole-mimo-rozsahu')).toContainText('2 polia');
	await expect(page.getByTestId('pole-mimo-rozsahu')).not.toContainText('Robust');
	await expect(page.getByTestId('nakreslit')).toBeDisabled();

	expect(errs).toEqual([]);
});

// #85 follow-up (Patrik potvrdil): "Ak sú dve polia sklo ide priamo na stred je
// jedno čí tam posuv je nie je" — presné rozpolenie, systém sa NEUPLATŇUJE.
test('n=2 „podľa posuvu": presne 50/50 nezávisle od systému, info text to hovorí, 0 chýb v konzole', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-FIX-POSUV-F', 'OP-POSUV6');

	await page.selectOption('#tvar', 'rovny');
	await page.locator('#s').fill('2000');
	await page.locator('#v1').fill('1500');
	await page.selectOption('#pocet', '2');
	await page.selectOption('#delenie', 'posuv');
	await page.selectOption('#system', 'Robust');

	await expect(page.locator('#pole0')).toHaveValue('1000');
	await expect(page.locator('#pole1')).toHaveValue('1000');
	await expect(page.getByTestId('sucet-poli')).toContainText('2000');
	await expect(page.getByTestId('posuv-info')).toContainText('50/50');
	await expect(page.getByTestId('posuv-info')).not.toContainText('Krajné pole');

	// systém zmenený na Slide — pri n=2 sa výsledok NESMIE zmeniť (systém sa ignoruje)
	await page.selectOption('#system', 'Slide');
	await expect(page.locator('#pole0')).toHaveValue('1000');
	await expect(page.locator('#pole1')).toHaveValue('1000');

	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('fix-vykres')).toBeVisible();
	const riadky = page.getByTestId('fix-tabulka').locator('tbody tr');
	await expect(riadky).toHaveCount(2);
	await expect(riadky.nth(0)).toContainText('1000 mm');
	await expect(riadky.nth(1)).toContainText('1000 mm');

	expect(errs).toEqual([]);
});
