// 2. dávka z auditu pokrytia — REAKTIVITA selectov, login redirect a režimový badge.
// Všetko čisto čítacie: žiaden zápis do Money, žiadna zmena konfigurácie vzorcov,
// takže tieto testy sa dajú pustiť aj proti NASADENEJ appke (BASE_URL).
//
// Audit #12 (primárne selecty), #13 (extra posuv), #33 (login redirect), #34 (badge).
// Pozn.: zlé heslo, prefill mena a ?next= deep-link už kryje app.spec.ts (1. dávka).
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs } from './helpers';

test('#12 primárne selecty: zmena systému snapne Štýl aj Sklo na platné hodnoty', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	// Robust má 4/16/4 sklá a štýl 2x4K; Slide má 4/8/4 + 6 mm sklá a 2x4K NEMÁ
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '2x4K');
	await page.selectOption('#sklo', 'Izolačné sklo 4/16/4 číre');

	await page.selectOption('#system', 'Slide');
	const styl = await page.locator('#styl').inputValue();
	const sklo = await page.locator('#sklo').inputValue();
	const slideStyly = await page.locator('#styl option').allTextContents();
	const slideSkla = await page.locator('#sklo option').allTextContents();
	expect(slideStyly).not.toContain('2x4K');
	expect(slideStyly).toContain(styl); // vybraná hodnota je z NOVÉHO zoznamu
	expect(slideSkla).toContain(sklo);
	expect(sklo).not.toContain('4/16/4'); // Robustové sklo neprežije prepnutie
	expect(slideSkla).toContain('3.3.1'); // 6 mm skladba je v ponuke (v17)

	// a naopak: Slide → Deluxe (Deluxe má vlastné sklá, žiadne Slide/Robust)
	await page.selectOption('#system', 'Deluxe');
	const deluxeSkla = await page.locator('#sklo option').allTextContents();
	expect(deluxeSkla).toContain(await page.locator('#sklo').inputValue());
	expect(deluxeSkla.some((s) => s.includes('4/8/4'))).toBe(false);

	expect(errs).toEqual([]);
});

test('#13 extra posuv: zmena jeho systému snapne jeho štýl/sklo/otváranie (primárny sa nepohne)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '2x4K');
	await page.getByRole('button', { name: '➕ Pridať posuv' }).click();

	// nový posuv sa naklonuje z primárneho → Robust 2x4K
	await expect(page.locator('#ps0-sys')).toHaveValue('Robust');
	await expect(page.locator('#ps0-styl')).toHaveValue('2x4K');

	// prepni LEN posuv na Slide → jeho štýl aj sklo musia byť platné pre Slide
	await page.selectOption('#ps0-sys', 'Slide');
	const psStyly = await page.locator('#ps0-styl option').allTextContents();
	const psSkla = await page.locator('#ps0-sklo option').allTextContents();
	expect(psStyly).toContain(await page.locator('#ps0-styl').inputValue());
	expect(psSkla).toContain(await page.locator('#ps0-sklo').inputValue());
	expect(psStyly).not.toContain('2x4K');
	expect(await page.locator('#ps0-sklo').inputValue()).not.toContain('4/16/4');
	// primárny posuv zmena extra posuvu NESMIE ovplyvniť
	await expect(page.locator('#system')).toHaveValue('Robust');
	await expect(page.locator('#styl')).toHaveValue('2x4K');

	// 2x štýl vynúti otváranie „Opona" (je to jedna opona od stredu)
	await page.selectOption('#ps0-styl', '2x3K');
	await expect(page.locator('#ps0-otv')).toHaveValue('Opona');

	expect(errs).toEqual([]);
});

test('#33 login: už prihlásený užívateľ je z /login presmerovaný preč', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await page.goto('/login');
	await expect(page).toHaveURL(/\/zasklenia/);
	await expect(page.getByRole('button', { name: 'Prihlásiť' })).toHaveCount(0);
	expect(errs).toEqual([]);
});

test('#34 režimový badge zodpovedá skutočnému režimu appky (LIVE vs TEST)', async ({
	page,
	request
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	const badge = page.getByTestId('mode');
	await expect(badge).toBeVisible();

	// zdroj pravdy je /health („live": true/false) — badge sa s ním nesmie rozísť
	const health = await (await request.get('/health')).json();
	if (health.live) await expect(badge).toHaveText('● LIVE');
	else await expect(badge).toHaveText('🧪 TEST režim');

	expect(errs).toEqual([]);
});

test('#12b presné zloženie skla a poznámka prežijú prepnutie systému (nevymažú sa)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await page.getByLabel('Presné zloženie skla (nepovinné — nemení vzorec)').fill('Stopsol Grey');
	await page.getByLabel(/^Poznámka/).fill('prvý riadok\ndruhý riadok');
	await page.selectOption('#system', 'Slide');
	await expect(page.getByLabel('Presné zloženie skla (nepovinné — nemení vzorec)')).toHaveValue(
		'Stopsol Grey'
	);
	await expect(page.getByLabel(/^Poznámka/)).toHaveValue('prvý riadok\ndruhý riadok');
	expect(errs).toEqual([]);
});
