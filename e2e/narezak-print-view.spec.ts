// #529: grafický nárezák PDF (server-side, na kiosk) zrkadlí tlačovú stránku `RozpisRezov` — tyče
// kreslené proporčne s rezmi + súčty za profil. Tento E2E stráží, že VÝSTUP, z ktorého PDF vzniká
// (RozpisRezov na /plan-rezov výsledku), sa naozaj vykreslí graficky (bar SVG + rezy tabuľka + súčet
// tyčí za profil), zero-console. Samotné server→Odoo PDF/lines volanie je fire-and-forget (nezachytí
// sa cez browser) → jeho kontrakt kryjú unit testy (narezak-pdf / odoo-plan-rezov-upload). Compute-
// only (žiadny Money zápis), preto bez skipAkLive.
import { test, expect } from '@playwright/test';
import { collectConsole, goto, loginAs } from './helpers';

test('plán rezov výsledok kreslí tyče graficky (RozpisRezov = zdroj PDF) + súčty za profil', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/plan-rezov');

	// 2 profily, viac kusov → viac tyčí + odpad (to isté, čo ide do PDF na kiosk)
	const cadText = [
		'18013 PROFIL 110x110 V2\t5\t2000',
		'18013 PROFIL 110x110 V2\t3\t1450',
		'AL_50x30x2\t6\t1865'
	].join('\n');
	await page.getByTestId('cad-input').fill(cadText);
	await page.getByTestId('dlzka-tyce').selectOption('7500');
	await page.getByTestId('spocitaj').click();

	await expect(page.getByTestId('vysledok')).toBeVisible();
	await expect(page.getByTestId('pocet-profilov')).toHaveText('2');

	// grafický rozpis rezov (RozpisRezov) — kontajner + aspoň jedna nakreslená tyč (bar SVG)
	const rozpis = page.locator('.rozpis');
	await expect(rozpis).toBeVisible();
	await expect(page.locator('.bar-svg').first()).toBeVisible();
	expect(await page.locator('.bar-svg').count()).toBeGreaterThan(0);

	// per-profil hlavička nesie „Počet tyčí" (súčet za profil) — to isté číslo je v PDF metadátach
	await expect(page.locator('.stat').first()).toContainText('Počet tyčí');

	// tabuľka rezov (Dĺžka / Kusov / Rez) — rovnaké rezy, aké PDF vykreslí ako segmenty
	await expect(page.locator('table.rezy').first()).toBeVisible();
	await expect(page.locator('table.rezy').first()).toContainText('Dĺžka');

	expect(consoleMsgs).toEqual([]);
});
