// E2E: názov odpisového súboru cez REÁLNY tok (formulár → náhľad → odoslanie).
// Šéf 2026-07-29 poslal foto Money import priečinka: súbory sa volali
// „ZAK2025428 - OPOP250359 - PERGOLA X PERGOLA [hash].xlsx" — appka lepila „OP"
// pred hodnotu z kolónky „OP/OPDL číslo", kam ľudia OP píšu. Názov má byť
// len „ZAK - zákazník [hash].xlsx". Zápisové kroky sú za `skipAkLive`, takže
// do Money nikdy nič nejde.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, skipAkLive } from './helpers';

const RUN = `NS-${Date.now().toString(36).toUpperCase()}`;

test('zasklenia: názov súboru je „ZAK - zákazník", aj keď do kolónky napíšeš OP', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-Z`);
	// presne to, čo robí obsluha: do kolónky napíše aj prefix OP
	await page.getByLabel('OP/OPDL číslo *').fill('OP250359');
	await page.getByLabel('Zákazník *').fill('E2E Nazov');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await expect(page.getByTestId('sklo-sirka')).toBeVisible();
	await page.getByTestId('odoslat').click();

	const vysledok = page.getByTestId('vysledok');
	await expect(vysledok).toContainText('TEST');
	await expect(vysledok).toContainText(new RegExp(`${RUN}-Z - E2E Nazov \\[[0-9a-f]{8}\\]\\.xlsx`));
	await expect(vysledok).not.toContainText('OPOP');
	await expect(vysledok).not.toContainText('ZASKLENIA');

	expect(consoleMsgs).toEqual([]);
});

test('pergola: názov súboru je „ZAK - zákazník" (bez OP a bez slova PERGOLA)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/pergola');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-P`);
	await page.getByLabel('OP/OPDL číslo *').fill('OP260286');
	await page.getByLabel('Zákazník *').fill('E2E Pergola');
	await page
		.getByLabel('Materiál (CAD nárez) *')
		.fill('18019 KOTVIACI PROFIL HORNY V2\t1\t6400\n18019 KOTVIACI PROFIL HORNY V2\t1\t1030');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await page.getByTestId('odoslat').click();

	const vysledok = page.getByTestId('vysledok');
	await expect(vysledok).toContainText(new RegExp(`${RUN}-P - E2E Pergola \\[[0-9a-f]{8}\\]\\.xlsx`));
	await expect(vysledok).not.toContainText('OPOP');
	await expect(vysledok).not.toContainText('PERGOLA [');

	expect(consoleMsgs).toEqual([]);
});
