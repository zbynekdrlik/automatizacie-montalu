// #514 (Odoo úloha 885, Marek 11.9.): na výsledkovej obrazovke zasklení sa
// „Odoslať sklo" (📋 Pridať sklá do objednávky → pridatSkla) a „uložiť nárezák"
// (✅ Odoslať odpis do Money → odoslat) museli dať urobiť v ĽUBOVOĽNOM poradí nad
// tým istým výsledkom. Predtým `pridatSkla` presmerovalo preč na /objednavka-skla/[zak]
// (odpis zmizol), a po odpise (`hotovo`) chýbalo tlačidlo na pridanie skiel.
//
// Zápisový tok (píše do objednavka_skla + testový Money priečinok, NIE do ostrého
// Money) — `skipAkLive` na ostrom nasadení preskočí. Zero-console-errors ako všade.
import { test, expect } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	skipAkLive,
	vyberFarbuKovania
} from './helpers';

const RUN = `E2E-PORADIE-${Date.now().toString(36).slice(-5)}`;

async function spocitat(page: import('@playwright/test').Page, zak: string) {
	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Poradie akcií');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2200');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);
	// náhľad: obe akcie prítomné nad tým istým výsledkom
	await expect(page.getByTestId('odoslat')).toBeVisible();
	await expect(page.getByTestId('pridat-skla')).toBeVisible();
}

test('poradie A: Odoslať sklo → potom uložiť nárezák (odpis) ostáva dostupný', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);
	await spocitat(page, `${RUN}-A`);

	// „Odoslať sklo" — NEpresmeruje preč, ostane výsledok s potvrdením
	await page.getByTestId('pridat-skla').click();
	await waitHydrated(page);
	await expect(page).toHaveURL(/\/zasklenia/);
	await expect(page.getByTestId('skla-pridane')).toBeVisible();
	// a „uložiť nárezák" (odpis) je stále dostupné nad tým istým výsledkom
	await expect(page.getByTestId('odoslat')).toBeVisible();

	await page.getByTestId('odoslat').click();
	await waitHydrated(page);
	await expect(page.getByTestId('vysledok')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

test('poradie B: uložiť nárezák (odpis) → potom Odoslať sklo ostáva dostupné', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);
	await spocitat(page, `${RUN}-B`);

	// „uložiť nárezák" (odpis) → obrazovka hotovo s potvrdením
	await page.getByTestId('odoslat').click();
	await waitHydrated(page);
	await expect(page.getByTestId('vysledok')).toBeVisible();

	// „Odoslať sklo" je dostupné aj po odpise (na obrazovke hotovo)
	await expect(page.getByTestId('pridat-skla')).toBeVisible();
	await page.getByTestId('pridat-skla').click();
	await waitHydrated(page);
	await expect(page.getByTestId('skla-pridane')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

test('opakované Odoslať sklo nad tým istým výsledkom neduplikuje', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await skipAkLive(page);
	const zak = `${RUN}-C`;
	await spocitat(page, zak);

	await page.getByTestId('pridat-skla').click();
	await waitHydrated(page);
	await expect(page.getByTestId('skla-pridane')).toBeVisible();
	// druhé kliknutie na ten istý plán
	await page.getByTestId('pridat-skla').click();
	await waitHydrated(page);
	await expect(page.getByTestId('skla-pridane')).toBeVisible();

	// otvoriť objednávku a overiť, že je práve JEDNA položka (nie dve)
	await page.getByTestId('skla-pridane-odkaz').click();
	await page.waitForURL(/\/objednavka-skla\//);
	await waitHydrated(page);
	await expect(page.locator('tbody tr')).toHaveCount(1);

	expect(consoleMsgs).toEqual([]);
});
