// Cena skla v nárezáku zasklení (#225) — DISPLAY-ONLY náklad na sklo (plocha ×
// cena/m²). „cena nedostupná" bez ceny (honest-null), reálna (VYMYSLENÁ) cena so
// seednutým fixture snapshotom, a NOPRINT (v tlači skrytý — dielňa cenu nevidí).
// VŠETKY ceny TU sú VYMYSLENÉ (repo je verejné — nikdy reálnu Money cenu). TS00016
// je Money kód pre „Izolačné sklo 4/16/4 číre" (v23 seed). Nula console errors všade.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { collectConsole, loginAs, goto, vyberFarbuKovania } from './helpers';

const SKLO = 'Izolačné sklo 4/16/4 číre';

async function vyplnRobust2K(page: import('@playwright/test').Page, zak: string, sklo = SKLO) {
	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Sklo Cena');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption(sklo);
}

test('bez ceny skla v snapshote appka ukáže „cena nedostupná" (honest-null)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	// lokálny beh: istota, že žiadny predošlý test nezanechal fixture (post-deploy beh
	// proti BASE_URL na tento súbor nemá prístup — no-op)
	if (!process.env.BASE_URL) fs.rmSync('./data/e2e-ceny.json', { force: true });
	await loginAs(page);
	await vyplnRobust2K(page, `E2E-SKLOCENA-BEZ-${Date.now()}`);
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	await expect(page.getByTestId('sklo-cena')).toBeVisible();
	await expect(page.getByTestId('sklo-cena-m2-0')).toHaveText('cena nedostupná');
	await expect(page.getByTestId('sklo-cena-spolu-0')).toHaveText('cena nedostupná');
	expect(consoleMsgs).toEqual([]);
});

test('so seednutým Money snapshotom appka ukáže reálnu (vymyslenú) cenu skla', async ({ page }) => {
	// beh proti nasadenej appke (BASE_URL) nemá prístup k jej kontajnerovému FS —
	// fixture sa dá napísať LEN pri lokálnom preview serveri
	test.skip(
		!!process.env.BASE_URL,
		'post-deploy: nedá sa zapísať fixture do vzdialeného kontajnera'
	);
	const consoleMsgs = collectConsole(page);
	fs.writeFileSync(
		'./data/e2e-ceny.json',
		JSON.stringify({
			generatedAt: new Date().toISOString(),
			rows: [
				// TS00016 = „Izolačné sklo 4/16/4 číre"; 42,50 €/m² je VYMYSLENÉ
				{
					kod: 'TS00016',
					nakupCennik: 42.5,
					nakupPoslednaFaktura: null,
					predajVo: null,
					mena: 'EUR',
					sklad: null
				}
			]
		})
	);
	await loginAs(page);
	await vyplnRobust2K(page, `E2E-SKLOCENA-CENA-${Date.now()}`);
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	const spolu = page.getByTestId('sklo-cena-spolu-0');
	await expect(spolu).toBeVisible();
	await expect(page.getByTestId('sklo-cena-m2-0')).toContainText('€/m²');
	await expect(spolu).not.toHaveText('cena nedostupná');
	await expect(spolu).toContainText('€');
	expect(consoleMsgs).toEqual([]);
});

test('náklad na sklo je NOPRINT — v tlačovom náhľade skrytý (dielňa cenu nevidí)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	if (!process.env.BASE_URL) fs.rmSync('./data/e2e-ceny.json', { force: true });
	await loginAs(page);
	await vyplnRobust2K(page, `E2E-SKLOCENA-PRINT-${Date.now()}`);
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	const blok = page.getByTestId('sklo-cena');
	await expect(blok).toBeVisible(); // na obrazovke viditeľný
	await page.emulateMedia({ media: 'print' });
	await expect(blok).toBeHidden(); // v tlači skrytý (.noprint)
	await page.emulateMedia({ media: 'screen' });
	expect(consoleMsgs).toEqual([]);
});
