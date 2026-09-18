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

	// #514: „Pridať sklá" už NEpresmeruje preč — ostane výsledok s potvrdením + odkazom;
	// z odkazu prejdeme na podklad objednávky.
	await page.getByTestId('pridat-skla').click();
	await waitHydrated(page);
	await expect(page.getByTestId('skla-pridane')).toBeVisible();
	await page.getByTestId('skla-pridane-odkaz').click();
	await page.waitForURL(/\/objednavka-skla\//);
	await waitHydrated(page);

	// podklad objednávky KONKRÉTNEJ zákazky
	await expect(page.getByRole('heading', { name: `Objednávka skla — ${zak}` })).toBeVisible();

	const riadok = page.locator('tbody tr').first();
	await expect(riadok).toBeVisible();
	await expect(riadok.locator('td').nth(0)).toContainText('Robust 2K'); // popis: system + styl
	await expect(riadok.locator('td').nth(1)).toContainText(String(sirka));
	await expect(riadok.locator('td').nth(1)).toContainText(String(vyska));
	await expect(riadok.locator('td').nth(2)).toContainText(typTxt);
	await expect(riadok.locator('td').nth(3)).toContainText(String(pocet));

	// #540: picker typu skla — select v riadku + zdroj zoznamu. Proti preview cieľu (bez Odoo
	// pripojenia) je zdroj lokálny fallback, nikdy tichý prázdny select.
	await expect(riadok.locator('select[name="typ_skla"]')).toBeVisible();
	await expect(riadok.locator('select[name="typ_skla"] option')).not.toHaveCount(0);
	await expect(page.getByTestId('glass-types-source')).toContainText('lokálny zoznam');

	// rozmery/atyp prepínač: pred prepnutím žiadny upload vstup, po prepnutí sa objaví
	await expect(riadok.locator('input[type="file"]')).toHaveCount(0);
	await riadok.locator('select[name="rezim"]').selectOption('atyp');
	await waitHydrated(page);

	const riadokPoPrepnuti = page.locator('tbody tr').first();
	await expect(riadokPoPrepnuti.locator('input[type="file"]')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

// #545: prázdny podklad (servisná zákazka bez nárezáku) → formulár „Pridať riadok" je viditeľný
// aj bez položiek → pridá sa ručný riadok (typ z pickera, atyp) → riadok pod „Pridané položky" →
// nastaví sa OP → tlačidlo Odoslať je zapnuté. NIKDY nesend-uje (proti live sa test skipne).
test('objednávka skla: prázdny podklad → ručný riadok + OP → Odoslať zapnuté', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);

	const zak = `${RUN}-SERVIS`;
	await goto(page, `/objednavka-skla/${zak}`);
	await expect(page.getByRole('heading', { name: `Objednávka skla — ${zak}` })).toBeVisible();

	// prázdny podklad: formulár „Pridať riadok" je viditeľný aj bez položiek
	const pridatForm = page.getByTestId('pridat-riadok');
	await expect(pridatForm).toBeVisible();

	// pridaj ručný riadok: popis, typ skla z pickera (prvá reálna možnosť), 1000×1000, 2 ks, atyp
	await pridatForm.getByTestId('manual-popis').fill('ATYP podľa výkresu');
	const typSelect = pridatForm.getByTestId('manual-typ');
	await expect(typSelect.locator('option')).not.toHaveCount(0);
	// vyber prvú NEprázdnu možnosť typu skla
	const prvaMoznost = typSelect.locator('option:not([value=""])').first();
	await expect(prvaMoznost).toBeAttached();
	const typValue = await prvaMoznost.getAttribute('value');
	await typSelect.selectOption(typValue!);
	await pridatForm.getByTestId('manual-sirka').fill('1000');
	await pridatForm.getByTestId('manual-vyska').fill('1000');
	await pridatForm.getByTestId('manual-pocet').fill('2');
	await pridatForm.getByTestId('manual-rezim').selectOption('atyp');
	await pridatForm.getByTestId('manual-pridat').click();
	await waitHydrated(page);

	// riadok sa objaví v sekcii „Pridané položky"
	await expect(page.getByRole('heading', { name: 'Pridané položky' })).toBeVisible();
	const riadok = page.locator('tbody tr').first();
	await expect(riadok.locator('td').nth(0)).toContainText('ATYP podľa výkresu');
	await expect(riadok.locator('td').nth(1)).toContainText('1000');

	// Odoslať je bez OP zatiaľ zakázané
	await expect(page.getByTestId('odoslat-odoo')).toBeDisabled();

	// nastav OP objednávky (zákazka nemá odpis) → jedno OP pre celý podklad
	await page.getByTestId('op-input').fill('260545');
	await page.getByTestId('nastav-op').click();
	await waitHydrated(page);

	// Odoslať je teraz zapnuté (≥ 1 riadok + OP); v teste NIKDY neklikáme send
	await expect(page.getByTestId('odoslat-odoo')).toBeEnabled();

	expect(consoleMsgs).toEqual([]);
});
