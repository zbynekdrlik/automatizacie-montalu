// #154 (fáza 1): cenový zoznam materiálu — "cena neznáma" bez Money snapshotu,
// reálne čísla so seednutým fixture snapshotom, a detail v histórii odpisov
// (/odpisy/[id]). VŠETKY ceny v tomto súbore sú VYMYSLENÉ (repo je verejné —
// nikdy sem nepíš reálnu Money cenu). Nula console errors/warnings všade.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { collectConsole, loginAs, goto, skipAkLive, vyberFarbuKovania } from './helpers';

// Robust|2K@2509×1930 — presne ten istý vektor ako tests/money.test.ts (kód
// ZASP00014 v odpise overený 1:1), aby fixture snapshot nižšie vedel presne, ktoré
// 3 kódy (ZASP00014/ZASP00002/ZASP00010, viď cfg_seed.json Robust|2K) pokryť.
async function vyplnZasklenie(page: import('@playwright/test').Page, zak: string) {
	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Ceny');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
}

test('bez Money snapshotu appka ukáže "cena neznáma" v náhľade, súčty priznané ako neúplné', async ({
	page
}) => {
	// #466: prod MÁ reálny Money snapshot → ceny sú známe, test by padol. Honest-null
	// cestu overujeme len proti lokálnemu preview s vymazaným fixture súborom.
	test.skip(
		!!process.env.BASE_URL,
		'post-deploy: prod má reálny Money snapshot — honest-null cesta neplatí'
	); // airuleset:test-skip-ok sanctioned BASE_URL guard per ci.md (#466)
	const consoleMsgs = collectConsole(page);
	// lokálny beh: istota, že žiadny predošlý test/beh nezanechal fixture súbor
	if (!process.env.BASE_URL) fs.rmSync('./data/e2e-ceny.json', { force: true });
	await loginAs(page);
	await vyplnZasklenie(page, `E2E-CENY-BEZ-${Date.now()}`);
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	await expect(page.getByTestId('ceny-tabulka')).toBeVisible();
	await expect(page.getByTestId('ceny-snapshot-vek')).toContainText('nebol naimportovaný');
	await expect(page.getByTestId('cena-nakup-cennik-ZASP00014')).toHaveText('cena neznáma');
	await expect(page.getByTestId('cena-predaj-vo-ZASP00014')).toHaveText('cena neznáma');
	await expect(page.getByTestId('ceny-sucet-nakup-cennik')).toContainText('neúplné');
	expect(consoleMsgs).toEqual([]);
});

test('so seednutým Money snapshotom appka ukáže reálne (vymyslené) ceny + kompletné súčty', async ({
	page
}) => {
	// beh proti nasadenej appke (BASE_URL) nemá prístup k jej kontajnerovému
	// filesystemu — fixture sa dá napísať LEN pri lokálnom preview serveri
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
				{
					kod: 'ZASP00014',
					nakupCennik: 5.5,
					nakupPoslednaFaktura: 6.5,
					predajVo: 8,
					mena: 'EUR',
					sklad: 100
				},
				{
					kod: 'ZASP00002',
					nakupCennik: 4.5,
					nakupPoslednaFaktura: 5.5,
					predajVo: 7,
					mena: 'EUR',
					sklad: 200
				},
				{
					kod: 'ZASP00010',
					nakupCennik: 3.5,
					nakupPoslednaFaktura: 4.5,
					predajVo: 6,
					mena: 'EUR',
					sklad: 300
				}
			]
		})
	);
	await loginAs(page);
	await vyplnZasklenie(page, `E2E-CENY-OK-${Date.now()}`);
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	// Robust vždy pridáva aj kovanie/tesnenia (ZASK* kódy, mimo tejto fixture) —
	// súčet teda ostáva "neúplný" (správne, viď ceny.test.ts pre presný dôkaz
	// kompletnosti); tu overujeme LEN že SEEDNUTÉ kódy ukazujú reálne čísla
	// a súčet zahŕňa ich hodnotu (176,25 € = 5,5×15 + 4,5×15 + 3,5×7,5).
	await expect(page.getByTestId('ceny-snapshot-vek')).toContainText('Ceny zo snapshotu Money k');
	await expect(page.getByTestId('cena-nakup-cennik-ZASP00014')).toContainText('€');
	await expect(page.getByTestId('cena-nakup-cennik-ZASP00014')).not.toHaveText('cena neznáma');
	await expect(page.getByTestId('cena-nakup-cennik-ZASP00002')).toContainText('€');
	await expect(page.getByTestId('cena-nakup-cennik-ZASP00010')).toContainText('€');
	await expect(page.getByTestId('ceny-sucet-nakup-cennik')).toContainText('176,25 €');
	expect(consoleMsgs).toEqual([]);
});

