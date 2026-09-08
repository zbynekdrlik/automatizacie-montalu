// #496: objednávka skla — reálny tok obsluhy: spočítať nárezový plán na /zasklenia,
// „Pridať sklá do objednávky" (?/pridatSkla), presmerovanie na /objednavka-skla/[zak],
// pridaná položka viditeľná s reálne dopočítanými rozmermi/počtom/typom skla, a
// rozmery/atyp prepínač (režim) sprístupní upload vstup. Zápisový tok (píše do
// objednavka_skla, nie do Money) — skipAkLive na ostrom nasadení preskočí.
import { test, expect } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	skipAkLive,
	vyberFarbuKovania
} from './helpers';

const RUN = `E2E-SKLA-${Date.now().toString(36).slice(-5)}`;

test('zasklenia: spočítať → Pridať sklá do objednávky → podklad s reálnymi rozmermi + atyp prepínač', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);
	await goto(page, '/zasklenia');

	const zak = `${RUN}-01`;
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Objednávka skla');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2200');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	// reálne dopočítané hodnoty (nie ručne odvodené) — čítame ich z karty „Sklo (mm)"
	// PRED presmerovaním, aby sa dali overiť po presune na podklad objednávky
	await expect(page.getByTestId('sklo-sirka')).toBeVisible();
	const sirkaTxt = (await page.getByTestId('sklo-sirka').textContent()) ?? '';
	const vyskaTxt = (await page.getByTestId('sklo-vyska').textContent()) ?? '';
	const typTxt = ((await page.locator('span:text-is("Typ") + b').textContent()) ?? '').trim();
	const pocetTxt = (await page.locator('span:text-is("Počet") + b').textContent()) ?? '';
	const sirka = Math.round(Number(sirkaTxt.replace(',', '.')));
	const vyska = Math.round(Number(vyskaTxt.replace(',', '.')));
	const pocet = parseInt(pocetTxt, 10);
	expect(sirka).toBeGreaterThan(0);
	expect(vyska).toBeGreaterThan(0);
	expect(pocet).toBeGreaterThan(0);
	expect(typTxt.length).toBeGreaterThan(0);

	await page.getByTestId('pridat-skla').click();
	await page.waitForURL(/\/objednavka-skla\//);
	await waitHydrated(page);

	// presmerovanie na podklad objednávky KONKRÉTNEJ zákazky
	await expect(page.getByRole('heading', { name: `Objednávka skla — ${zak}` })).toBeVisible();

	const riadok = page.locator('tbody tr').first();
	await expect(riadok).toBeVisible();
	await expect(riadok.locator('td').nth(0)).toContainText('Robust 2K'); // popis: system + styl
	await expect(riadok.locator('td').nth(1)).toContainText(String(sirka));
	await expect(riadok.locator('td').nth(1)).toContainText(String(vyska));
	await expect(riadok.locator('td').nth(2)).toContainText(typTxt);
	await expect(riadok.locator('td').nth(3)).toContainText(String(pocet));

	// rozmery/atyp prepínač: pred prepnutím žiadny upload vstup, po prepnutí sa objaví
	await expect(riadok.locator('input[type="file"]')).toHaveCount(0);
	await riadok.locator('select[name="rezim"]').selectOption('atyp');
	await waitHydrated(page);

	const riadokPoPrepnuti = page.locator('tbody tr').first();
	await expect(riadokPoPrepnuti.locator('input[type="file"]')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});
