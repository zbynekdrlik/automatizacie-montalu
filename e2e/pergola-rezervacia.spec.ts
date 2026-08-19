// Pergola — REZERVAČNÝ ODPIS z rozmerov (#221) cez REÁLNY tok v prehliadači:
// premenovaná stránka „Rezervačný odpis" → rozmery → materiál → ZAK/OP/zákazník →
// Money rozpis (nahlad) → explicitné potvrdenie → zápis. ZÁPIS je za `skipAkLive`,
// takže do ostrého Money nikdy nič nejde (test píše do testovacieho priečinka).
// Overuje: rename, honest-null vylúčenie (priečka NIE je v odpise), REZ marker v
// názve súboru, zero console errors.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, waitHydrated, skipAkLive } from './helpers';

const RUN = `RZ-${Date.now().toString(36).toUpperCase()}`;

test('premenovaný tok „Rezervačný odpis" → potvrdenie → zápis do TEST priečinka, REZ marker', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	// rename: nadpis formulára + title
	await expect(page.getByRole('heading', { name: 'Rezervačný odpis — pergola' })).toBeVisible();

	// rozmery (štandardná pergola z callu): Robust, na stenu, 4 nohy
	await page.locator('#system').selectOption('Robust');
	await page.locator('#sirka').fill('5000');
	await page.locator('#hlbka').fill('3500');
	await page.locator('#pocetPrednychNoh').fill('4');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// materiál sa zobrazil (potvrdený vektor: predná noha 18013, 2215)
	await expect(page.getByTestId('narez-nadpis')).toContainText('Robust');
	await expect(page.getByTestId('polozka-18013')).toContainText('2215');

	// rezervačná karta: ZAK/OP/zákazník
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-Z`);
	await page.getByLabel('OP/OPDL číslo *').fill('OP260999');
	await page.getByLabel('Zákazník *').fill('E2E Rezervacia');
	await page.getByTestId('pripravit-rezervaciu').click();
	await waitHydrated(page);

	// nahlad: Money rozpis (PRP metre) — potvrdené profily prítomné
	await expect(page.getByTestId('rez-nadpis')).toContainText(`${RUN}-Z`);
	const rozpis = page.getByTestId('rez-rozpis');
	await expect(rozpis).toContainText('PRP20242'); // Profil 110x110 V2 (predná noha)
	await expect(rozpis).toContainText('PRP202410'); // Profil 110x43 (bočný)

	// honest-null: priečka (18004 → PRP00044) NIE JE v odpise, ale je „zatiaľ nepočítané"
	await expect(rozpis).not.toContainText('PRP00044');
	const vylucene = page.getByTestId('rez-vylucene');
	await expect(vylucene).toContainText('18004');
	await expect(vylucene).toContainText('Priečkový');

	// explicitné potvrdenie → zápis do TEST priečinka
	await page.getByTestId('odoslat-rezervaciu').click();
	await waitHydrated(page);

	const vysledok = page.getByTestId('rez-vysledok');
	await expect(vysledok).toContainText('TEST');
	// názov súboru: „ZAK - zákazník REZ [hash].xlsx" — REZ marker + bez OPOP
	await expect(vysledok).toContainText(
		new RegExp(`${RUN}-Z - E2E Rezervacia REZ \\[[0-9a-f]{8}\\]\\.xlsx`)
	);
	await expect(vysledok).not.toContainText('OPOP');

	expect(consoleMsgs).toEqual([]);
});

test('rezervácia bez ZAK/OP/zákazník = chyba, do Money sa nič nezapíše', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	await page.locator('#sirka').fill('5000');
	await page.locator('#hlbka').fill('3500');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// prázdne ZAK/OP/zákazník — HTML required to zachytí; vyplníme len ZAK, aby prešiel
	// required a server validoval OP (ide do dokladu)
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-E`);
	await page.getByLabel('OP/OPDL číslo *').fill('OPX');
	await page.getByLabel('Zákazník *').fill('E2E Err');
	// vyprázdni OP silou cez evaluate (obíde required) a odošli — server musí odmietnuť
	await page.getByLabel('OP/OPDL číslo *').fill('');
	await page.locator('#op').evaluate((el: HTMLInputElement) => el.removeAttribute('required'));
	await page.getByTestId('pripravit-rezervaciu').click();
	await waitHydrated(page);

	await expect(page.getByTestId('rez-error')).toContainText(/OP/);
	expect(consoleMsgs).toEqual([]);
});
