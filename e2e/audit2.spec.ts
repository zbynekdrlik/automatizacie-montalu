// 2. dávka z auditu pokrytia — REAKTIVITA selectov, login redirect a režimový badge.
// Všetko čisto čítacie: žiaden zápis do Money, žiadna zmena konfigurácie vzorcov,
// takže tieto testy sa dajú pustiť aj proti NASADENEJ appke (BASE_URL).
//
// Audit #12 (primárne selecty), #13 (extra posuv), #33 (login redirect), #34 (badge).
// Pozn.: zlé heslo, prefill mena a ?next= deep-link už kryje app.spec.ts (1. dávka).
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, vyberSklo, ponukaSkla, vypocetSkla } from './helpers';

test('#12 primárne selecty: zmena systému snapne Štýl aj Sklo na platné hodnoty', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	// Robust má 4/16/4 sklá a štýl 2x4K; Slide má 4/8/4 + 6 mm sklá a 2x4K NEMÁ
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '2x4K');
	await vyberSklo(page.locator('#sklo'), 'Izolačné sklo 4/16/4 číre');

	await page.selectOption('#system', 'Slide');
	const styl = await page.locator('#styl').inputValue();
	// #594: sklo porovnávame ako VÝPOČTOVÉ sklo voľby (na PROD sú v ponuke len Odoo typy)
	const sklo = await vypocetSkla(page.locator('#sklo'));
	const slideStyly = await page.locator('#styl option').allTextContents();
	const slide = await ponukaSkla(page.locator('#sklo'));
	expect(slideStyly).not.toContain('2x4K');
	expect(slideStyly).toContain(styl); // vybraná hodnota je z NOVÉHO zoznamu
	expect(slide.vypocty).toContain(sklo);
	expect(sklo).not.toContain('4/16/4'); // Robustové sklo neprežije prepnutie
	// 6 mm skladba 3.3.1 je v lokálnej ponuke (v17); pri Odoo ponuke len ak ju počíta Odoo typ
	if (!slide.odoo) expect(slide.vypocty).toContain('3.3.1');

	// a naopak: Slide → Deluxe (Deluxe má vlastné sklá, žiadne Slide/Robust)
	await page.selectOption('#system', 'Deluxe');
	const deluxe = await ponukaSkla(page.locator('#sklo'));
	expect(deluxe.vypocty).toContain(await vypocetSkla(page.locator('#sklo')));
	expect(deluxe.vypocty.some((s) => s.includes('4/8/4'))).toBe(false);

	expect(errs).toEqual([]);
});

test('#13 extra posuv: zmena jeho systému snapne jeho štýl/sklo/otváranie (primárny sa nepohne)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '2x4K');
	await page.getByRole('button', { name: '➕ Pridať zasklenie' }).click();

	// nový posuv sa naklonuje z primárneho → Robust 2x4K
	await expect(page.locator('#ps0-sys')).toHaveValue('Robust');
	await expect(page.locator('#ps0-styl')).toHaveValue('2x4K');

	// prepni LEN posuv na Slide → jeho štýl aj sklo musia byť platné pre Slide
	await page.selectOption('#ps0-sys', 'Slide');
	const psStyly = await page.locator('#ps0-styl option').allTextContents();
	const psSkla = await ponukaSkla(page.locator('#ps0-sklo'));
	const psSklo = await vypocetSkla(page.locator('#ps0-sklo'));
	expect(psStyly).toContain(await page.locator('#ps0-styl').inputValue());
	expect(psSkla.vypocty).toContain(psSklo);
	expect(psStyly).not.toContain('2x4K');
	expect(psSklo).not.toContain('4/16/4');
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
	const presne = page.getByLabel('Presné zloženie skla (nepovinné — nemení vzorec)');
	// #594: pri Odoo ponuke je zvolený Odoo typ = presné zloženie → pole je skryté (#579)
	const odoo = (await ponukaSkla(page.locator('#sklo'))).odoo;
	if (odoo) await expect(presne).toBeHidden();
	else await presne.fill('Stopsol Grey');
	await page.getByLabel(/^Poznámka/).fill('prvý riadok\ndruhý riadok');
	await page.selectOption('#system', 'Slide');
	if (odoo) await expect(presne).toBeHidden();
	else await expect(presne).toHaveValue('Stopsol Grey');
	await expect(page.getByLabel(/^Poznámka/)).toHaveValue('prvý riadok\ndruhý riadok');
	expect(errs).toEqual([]);
});
