// #453 (Patrik, Odoo ch207 msg 1792131): koliesko myši nad zaostreným
// <input type="number"> nebezpečne mení hodnotu namiesto scrollovania stránky.
// Reálny prehliadač test na /optimalizator (nárezový optimalizátor — presne
// "nárezové plány" z hlásenia) cez `page.mouse.wheel()`: hodnota poľa sa
// NEZMENÍ a stránka sa PRI TOM normálne skroluje (akceptačné kritérium #453).
// Modul je čisto čítací (žiadny Money zápis) — netreba skipAkLive.
import { test, expect } from '@playwright/test';
import { goto, loginAs, collectConsole } from './helpers';

test('wheel guard: skrol nad "Dĺžka tyče" nemení hodnotu, stránka sa skroluje normálne', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	// úzky viewport → formulár + kusy tabuľka presiahnu výšku, stránka je skrolovateľná
	await page.setViewportSize({ width: 900, height: 500 });
	await loginAs(page);
	await goto(page, '/optimalizator');

	// zopár riadkov kusov navyše, aby bolo pod poľom dosť obsahu na skrolovanie
	for (let i = 0; i < 4; i++) {
		await page.getByRole('button', { name: 'Pridať kus' }).click();
	}

	const dlzkaTyce = page.getByLabel('Dĺžka tyče (mm)');
	await expect(dlzkaTyce).toHaveValue('6000'); // default $state pred akoukoľvek zmenou

	await dlzkaTyce.click(); // zaostrí pole (presne situácia z hlásenia)
	await expect(dlzkaTyce).toBeFocused();

	const scrollPred = await page.evaluate(() => window.scrollY);
	await page.mouse.wheel(0, 400); // koliesko myši nad zaostreným number inputom

	// hodnota NESMIE sa zmeniť — pred fixom by tu prehliadač natívne pripočítal step
	await expect(dlzkaTyce).toHaveValue('6000');
	// input stratil focus (blur guard zasiahol) — presne mechanizmus z design komentára
	await expect(dlzkaTyce).not.toBeFocused();
	// stránka sa PRI TOM normálne skrolovala (akceptačné kritérium — žiadny preventDefault)
	const scrollPo = await page.evaluate(() => window.scrollY);
	expect(scrollPo).toBeGreaterThan(scrollPred);

	expect(consoleMsgs).toEqual([]);
});
