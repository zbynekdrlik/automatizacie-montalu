// „Pergola s FIXom" (#378) — checkbox na „Pergola z appky" rozbalí FIX sekciu,
// rozmery sa odvodia z pergoly (auto) s možnosťou override, FIX sa spočíta a
// nakreslí. Všetko ČÍTACIE (FIX je DISPLAY-ONLY, do Money nič nejde) → beží aj proti
// nasadenej appke. Zero console errors (chytí aj $effect self-loop auto-odvodenia).
import { test, expect } from '@playwright/test';
import { goto, loginAs, collectConsole, waitHydrated } from './helpers';

test('FIX checkbox → sekcia, auto-odvodenie rozmerov z pergoly, výpočet + honest-null Money', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	// pergola rozmery — z nich sa odvodí bočný FIX
	await page.locator('#sirka').fill('5000');
	await page.locator('#hlbka').fill('3500');
	await page.locator('#prednaSvetlost').fill('2200');
	await page.locator('#vyskaZadna').fill('2900');

	// FIX sekcia je pred zaškrtnutím skrytá
	await expect(page.getByTestId('fix-sekcia')).toHaveCount(0);

	// zaškrtni „Pergola s FIXom" → sekcia sa rozbalí + honest-null Money poznámka
	await page.locator('#pergolaSFixom').check();
	await expect(page.getByTestId('fix-sekcia')).toBeVisible();
	await expect(page.getByTestId('fix-money-note')).toContainText('Do Money odpisu zatiaľ nejde');

	// auto-odvodenie: šírka = hĺbka, výška vpredu = predná svetlosť, výška vzadu = zadná
	await expect(page.locator('#fixSirka')).toHaveValue('3500');
	await expect(page.locator('#fixV1')).toHaveValue('2200');
	await expect(page.locator('#fixV2')).toHaveValue('2900');
	// v auto režime sú polia iba na čítanie (odvodené)
	await expect(page.locator('#fixSirka')).toHaveAttribute('readonly', '');

	// Spočítať → výsledok má FIX kartu (výkres + plocha) A stále aj pergolový materiál
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// pergolový odpis je NEDOTKNUTÝ (FIX je navyše, mimo Money)
	await expect(page.getByTestId('narez-nadpis')).toBeVisible();

	// FIX karta: honest-null badge + spočítaná plocha (šikmý fix 3500/2200/2900 = 8,925 m²)
	const fixKarta = page.getByTestId('fix-karta');
	await expect(fixKarta).toBeVisible();
	await expect(page.getByTestId('fix-money-badge')).toContainText('mimo Money odpisu');
	await expect(page.getByTestId('fix-tabulka')).toBeVisible();
	await expect(page.getByTestId('fix-plocha')).toContainText('8,925');

	expect(consoleMsgs).toEqual([]);
});

test('FIX override — odškrtnutie auto sprístupní rozmery na ručnú úpravu', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#hlbka').fill('3000');
	await page.locator('#pergolaSFixom').check();
	await expect(page.locator('#fixSirka')).toHaveValue('3000');
	// v auto sú readonly; po odškrtnutí auto sa dajú editovať
	await expect(page.locator('#fixSirka')).toHaveAttribute('readonly', '');

	// odškrtni „Rozmery odvodiť automaticky" → rozmery sa dajú editovať
	await page.getByTestId('fix-auto').uncheck();
	await expect(page.locator('#fixSirka')).not.toHaveAttribute('readonly', '');
	// ručne prepíš šírku FIXu (override) a over, že sa v aute už neprepíše späť
	await page.locator('#fixSirka').fill('4200');
	await expect(page.locator('#fixSirka')).toHaveValue('4200');

	expect(consoleMsgs).toEqual([]);
});

// ROUND-TRIP (pergola-narez.md „ROUND-TRIP PASCA"): override FIX hodnoty MUSIA prežiť
// „Spočítať" → „← Späť a upraviť". 10 carried-through polí, hidden inputy na 2 miestach,
// server echuje `fix` v každej akcii — toto je jediný test, ktorý celý reťazec zamkne.
test('FIX round-trip — override hodnoty prežijú Spočítať → Späť a upraviť', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#hlbka').fill('3000');
	await page.locator('#pergolaSFixom').check();
	// override: vlastné rozmery + počet polí + zrkadlo + texty
	await page.getByTestId('fix-auto').uncheck();
	await page.locator('#fixSirka').fill('4200');
	await page.locator('#fixV1').fill('1800');
	await page.locator('#fixV2').fill('2600');
	await page.locator('#fixPocetPoli').selectOption('3');
	await page.locator('#fixZrkadlo').check();
	await page.locator('#fixSklo').fill('4-16-4 IZO');
	await page.locator('#fixPoznamka').fill('ľavý bok');

	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	// výsledok ukazuje FIX kartu s override rozmermi (šikmý 4200/1800/2600, 3 polia)
	await expect(page.getByTestId('fix-karta')).toBeVisible();

	// „← Späť a upraviť" → všetkých 10 polí obnovených (round-trip cez server echo)
	await page.getByTestId('upravit').click();
	await waitHydrated(page);
	await expect(page.locator('#pergolaSFixom')).toBeChecked();
	await expect(page.getByTestId('fix-auto')).not.toBeChecked();
	await expect(page.locator('#fixSirka')).toHaveValue('4200');
	await expect(page.locator('#fixV1')).toHaveValue('1800');
	await expect(page.locator('#fixV2')).toHaveValue('2600');
	await expect(page.locator('#fixPocetPoli')).toHaveValue('3');
	await expect(page.locator('#fixZrkadlo')).toBeChecked();
	await expect(page.locator('#fixSklo')).toHaveValue('4-16-4 IZO');
	await expect(page.locator('#fixPoznamka')).toHaveValue('ľavý bok');

	expect(consoleMsgs).toEqual([]);
});
