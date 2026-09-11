// #504 round 3 — Štandard+ opona IZO (2×2K/2×3K/2×4K). Reálny prehliadač, READ-ONLY
// náhľad (nič sa nezapisuje do Money → bezpečné aj na LIVE, žiadny skipAkLive). Patrik
// (úloha 854, msg 1821818) hlásil, že pri Štandard+ opone chýba IZO 16 mm sklo — round 3
// doplnil nárezák (2×4K 1:1 z Money Excelu msg 1823604, 2×2K/2×3K odvodené). Test overuje:
//  1. IZO 4/16/4 sklo je pri opone PONÚKANÉ (predtým filtrované) a plán sa vykreslí,
//  2. 2×4K odpis = 1:1 čísla z Excelu (sklo 574×1965, U-profil ZASP202439 57,6 m,
//     spodná koľajnica ZASP202432 z default „prídavnej"),
//  3. 2×2K/2×3K majú v pláne čestné „odvodené" upozornenie (banner plan-warn).
// Každý test vyžaduje NULA console errors/warnings (browser-console-zero-errors).
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, vyberFarbuKovania } from './helpers';

const RUN = `E2E-OPIZO-${Date.now().toString(36).toUpperCase()}`;

test('Štandard+ 2×4K opona IZO: 16 mm sklo ponúkané, plán 1:1 z Money Excelu', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-4K`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Opona IZO');
	await page.getByLabel('Systém').selectOption('Štandard +');
	// opona štýl → otváranie sa automaticky nastaví na „Opona"
	await page.getByLabel('Štýl').selectOption('2x4K');
	await page.getByLabel('Šírka (mm) *').fill('5000');
	await page.getByLabel('Výška (mm) *').fill('2100');
	// #504 round 3: IZO 16 mm (4/16/4) je teraz PONÚKANÉ aj pri opone (predtým filtrované).
	// selectOption zlyhá, ak by option neexistoval → to je RED pred opravou.
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Izolačné sklo 4/16/4 číre');

	// IZO pri Štandard+ → „prídavná koľajnica" default zaškrtnutá (#132) → spodná o 1 väčšia
	await expect(page.getByLabel(/Prídavná koľajnica/)).toBeChecked();
	await vyberFarbuKovania(page); // Štandard+ nemá farbu kovania → no-op
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	// plán sa vykreslí; sklo (len plán, nie Money) 574 × 1965 — 1:1 z Excel formúl
	await expect(page.getByTestId('nahlad-2d')).toBeVisible();
	await expect(page.getByTestId('sklo-sirka')).toHaveText('574');
	await expect(page.getByTestId('sklo-vyska')).toHaveText('1965');
	// U-profil ZASP202439 = 57,6 m (dôkaz IZO nárezáku); spodná koľajnica ZASP202432
	// (default „prídavná" zväčšila ZASP00033→ZASP202432, presne ako v Exceli)
	await expect(page.locator('.row', { hasText: 'ZASP202439' })).toContainText(/(^|\D)57,6 m/);
	await expect(page.locator('.row', { hasText: 'ZASP202432' })).toContainText(/(^|\D)7,5 m/);
	await expect(page.locator('.row', { hasText: 'ZASP00033' })).toHaveCount(0);
	expect(consoleMsgs).toEqual([]);
});

test('Štandard+ 2×2K opona IZO: plán má čestné „odvodené" upozornenie', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-2K`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Opona IZO odvodené');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2x2K');
	await page.getByLabel('Šírka (mm) *').fill('5000');
	await page.getByLabel('Výška (mm) *').fill('2100');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Izolačné sklo 4/16/4 číre');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	// 2×2K opona IZO je ODVODENÉ → plán ukáže čestný banner (Money-safety honesty)
	await expect(page.getByTestId('nahlad-2d')).toBeVisible();
	await expect(page.getByTestId('plan-warn')).toContainText(/odvoden/i);
	expect(consoleMsgs).toEqual([]);
});
