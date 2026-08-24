// E2E (#300): override cesty pre zablokovaný odpis — „⚠️ Povoliť rovnaký" na /odpisy
// (reachability, keď odpis_log riadok ešte existuje) A modulové „⚠️ Odoslať aj tak" po
// „Uvoľniť" (koniec dead-endu — ledger blok bez odpis_log riadku, tuple override). Celý UI
// tok v TEST režime (skipAkLive — nikdy proti LIVE Money). Nula console errors.
//
// Pozn.: ledger-duplicate blok je vyvolateľný aj v TEST režime (ledger sleduje aj live=0).
// `unknown-kod` blok je LIVE-only (validácia sa v TEST nespúšťa — Money safety), preto jeho
// „Odoslať aj tak" kryjú unit testy (writeOdpis overrideKody) + zdieľaný OdpisBlok komponent.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, skipAkLive } from './helpers';

const RUN = `E2E-${Date.now().toString(36).toUpperCase()}`;

async function posli(page: import('@playwright/test').Page, zak: string) {
	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Override');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await page.getByTestId('odoslat').click();
}

test('/odpisy „Povoliť rovnaký" povolí re-import IDENTICKÉHO obsahu (odpis_log riadok existuje)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	page.on('dialog', (d) => d.accept());
	await loginAs(page);
	const zak = `${RUN}-POV`;

	// 1. odoslať
	await posli(page, zak);
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// 2. história → „⚠️ Povoliť rovnaký" (append override + zmaže dedup riadok)
	await goto(page, '/odpisy');
	const row = page.locator('tr', { hasText: zak }).first();
	await row.getByRole('button', { name: '⚠️ Povoliť rovnaký' }).click();
	await expect(page.getByTestId('reimport-povoleny')).toBeVisible();

	// 3. re-send IDENTICKÉHO obsahu teraz prejde (override počítadlo)
	await posli(page, zak);
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	expect(consoleMsgs).toEqual([]);
});

test('modul „Odoslať aj tak" prekoná ledger blok po „Uvoľniť" (koniec dead-endu)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	page.on('dialog', (d) => d.accept()); // confirm() pri Uvoľniť aj pri „Odoslať aj tak"
	await loginAs(page);
	const zak = `${RUN}-DEAD`;

	// 1. odoslať
	await posli(page, zak);
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// 2. „Uvoľniť" (NIE „Povoliť rovnaký") — zmaže odpis_log riadok, ledger ostáva
	await goto(page, '/odpisy');
	const row = page.locator('tr', { hasText: zak }).first();
	await row.getByRole('button', { name: 'Uvoľniť' }).click();
	await expect(page.getByTestId('uvolnene')).toBeVisible();

	// 3. IDENTICKÝ re-send je teraz ledger-blokovaný — a v histórii UŽ NIE JE riadok na
	//    „Povoliť rovnaký" (dead-end); zobrazí sa modulový blok banner + „Odoslať aj tak"
	await posli(page, zak);
	await expect(page.getByTestId('blok')).toContainText('už bol raz importovaný');
	await expect(page.getByTestId('odoslat-aj-tak')).toBeVisible();

	// 4. „⚠️ Odoslať aj tak" (confirm) → tuple override → odpis prejde
	await page.getByTestId('odoslat-aj-tak').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	expect(consoleMsgs).toEqual([]);
});
