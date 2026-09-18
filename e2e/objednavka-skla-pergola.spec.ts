// #546: pergola honest-null strešné sklo → ručný riadok objednávky skla. Keď producent strešného
// skla nepozná rozmery (default kotva stena → honest-null dĺžka), na výsledku sa zobrazí formulár
// „Sklo do objednávky" (typ z pickera, šírka × výška, počet). Odoslanie vytvorí riadok objednávky
// skla (modul='pergola', popis „Strešné sklo — <typ>") a presmeruje na podklad. Zápisový tok (píše
// do objednavka_skla, NIE Money) → skipAkLive na ostrom nasadení preskočí. Zero-console.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, waitHydrated, skipAkLive } from './helpers';

const RUN = `E2E-PSKLO-${Date.now().toString(36).slice(-5)}`;

test('pergola honest-null strešné sklo → ručný riadok objednávky (modul Pergola)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);
	await goto(page, '/pergola/narez');

	// default kotva = stena → strešné sklo je honest-null (dĺžka sa nepočíta)
	await page.locator('#sirka').fill('5000');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// formulár „Sklo do objednávky" (honest-null vetva) je viditeľný; automatické tlačidlo skryté
	const card = page.getByTestId('sklo-rucne-card');
	await expect(card).toBeVisible();
	await expect(page.getByTestId('pridat-skla')).toHaveCount(0);

	// ZAK + OP objednávky (rezervačná karta = zdroj identu pre riadok skla; #546 review 🟡: OP
	// zadané tu sa prenesie na riadok, netreba ho zadávať znova na podklade)
	const zak = `${RUN}-01`;
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('OP260546');

	// typ skla z pickera (prvá reálna možnosť), rozmer, počet
	const typSelect = card.getByTestId('sklo-rucne-typ');
	await expect(typSelect.locator('option')).not.toHaveCount(0);
	const prva = typSelect.locator('option:not([value=""])').first();
	await expect(prva).toBeAttached();
	const typVal = (await prva.getAttribute('value')) ?? '';
	await typSelect.selectOption(typVal);
	await card.getByTestId('sklo-rucne-sirka').fill('1200');
	await card.getByTestId('sklo-rucne-vyska').fill('900');
	await card.getByTestId('sklo-rucne-pocet').fill('2');
	await card.getByTestId('sklo-rucne-pridat').click();

	// presmerovanie na podklad objednávky KONKRÉTNEJ zákazky
	await page.waitForURL(/\/objednavka-skla\//);
	await waitHydrated(page);
	await expect(page.getByRole('heading', { name: `Objednávka skla — ${zak}` })).toBeVisible();

	// riadok pod sekciou „Pergola" s popisom „Strešné sklo — <typ>"
	await expect(page.getByRole('heading', { name: 'Pergola' })).toBeVisible();
	const riadok = page.locator('tbody tr').first();
	await expect(riadok.locator('td').nth(0)).toContainText('Strešné sklo');
	await expect(riadok.locator('td').nth(1)).toContainText('1200');
	await expect(riadok.locator('td').nth(1)).toContainText('900');
	await expect(riadok.locator('td').nth(3)).toContainText('2');

	// OP z pergola formulára sa prenieslo na riadok (netreba ho zadávať znova)
	await expect(page.getByTestId('op-hodnota')).toContainText('OP260546');

	expect(consoleMsgs).toEqual([]);
});
