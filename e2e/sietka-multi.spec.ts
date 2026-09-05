// Samostatná sieťka MULTI (#473) — Patrik (kanál Appka vyroba, msg 1794336, 5.9.2026):
// „a sieťka tiež nefunguje" = /sietka nepodporovala viac rôznych sieťok naraz (STEP 0
// overil, že jednokusový výpočet je bez defektu — pozri design komentár na #473).
// Vzor UI/tok prevzatý z /clip multi (#468 fáza 2): prepínač → riadky (rôzny
// systém/štýl/rozmer/úchyt per kus, zdieľané ZAK/OP/zákazník/poznámka) → spoločný
// odpis = per-kus súčet, žiadny bin-packing. Zápisové testy používajú `skipAkLive`.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, goto, skipAkLive, waitHydrated } from './helpers';

async function hlavicka(page: Page, zak: string, zakaznik = 'E2E Sietka multi') {
	await goto(page, '/sietka');
	await page.getByTestId('sietka-multi-toggle').check();
	await page.locator('#m-zak').fill(zak);
	await page.locator('#m-op').fill('01');
	await page.locator('#m-zakaznik').fill(zakaznik);
}

test('multi: prepínač skryje jednokusový formulár a ukáže riadky kusov', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/sietka');

	await expect(page.locator('#zak')).toBeVisible();
	await page.getByTestId('sietka-multi-toggle').check();
	await expect(page.locator('#zak')).toHaveCount(0);
	await expect(page.locator('#m-zak')).toBeVisible();
	await expect(page.locator('#k0-system')).toBeVisible();

	expect(errs).toEqual([]);
});

test('multi: 2 rôzne sieťky (Robust 2K + Slide 3K) — per-kus karty + spoločný odpis súčet', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-SIETKA-MULTI-1');

	// kus 1 (predvolený riadok): Robust 2K — potrebuje 3K koľajnicu
	await page.locator('#k0-system').selectOption('Robust');
	await page.locator('#k0-styl').selectOption('2K');
	await page.locator('#k0-otvorS').fill('2509');
	await page.locator('#k0-otvorV').fill('1930');
	await page.locator('#k0-uchyt').selectOption('zamok');

	// kus 2: Slide 3K
	await page.getByTestId('sietka-add-kus').click();
	await page.locator('#k1-system').selectOption('Slide');
	await page.locator('#k1-styl').selectOption('3K');
	await page.locator('#k1-otvorS').fill('3500');
	await page.locator('#k1-otvorV').fill('2001');

	await page.getByRole('button', { name: 'Spočítať' }).click();
	await waitHydrated(page);

	await expect(page.getByTestId('sietka-multi-badge')).toContainText('2 kusov');
	// kus 1 karta: 2K → upozornenie na 3K koľajnicu + úchyt zámok
	const kus0 = page.getByTestId('sietka-multi-kus-0');
	await expect(kus0).toContainText('Robust 2K');
	await expect(kus0).toContainText('mŕtvy zapadávací zámok');
	await expect(page.getByTestId('sietka-multi-2k-0')).toContainText('3K');
	// kus 2 karta: 3K → žiadne 2K upozornenie
	const kus1 = page.getByTestId('sietka-multi-kus-1');
	await expect(kus1).toContainText('Slide 3K');
	await expect(page.getByTestId('sietka-multi-2k-1')).toHaveCount(0);

	// spoločný odpis obsahuje kódy z OBOCH kusov (kontraktné vektory z tests/compute.test.ts)
	const odpisText = (await page.locator('table').last().innerText()).replace(/\s+/g, ' ');
	expect(odpisText).toContain('ZASP00002'); // Robust rámový (kus 1)
	expect(odpisText).toContain('ZASP00016'); // 3K koľajnica (kus 1, 2K→3K swap)
	expect(odpisText).toContain('ZASP00088'); // Slide rámový (kus 2)
	expect(odpisText).toContain('ZASP202410'); // Slide nosový (kus 2)

	expect(errs).toEqual([]);
});

test('multi: 1 kus = presne rovnaký odpis ako jednokusový formulár (regresná parita)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	// (1) jednokusový formulár — referenčný odpis
	await goto(page, '/sietka');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-SIETKA-PARITA-SOLO');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Sietka parita');
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '3K');
	await page.locator('#otvorS').fill('4645');
	await page.locator('#otvorV').fill('2320');
	await page.getByTestId('spocitat-sietku').click();
	await waitHydrated(page);
	await expect(page.getByTestId('ram-profil')).toHaveText('2 ks + 2 ks');
	const solo = (await page.locator('table').last().innerText()).replace(/\s+/g, ' ');
	// falzifikovateľná parita (review nález issue 473 — predošlý `toContain('15')` matchol
	// takmer čokoľvek): odčítaj SKUTOČNÚ metre hodnotu ZASP00002 riadku zo SOLO tabuľky
	// (posledná bunka `td` — Money-formátovaná `fmtM(...) m`), kým je solo výsledok ešte
	// na obrazovke — nižšie ju porovnáme so zodpovedajúcou bunkou v MULTI tabuľke.
	const soloMetre = (
		await page
			.getByRole('row', { name: /ZASP00002/ })
			.locator('td')
			.last()
			.innerText()
	).trim();

	// (2) multi s JEDNÝM rovnakým kusom — musí dať identický riadok kódov/metrov
	await hlavicka(page, 'E2E-SIETKA-PARITA-MULTI');
	await page.locator('#k0-system').selectOption('Robust');
	await page.locator('#k0-styl').selectOption('3K');
	await page.locator('#k0-otvorS').fill('4645');
	await page.locator('#k0-otvorV').fill('2320');
	await page.getByRole('button', { name: 'Spočítať' }).click();
	await waitHydrated(page);
	const multiOdpis = (await page.locator('table').last().innerText()).replace(/\s+/g, ' ');

	// rovnaké kódy + PRESNE rovnaká metre hodnota ako v solo tabuľke (nie len ľubovoľná
	// podreťazcová zhoda) — toto je falzifikovateľné: iná metráž v multi vetve padne.
	expect(multiOdpis).toContain('ZASP00002');
	await expect(
		page
			.getByRole('row', { name: /ZASP00002/ })
			.locator('td')
			.last()
	).toHaveText(soloMetre);
	expect(solo).toContain('ZASP00002');

	expect(errs).toEqual([]);
});

