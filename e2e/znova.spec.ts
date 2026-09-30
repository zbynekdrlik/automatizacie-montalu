// „Použiť znova" z histórie — Patrik 2026-07-31: „môže znova zavolať to, čo použil
// minule, len zmení zákazníka, viacerí zákazníci si objednávajú to isté".
//
// Cez REÁLNY prehliadač: odošli odpis (v testovom režime — do Money nejde nič), potom
// z histórie klikni „Použiť znova" a over, že sa zadanie predvyplnilo a že ZAK/OP/
// zákazník ostali PRÁZDNE. Test sa preskočí, ak beží proti LIVE inštancii.
import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import {
	collectConsole,
	goto,
	loginAs,
	waitHydrated,
	skipAkLive,
	vyberFarbuKovania,
	ponukaSkla,
	expectSklo
} from './helpers';

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
	// #594: sklo sa obnoví — v CI lokálne 4/16/4 číre, pri Odoo ponuke Odoo voľba počítaná ním
	await expectSklo(page.locator('#sklo'), 'Izolačné sklo 4/16/4 číre');

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
	// #594: VÝPOČTOVÉ sklá ponuky (na PROD Odoo typy) — len izolačné 4/16/4, žiadne kalené
	const p = await ponukaSkla(page.getByLabel('Sklo (základ — určuje vzorec)'));
	expect(p.vypocty.some((g) => /Izolačné sklo 4\/16\/4/.test(g))).toBe(true);
	expect(p.vypocty.some((g) => /kalen/i.test(g))).toBe(false);

	expect(errs).toEqual([]);
});

// #599 (ROZHODNUTÉ main 30.9., Odoo úloha 1218): Štandardy už 24 mm (4/16/4) neponúkajú ani v
// lokálnej zálohe. Starý odpis so 4/16/4 sa pri „Použiť znova" NESMIE zahodiť — select ho ukáže
// ako doplnkovú voľbu „<sklo> · pôvodné sklo z appky" (vzor #594) a výpočet ide ďalej ním.
// Starý odpis sa nedá vytvoriť cez UI (sklo sa už neponúka) → seed riadku histórie priamo do
// e2e.db (vzor `dopyty-konfigurator.spec.ts`), len preview beh; nič sa neodpisuje.
test('„Použiť znova" starého Štandard + odpisu so 4/16/4 ukáže sklo ako pôvodné sklo z appky (#599)', async ({
	page
}) => {
	const errs = collectConsole(page);
	// seed ide do lokálneho e2e.db — PROD (live) preskočí helper, nie nový BASE_URL skip riadok
	await skipAkLive(page);
	const zak = `E2E-ZNOVA-24-${Date.now()}`;
	const db = new Database('./data/e2e.db');
	let id: number;
	try {
		id = Number(
			db
				.prepare(
					`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by)
					 VALUES ('zasklenia', ?, '01', 'Starý zákazník', 0, 0, '/tmp', 'x.xlsx', 'e2e-599', ?, 'e2e')`
				)
				.run(
					zak,
					JSON.stringify({
						system: 'Štandard +',
						styl: '3K',
						s: 3000,
						v: 2400,
						sklo: 'Izolačné sklo 4/16/4 číre',
						skloZaklad: 'Izolačné sklo 4/16/4 číre',
						otvaranie: 'P - L'
					})
				).lastInsertRowid
		);
	} finally {
		db.close();
	}

	await loginAs(page);
	await goto(page, `/zasklenia?znova=${id}`);

	const info = page.getByTestId('znova-info');
	await expect(info).toContainText(zak);
	// sklo sa NEZAHODILO — žiadna hláška „sa už neponúka"
	await expect(info).not.toContainText('neponúka');
	await expect(page.getByLabel('Systém')).toHaveValue('Štandard +');
	const sklo = page.getByLabel('Sklo (základ — určuje vzorec)');
	await expectSklo(sklo, 'Izolačné sklo 4/16/4 číre');
	await expect(sklo.locator('option:checked')).toHaveText(
		'Izolačné sklo 4/16/4 číre · pôvodné sklo z appky'
	);
	// 4/16/4 je v ponuke LEN ako táto jediná doplnková voľba
	const p = await ponukaSkla(sklo);
	expect(p.vypocty.filter((s) => /4\/16\/4/.test(s))).toEqual(['Izolačné sklo 4/16/4 číre']);

	expect(errs).toEqual([]);
});
