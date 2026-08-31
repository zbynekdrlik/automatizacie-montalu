// BS DELUXE komponenty do Money odpisu (#354, Dominik — att 14668/14670) v
// prehliadači. Money-korektnosť množstiev je pokrytá unit testom
// (tests/kovanie-deluxe.test.ts); toto overuje LEN prehliadačovú vrstvu — RAL
// select ponúka len platnú množinu (nie natvrdo R9005/R7016 pre KAŽDÝ farebný
// systém), neplatná farba sa pri prepnutí systému zahodí, a náhľad naozaj
// zobrazí krajnú/stredovú krytku + madlo + kefy + upozornenie na 6mm.
//
// Všetko READ-ONLY („Spočítať" / „Späť"), nič sa nezapisuje do Money.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated, vyberFarbuKovania } from './helpers';

const RUN = `E2E-DLX-${Date.now().toString(36).slice(-5)}`;

async function zaklad(page: Page, op: string) {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-${op}`);
	await page.getByLabel('OP/OPDL číslo *').fill(op);
	await page.getByLabel('Zákazník *').fill('E2E Deluxe Kovanie');
	await page.getByLabel('Systém').selectOption('Deluxe');
	await page.getByLabel('Štýl').selectOption('3K');
	await page.getByLabel('Šírka (mm) *').fill('4200');
	await page.getByLabel('Výška (mm) *').fill('2250');
}

const riadok = (page: Page, kod: string) =>
	page.getByTestId('kovanie-karta').locator('.row', { hasText: kod });
// Množstvo (posledný <b>) IZOLOVANE — `nazov` niektorých Deluxe komponentov končí
// číslicou (RAL kód „R9006", „Madlo D56"), takže `<span>…</span><b>N ks</b>` sa v
// textContente spojí BEZ medzery („…R90062 ks") a `toContainText(/(^|\D)2 ks/)` by
// na také riadky nikdy nesadlo (na profiloch to nevadí — ich `nazov` končí na „mm",
// text, nie číslica). Exaktný text na IZOLOVANOM `<b>` elementu je jednoznačný.
const mnozstvo = (page: Page, kod: string) => riadok(page, kod).locator('b');

test('Deluxe: RAL select ponúka len R9006/R7016 (10mm live tabuľka), nie R9005', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Deluxe');
	const sel = page.getByTestId('farba-kovania');
	await expect(sel).toBeVisible();
	const hodnoty = await sel
		.locator('option')
		.evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
	expect(hodnoty.sort()).toEqual(['', 'R7016', 'R9006'].sort());

	expect(consoleMsgs).toEqual([]);
});

test('prepnutie Robust (R9005) → Deluxe zahodí neplatnú farbu (#354)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Robust');
	await vyberFarbuKovania(page, 'R9005');
	await expect(page.getByTestId('farba-kovania')).toHaveValue('R9005');

	// Deluxe neponúka R9005 — hranový $effect musí neplatnú hodnotu zahodiť,
	// inak by sa v selecte zobrazila prázdna, ale `farbaKovaniaS` by mohla ostať
	// zaseknutá na neplatnej hodnote (do #354 všetky farebné systémy zdieľali
	// JEDNU množinu, takže tento prípad dovtedy nemohol nastať).
	await page.getByLabel('Systém').selectOption('Deluxe');
	await expect(page.getByTestId('farba-kovania')).toHaveValue('');

	expect(consoleMsgs).toEqual([]);
});

test('Deluxe 3K 10mm: krajná×2, stredová L×2 + P×2, madlo×2, kefy + upozornenie na 6mm', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, '01');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Float kalené 10 mm');
	await vyberFarbuKovania(page, 'R9006');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	// 3K = 3 krídla → 2 stykov (N-1) → stredová L aj P 2×; krajná vždy 2×
	await expect(mnozstvo(page, 'ZASK202529')).toHaveText('2 ks'); // krajná R9006
	await expect(mnozstvo(page, 'ZASK202525')).toHaveText('2 ks'); // stredová L R9006
	await expect(mnozstvo(page, 'ZASK202527')).toHaveText('2 ks'); // stredová P R9006
	// R7016 variant vôbec (absent, nie 0) — zvolili sme R9006
	await expect(riadok(page, 'ZASK202526')).toHaveCount(0);
	await expect(riadok(page, 'ZASK202528')).toHaveCount(0);
	await expect(riadok(page, 'ZASK202530')).toHaveCount(0);
	// madlo D56 vždy 2 ks
	await expect(mnozstvo(page, 'ZASK00049')).toHaveText('2 ks');
	// tesniace kefy sú v metroch, kladný počet
	await expect(mnozstvo(page, 'ZASK00007')).toContainText(/\d+(,\d+)? m/);
	await expect(mnozstvo(page, 'ZASK202542')).toContainText(/\d+(,\d+)? m/);
	// 10mm objednávka je KOMPLETNÁ (krytky+madlo+kefy) — žiadne upozornenie na
	// chýbajúce 6mm (#354 review nález 🟡: predtým sa zobrazovalo aj tu, hoci sa
	// 10mm objednávky vôbec netýka).
	await expect(page.getByTestId('plan-warn')).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});

test('Deluxe 3K 6mm: madlo + kefy sú v odpise, ŽIADNA krytka (0 ks skladu), farba nie je potrebná, upozornenie viditeľné', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, '02');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Float kalené 6 mm');
	// RAL select je pri Deluxe VŽDY vidno (systémová voľba), ale 6mm krytky ju
	// nepotrebujú — vyberFarbuKovania zvolí platnú hodnotu, engine ju len ignoruje.
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	await expect(mnozstvo(page, 'ZASK00049')).toHaveText('2 ks'); // madlo
	await expect(mnozstvo(page, 'ZASK00007')).toContainText(/\d+(,\d+)? m/); // kefa kladkový
	await expect(mnozstvo(page, 'ZASK202542')).toContainText(/\d+(,\d+)? m/); // kefa klzný
	for (const k of [
		'ZASK202525',
		'ZASK202526',
		'ZASK202527',
		'ZASK202528',
		'ZASK202529',
		'ZASK202530'
	])
		await expect(riadok(page, k)).toHaveCount(0);
	// 6mm objednávke naozaj CHÝBAJÚ krytky — tu sa upozornenie MÁ zobraziť
	await expect(page.getByTestId('plan-warn')).toContainText('6');
	await expect(page.getByTestId('plan-warn')).toContainText('krytk');

	expect(consoleMsgs).toEqual([]);
});