// ZÁPISOVÝ → `skipAkLive`, rovnaký vzor ako jednokusová /sietka odoslanie
test('multi: Odoslať do Money zapíše JEDEN odpis pre viac kusov (TEST režim)', async ({ page }) => {
	const errs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	const zak = `E2E-SIETKA-MULTI-ODO-${Date.now().toString(36)}`;
	await hlavicka(page, zak);

	await page.locator('#k0-system').selectOption('Robust');
	await page.locator('#k0-styl').selectOption('3K');
	await page.locator('#k0-otvorS').fill('4645');
	await page.locator('#k0-otvorV').fill('2320');
	await page.getByTestId('sietka-add-kus').click();
	await page.locator('#k1-system').selectOption('Slide');
	await page.locator('#k1-styl').selectOption('3K');
	await page.locator('#k1-otvorS').fill('3500');
	await page.locator('#k1-otvorV').fill('2001');

	await page.getByRole('button', { name: 'Spočítať' }).click();
	await waitHydrated(page);
	await page.getByTestId('odoslat-sietku-multi').click();
	await waitHydrated(page);

	await expect(page.getByText('Odpis odoslaný')).toBeVisible();
	await expect(page.locator('.sub', { hasText: zak })).toContainText('2 kusov');

	// odoslanie ROVNAKÉHO ZAK+OP znova musí ukázať duplikát, nie prázdnu stránku
	// (rovnaká pasca ako jednokusová /sietka, PR #108)
	await hlavicka(page, zak);
	await page.locator('#k0-system').selectOption('Robust');
	await page.locator('#k0-styl').selectOption('3K');
	await page.locator('#k0-otvorS').fill('4645');
	await page.locator('#k0-otvorV').fill('2320');
	await page.getByTestId('sietka-add-kus').click();
	await page.locator('#k1-system').selectOption('Slide');
	await page.locator('#k1-styl').selectOption('3K');
	await page.locator('#k1-otvorS').fill('3500');
	await page.locator('#k1-otvorV').fill('2001');
	await page.getByRole('button', { name: 'Spočítať' }).click();
	await waitHydrated(page);
	await page.getByTestId('odoslat-sietku-multi').click();
	await waitHydrated(page);
	await expect(page.getByTestId('sietka-multi-duplikat')).toContainText('už bola odoslaná');
	// karta s výsledkom ostáva vidno pod hláškou — nie je to prázdna stránka
	await expect(page.getByTestId('sietka-multi-badge')).toBeVisible();

	expect(errs).toEqual([]);
});

test('multi: „← Späť a upraviť" zachová všetky riadky kusov (round-trip)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await hlavicka(page, 'E2E-SIETKA-MULTI-RT');

	await page.locator('#k0-system').selectOption('Robust');
	await page.locator('#k0-styl').selectOption('2K');
	await page.locator('#k0-otvorS').fill('2000');
	await page.locator('#k0-otvorV').fill('1500');
	await page.getByTestId('sietka-add-kus').click();
	await page.locator('#k1-system').selectOption('Slide');
	await page.locator('#k1-styl').selectOption('3K');
	await page.locator('#k1-otvorS').fill('3000');
	await page.locator('#k1-otvorV').fill('2000');

	await page.getByRole('button', { name: 'Spočítať' }).click();
	await waitHydrated(page);
	await expect(page.getByTestId('sietka-multi-badge')).toBeVisible();

	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);

	await expect(page.locator('#m-zak')).toHaveValue('E2E-SIETKA-MULTI-RT');
	await expect(page.locator('#k0-system')).toHaveValue('Robust');
	await expect(page.locator('#k0-styl')).toHaveValue('2K');
	await expect(page.locator('#k0-otvorS')).toHaveValue('2000');
	await expect(page.locator('#k1-system')).toHaveValue('Slide');
	await expect(page.locator('#k1-otvorS')).toHaveValue('3000');

	expect(errs).toEqual([]);
});

test('multi: odstrániť riadok — posledný riadok sa nedá odstrániť', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/sietka');
	await page.getByTestId('sietka-multi-toggle').check();

	// jediný riadok — žiadne tlačidlo Odstrániť
	await expect(page.getByRole('button', { name: '✕ Odstrániť' })).toHaveCount(0);

	await page.getByTestId('sietka-add-kus').click();
	await expect(page.locator('#k1-system')).toBeVisible();
	await expect(page.getByRole('button', { name: '✕ Odstrániť' })).toHaveCount(2);

	await page.getByRole('button', { name: '✕ Odstrániť' }).first().click();
	await expect(page.locator('#k1-system')).toHaveCount(0);
	await expect(page.getByRole('button', { name: '✕ Odstrániť' })).toHaveCount(0);

	expect(errs).toEqual([]);
});