test('/odpisy/[id]: detail histórie ukáže položky + ceny KONKRÉTNEHO odpisu', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page); // odoslanie nižšie zapisuje (TEST režim) — na LIVE sa preskočí
	await loginAs(page);
	const zak = `E2E-CENY-DETAIL-${Date.now()}`;
	await vyplnZasklenie(page, zak);
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	await goto(page, '/odpisy');
	const row = page.locator('tr', { hasText: zak }).first();
	await row.getByTestId(/^detail-/).click();

	await expect(page.locator('h1')).toContainText(zak);
	await expect(page.getByTestId('ceny-tabulka')).toBeVisible();
	await expect(page.getByTestId('cena-nakup-cennik-ZASP00014')).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});

test('Lakovanie (#369): sekcia sa zobrazí pre zasklenie — honest-null bez Money rozvinu, náklad čaká na sadzby', async ({
	page
}) => {
	// #466: prod má reálny Money snapshot s rozvinmi → honest-null test by padol.
	// Compute so seednutým rozvinom pokrytý server-side (tests/ceny.test.ts + lakovanie.test.ts).
	test.skip(
		!!process.env.BASE_URL,
		'post-deploy: prod má reálny Money snapshot s rozvinmi — honest-null cesta neplatí'
	); // airuleset:test-skip-ok sanctioned BASE_URL guard per ci.md (#466)
	const consoleMsgs = collectConsole(page);
	// bez fixture snapshotu → material_prices nemá rozvin → honest-null cesta
	if (!process.env.BASE_URL) fs.rmSync('./data/e2e-ceny.json', { force: true });
	await loginAs(page);
	await vyplnZasklenie(page, `E2E-LAK-${Date.now()}`);
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	// Lakovanie je VLASTNÁ karta MIMO ceny-tabulka (#369 review 🔴 — inak by profilové
	// riadky duplikovali ceny-tabulka lokátory). ZASP profil bez rozvinu → honest-null.
	const lak = page.getByTestId('lakovanie-tabulka');
	await expect(lak).toBeVisible();
	await expect(page.getByTestId('lak-rozvin-ZASP00014')).toHaveText('neznáme');
	await expect(page.getByTestId('lak-spotreba-ZASP00014')).toHaveText('neznáme');
	// súčet neúplný (lakovaný profil bez rozvinu) + €-náklad vždy honest-null
	await expect(page.getByTestId('lakovanie-sucet-spotreba')).toContainText('neúplné');
	await expect(page.getByTestId('lakovanie-naklad-eur')).toHaveText('čaká na sadzby');
	// kovanie (ZASK) sa do lakovania NEDOSTANE (nie je profilová rodina)
	await expect(lak).not.toContainText('ZASK');
	expect(consoleMsgs).toEqual([]);
});

test('/odpisy/[id]: neexistujúci odpis vráti 404, nie prázdnu/rozbitú stránku', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	const res = await page.request.get('/odpisy/999999999');
	expect(res.status()).toBe(404);
	// 404 response nie je navigácia (page.request.get neopúšťa aktuálnu stránku) —
	// console sa teda kontroluje len na to, čo doteraz vzniklo (login)
	expect(consoleMsgs).toEqual([]);
});
