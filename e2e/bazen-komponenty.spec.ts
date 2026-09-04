// #355 — nové bazénové voľby (aretácia, uzamykateľná, RAL krytiek, výklopné čelo
// pant, vetracia klapka) postavia kusové komponenty (BPK*) v kontrolnom rozpise.
// Compute-only (Spočítať) — do Money sa nič neposiela. Nula console errors.
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, goto, waitHydrated } from './helpers';

const RUN = `KOMP-${Date.now().toString(36).toUpperCase()}`;

test('bazén: nové voľby → kusové komponenty (ks) v kontrolnom rozpise', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/bazen');

	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-BAZ`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Komponenty');
	await page.getByLabel('Model').selectOption('Exclusive');
	await page.getByLabel('Koľaj', { exact: true }).selectOption('Jednokolaj');
	await page.getByLabel('Počet sekcií *').fill('3');
	await page.getByLabel('Celková dĺžka koľajníc (mm)').fill('10000');
	await page.getByLabel('Dvere', { exact: true }).check();

	// nové voľby
	await page.getByLabel('Aretácia', { exact: true }).selectOption('automaticka');
	await page.getByLabel('Strana aretácie').selectOption('L');
	await page.getByLabel('Uzamykateľná páčka').check();
	await page.getByLabel('RAL krytiek').selectOption('R7016');
	// #450: „Výklopné čelo" checkbox je NEZÁVISLÝ zdroj pravdy pre pant ELOX/9005 —
	// label je substring "Výklopné čelo (počet)" labelu, takže exact: true je nutné.
	await page.getByLabel('Výklopné čelo', { exact: true }).check();
	await page.getByLabel('Pant výklopného čela').selectOption('9005');
	await page.getByLabel('Vetracia klapka').check();
	await page.getByLabel('Výklopné čelo (počet)').fill('1');
	// veľkosti sekcií (kvôli krytkám nožičiek)
	await page.getByLabel('VS do 4500 (počet sekcií)').fill('1');
	await page.getByLabel('SS do 4500 (počet sekcií)').fill('1');
	await page.getByLabel('MS do 4500 (počet sekcií)').fill('1');

	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);
	await expect(page.getByTestId('kontrola-tabulka')).toBeVisible();

	// prečítaj kontrolný rozpis (kód → hodnota v poli)
	const rozpis = await page.evaluate(() =>
		Object.fromEntries(
			[...document.querySelectorAll('input[name^="qty_"]')].map((i) => [
				i.getAttribute('name')!.slice(4),
				(i as HTMLInputElement).value
			])
		)
	);

	// podvozky: kladka D62 jednokoľaj 2/sekcia = 6
	expect(rozpis['BPK00074']).toBe('6');
	// EXCLUSIVE spojka M8 = sekcie×4 = 12
	expect(rozpis['BPK00108']).toBe('12');
	// automatická aretácia: telo = 1
	expect(rozpis['BPK00082']).toBe('1');
	// strana ĽAVÁ: západka L prítomná, západka P nie
	expect(rozpis['BPK20259']).toBe('3');
	expect(rozpis['BPK202510']).toBeUndefined();
	// uzamykateľná (automatická): obyčajná páčka nahradená (nie je v rozpise),
	// uzamykateľná páčka = sekcie-1 = 2
	expect(rozpis['BPK00084']).toBeUndefined();
	expect(rozpis['BPK202416']).toBe('2');
	// RAL R7016: R7016 krytka prítomná, R9006 variant nie
	expect(rozpis['BPK202522']).toBe('3');
	expect(rozpis['BPK20251']).toBeUndefined();
	// výklopné čelo pant 9005 = 3, ELOX nie
	expect(rozpis['BPK202517']).toBe('3');
	expect(rozpis['BPK202516']).toBeUndefined();
	// vetracia klapka trecí pant = 3
	expect(rozpis['BPK202518']).toBe('3');
	// dvere R7016 doraz = 4, madlo uzamykateľné = 1
	expect(rozpis['BPK202540']).toBe('4');
	expect(rozpis['BPK202515']).toBe('1');
	// krytka čelovej nožičky R7016 (V1+S1+M1 = 2+1+2 = 5)
	expect(rozpis['BPK202526']).toBe('5');

	// jednotka `ks` je viditeľná v tabuľke (kusový komponent)
	const kompRow = page.locator('tr', { hasText: 'BPK00074' });
	await expect(kompRow).toContainText('ks');

	// #454: náhľad ceny materiálu je na Kontrola obrazovke (pred odoslaním do Money)
	await expect(page.getByTestId('ceny-tabulka')).toBeVisible();
	await expect(page.getByTestId('ceny-tabulka')).toContainText('Ceny materiálu');

	expect(consoleMsgs).toEqual([]);
});
