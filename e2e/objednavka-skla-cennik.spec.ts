// #556: cenníkový názov skla z Odoo + mapovanie počítaných riadkov na `montalu.glass.type`.
// Proti PREVIEW cieľu (bez Odoo pripojenia) je zdroj typov LOKÁLNY fallback, takže:
//  - nárezák select na /zasklenia sa vyrenderuje bez pádu (enrichment popisu je gatovaný na
//    source==='odoo' → vo fallbacku bez „· cenník:", ale žiadny console error / crash),
//  - producent „Pridať sklá" NEpriradzuje Odoo hodnotu (source local) → riadok na podklade nesie
//    LOKÁLNY názov skla a je platnou voľbou v pickeri (žiadny nepriradené badge vo fallbacku).
// Matcher logika (jednoznacne/viac/ziadne, badge, popis) je pokrytá unit testami (glass-match +
// odoo-glass-types priradOdooTypy) — Odoo katalóg v E2E preview nie je dostupný. Zápisový tok
// (píše do objednavka_skla, nie Money) — skipAkLive na ostrom nasadení preskočí.
import { test, expect } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	skipAkLive,
	vyberFarbuKovania
} from './helpers';

const RUN = `E2E-CENNIK-${Date.now().toString(36).slice(-5)}`;

test('zasklenia nárezák select sa renderuje + „Pridať sklá" → podklad s lokálnym typom (fallback bez pádu)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);
	await goto(page, '/zasklenia');

	const zak = `${RUN}-01`;
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Cenník skla');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2200');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');

	// #556 (c): nárezák výber skla sa vyrenderuje s možnosťami (vo fallbacku bez „· cenník:",
	// ale bez pádu / console erroru). Select má aspoň jednu možnosť a je použiteľný.
	const skloSelect = page.locator('#sklo');
	await expect(skloSelect).toBeVisible();
	await expect(skloSelect.locator('option')).not.toHaveCount(0);
	const typTxt = (
		(await skloSelect.locator('option[selected], option').first().textContent()) ?? ''
	).trim();
	expect(typTxt.length).toBeGreaterThan(0);

	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	// #514: „Pridať sklá" ostane na výsledku + odkaz na podklad
	await page.getByTestId('pridat-skla').click();
	await waitHydrated(page);
	await expect(page.getByTestId('skla-pridane')).toBeVisible();
	await page.getByTestId('skla-pridane-odkaz').click();
	await page.waitForURL(/\/objednavka-skla\//);
	await waitHydrated(page);

	// #563: nadpis = OP podkladu (zákazka bez odpisu → bez zákazníka), podklad danej zákazky z URL
	await expect(page).toHaveURL(new RegExp(`/objednavka-skla/${zak}`));
	await expect(page.getByTestId('objednavka-nadpis')).toHaveText('Objednávka skla — 01');

	// riadok podkladu nesie LOKÁLNY typ skla (fallback: producent nepriradil Odoo hodnotu) a je
	// platnou voľbou v pickeri (select má hodnotu, ktorá je medzi možnosťami → žiadny nepriradené
	// badge vo fallbacku).
	const riadok = page.locator('tbody tr').first();
	await expect(riadok).toBeVisible();
	const typSelect = riadok.locator('select[name="typ_skla"]');
	await expect(typSelect).toBeVisible();
	await expect(typSelect.locator('option')).not.toHaveCount(0);
	// zdroj typov = lokálny fallback (bez Odoo pripojenia v preview)
	await expect(page.getByTestId('glass-types-source')).toContainText('lokálny zoznam');

	expect(consoleMsgs).toEqual([]);
});
