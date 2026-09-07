// BS DELUXE komponenty do Money odpisu (#354, Dominik — att 14668/14670) v
// prehliadači. Money-korektnosť množstiev je pokrytá unit testom
// (tests/kovanie-deluxe.test.ts); toto overuje LEN prehliadačovú vrstvu — Deluxe
// má RAL select (krytky = 2 farebné Money kódy R9006/R7016, #431 bod 1, Patrik
// msg 1801337), s PREDVOLENOU farbou R9006 a hintom „nerezová mušľa" (kovanie
// je nerez, krytky podľa zvolenej farby). Prepnutie z farebného systému (Robust)
// na Deluxe zahodí neplatnú farbu z predošlého systému (#354 spirit) a predvyplní
// R9006, a náhľad naozaj zobrazí krajnú/stredovú krytku + madlo + kefy.
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

test('Deluxe: RAL select viditeľný s R9006/R7016, predvolená R9006, hint nerezová mušľa (#431)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Deluxe');
	// #431 bod 1: RAL select je VIDITEĽNÝ pre Deluxe (krytky majú 2 farebné varianty)
	const sel = page.getByTestId('farba-kovania');
	await expect(sel).toBeVisible();
	// predvolená farba R9006 (nerezová mušľa — Patrik msg 1801337)
	await expect(sel).toHaveValue('R9006');
	// ponúka len R9006/R7016 (nie R9005)
	const hodnoty = await sel
		.locator('option')
		.evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v));
	expect(hodnoty.sort()).toEqual(['R7016', 'R9006'].sort());
	// hint „nerezová mušľa" vedľa selectu
	await expect(page.getByTestId('kovanie-musla-hint')).toBeVisible();
	await expect(page.getByTestId('kovanie-musla-hint')).toContainText('nerezová mušľa');
	// fixný div z 0f3dd88 NEEXISTUJE
	await expect(page.getByTestId('farba-kovania-fixed')).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});

test('prepnutie Robust (R9005) → Deluxe predvyplní R9006; návrat na Robust vymaže neplatnú (#354, #431)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Robust');
	await vyberFarbuKovania(page, 'R9005');
	await expect(page.getByTestId('farba-kovania')).toHaveValue('R9005');

	// Deluxe: R9005 nie je platná → zahodí sa, predvyplní sa R9006
	await page.getByLabel('Systém').selectOption('Deluxe');
	await expect(page.getByTestId('farba-kovania')).toHaveValue('R9006');
	// hint viditeľný
	await expect(page.getByTestId('kovanie-musla-hint')).toBeVisible();

	// späť na Robust: select sa vráti, R9006 ostáva platná pre Robust? Nie —
	// Robust má R9005/R7016, ale R9006 nie je v Robust množine, takže sa zahodí
	// a predvolená (žiadna pre Robust) sa nenastaví → prázdna hodnota.
	await page.getByLabel('Systém').selectOption('Robust');
	await expect(page.getByTestId('farba-kovania')).toHaveValue('');
	// hint zmizne (Robust nemá predvolenú farbu)
	await expect(page.getByTestId('kovanie-musla-hint')).toHaveCount(0);

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
	// chýbajúce 6mm (#354 review nález: predtým sa zobrazovalo aj tu, hoci sa
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
