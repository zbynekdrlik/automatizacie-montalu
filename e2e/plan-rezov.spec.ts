// E2E: Plán rezov (#482) — univerzálny optimalizátor rezov z CAD tabuľky.
// Nová stránka /plan-rezov: paste CAD tabuľku → zoskupenie profilov → FFD
// optimalizácia → výsledok. Money-NEUTRÁLNE.
import { test, expect } from '@playwright/test';
import { collectConsole, goto, loginAs } from './helpers';

test('stránka /plan-rezov sa načíta a zobrazí nadpis', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/plan-rezov');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plán rezov');
	await expect(page.getByTestId('cad-input')).toBeVisible();
	await expect(page.getByTestId('spocitaj')).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});

test('optimalizácia z CAD tabuľky zobrazí výsledok s profilmi', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/plan-rezov');

	// vloží vzorové dáta — 2 profily (jednoduchý test)
	const cadText = [
		'18013 PROFIL 110x110 V2\t2\t1700',
		'18013 PROFIL 110x110 V2\t2\t1600',
		'AL_50x30x2\t4\t1865'
	].join('\n');

	await page.getByTestId('cad-input').fill(cadText);
	await page.getByTestId('spocitaj').click();

	// čakaj na výsledok
	await expect(page.getByTestId('vysledok')).toBeVisible();
	await expect(page.getByTestId('pocet-profilov')).toHaveText('2');
	await expect(page.getByTestId('tyce-spolu')).toContainText(/\d+/);

	expect(consoleMsgs).toEqual([]);
});

test('prázdny vstup zobrazí chybu', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/plan-rezov');

	await page.getByTestId('spocitaj').click();

	await expect(page.getByTestId('chyba')).toBeVisible();
	await expect(page.getByTestId('chyba')).toContainText('Vlož CAD tabuľku');

	expect(consoleMsgs).toEqual([]);
});

test('zmena dĺžky tyče na 7500 funguje', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/plan-rezov');

	await page.getByTestId('dlzka-tyce').selectOption('7500');
	await page.getByTestId('cad-input').fill('PROFIL A\t3\t2000');
	await page.getByTestId('spocitaj').click();

	await expect(page.getByTestId('vysledok')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});
