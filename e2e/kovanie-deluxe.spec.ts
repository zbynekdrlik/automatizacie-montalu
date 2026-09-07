// BS DELUXE komponenty do Money odpisu (#354, Dominik — att 14668/14670) v
// prehliadači. Money-korektnosť množstiev je pokrytá unit testom
// (tests/kovanie-deluxe.test.ts); toto overuje LEN prehliadačovú vrstvu — Deluxe
// má od #6413 (att 14955, Patrik/Dominik) PEVNÚ farbu kovania (nerezová mušľa
// R9006), takže formulár namiesto RAL selectu zobrazí info text; prepnutie
// z farebného systému (Robust) na Deluxe zahodí neplatnú farbu z predošlého
// systému (#354 spirit), a náhľad naozaj zobrazí krajnú/stredovú krytku + madlo
// + kefy + upozornenie na 6mm.
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

test('Deluxe: farba kovania je PEVNÁ (nerezová mušľa R9006), žiadny RAL select (#6413)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Deluxe');
	// #6413 att 14955: server vylúčil Deluxe zo `systemyFarba` (má defaultFarba) →
	// formulár namiesto RAL selectu zobrazí pevný info text.
	await expect(page.getByTestId('farba-kovania-fixed')).toBeVisible();
	await expect(page.getByTestId('farba-kovania-fixed')).toContainText('nerezová mušľa');
	await expect(page.getByTestId('farba-kovania-fixed')).toContainText('R9006');
	await expect(page.getByTestId('farba-kovania')).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});

test('prepnutie Robust (R9005) → Deluxe zobrazí pevnú farbu; návrat na Robust nezachová neplatnú R9005 (#354, #6413)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Robust');
	await vyberFarbuKovania(page, 'R9005');
	await expect(page.getByTestId('farba-kovania')).toHaveValue('R9005');

	// Deluxe nemá RAL select vôbec (#6413) — kovanie tam má pevnú farbu R9006
	// (nerezová mušľa). Hranový $effect naďalej zahadzuje hodnotu, ktorá nie je
	// v aktuálnych `ralOptions` (R9005 nie je platná pre Deluxe) — presne ten istý
	// mechanizmus ako pred #6413, len sa teraz prejaví zmiznutím selectu namiesto
	// prázdnej hodnoty v ňom.
	await page.getByLabel('Systém').selectOption('Deluxe');
	await expect(page.getByTestId('farba-kovania')).toHaveCount(0);
	await expect(page.getByTestId('farba-kovania-fixed')).toBeVisible();
	await expect(page.getByTestId('farba-kovania-fixed')).toContainText('R9006');

	// späť na Robust: select sa vráti, ale neplatná R9005 NEPRETRVÁ (bola zahodená
	// počas Deluxe interlude) — inak by engine mohol dostať zaseknutú neplatnú
	// hodnotu namiesto vynúteného nového výberu (#354 spirit).
	await page.getByLabel('Systém').selectOption('Robust');
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
