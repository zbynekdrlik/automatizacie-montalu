// BS DELUXE komponenty do Money odpisu (#354, Dominik — att 14668/14670) v
// prehliadači. Money-korektnosť množstiev je pokrytá unit testom
// (tests/kovanie-deluxe.test.ts); toto overuje LEN prehliadačovú vrstvu — Deluxe
// má RAL select „Farba krytiek" (kovanie = pevne nerezová mušľa; #431 kolo 2, Dominik
// úloha 574). Možnosti krytiek sú HRÚBKO-ZÁVISLÉ: 6 mm → R9006/R9005, 10 mm →
// R9006/R7016; predvolená R9006 (platná na oboch hrúbkach). Prepnutie z farebného
// systému (Robust) na Deluxe zahodí neplatnú farbu z predošlého systému a predvyplní
// R9006; 6 mm aj 10 mm objednávka zobrazí krajnú/stredovú krytku + madlo + kefy.
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

test('Deluxe 10mm: RAL select „Farba krytiek" s R9006/R7016, predvolená R9006, hint nerezová mušľa (#431 kolo 2)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Deluxe');
	// Deluxe default sklo = 10 mm → možnosti R9006/R7016
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Float kalené 10 mm');
	// #431 kolo 2: RAL select je VIDITEĽNÝ pre Deluxe (krytky majú farebné varianty)
	const sel = page.getByTestId('farba-kovania');
	await expect(sel).toBeVisible();
	// #431 kolo 2: label je „Farba krytiek" (kovanie = pevne nerezová mušľa)
	await expect(page.getByLabel(/Farba krytiek/)).toBeVisible();
	// predvolená farba R9006 (Patrik msg 1801337)
	await expect(sel).toHaveValue('R9006');
	// 10 mm ponúka len R9006/R7016 (nie R9005 — tá je 6 mm)
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

test('Deluxe: prepnutie 10mm R7016 → 6mm zahodí neplatnú farbu, možnosti 6mm sú R9006/R9005, default R9006 (#431 kolo 2)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Systém').selectOption('Deluxe');
	await expect(page.getByLabel(/Farba krytiek/)).toBeVisible();
	// 10 mm default → zvoľ R7016 (platná len pre 10 mm)
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Float kalené 10 mm');
	const sel = page.getByTestId('farba-kovania');
	await sel.selectOption('R7016');
	await expect(sel).toHaveValue('R7016');

	// prepni na 6 mm → R7016 už nie je platná (6 mm ponúka R9006/R9005) → hranový
	// $effect ju zahodí a predvyplní R9006 (platnú na oboch hrúbkach)
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Float kalené 6 mm');
	// deterministicky prejdi Svelte render-flush (reaktívny select) pred asertom
	await page.evaluate(
		() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
	);
	const hodnoty = await sel
		.locator('option')
		.evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v));
	expect(hodnoty.sort()).toEqual(['R9005', 'R9006'].sort());
	await expect(sel).toHaveValue('R9006', { timeout: 2000 });

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

test('Deluxe 3K 10mm R9006: krajná×2, stredová L×2 + P×2, madlo×2, kefy, žiadne upozornenie', async ({
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

test('Deluxe 3K 6mm R9006: krytky (stredová L/P + krajná) + madlo + kefy, žiadne upozornenie (#431 kolo 2)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, '02');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Float kalené 6 mm');
	// 6mm krytky sa teraz evidujú v RAL (#431 kolo 2) — vyber R9006
	await vyberFarbuKovania(page, 'R9006');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	// 3K = 3 krídla → 2 stykov (N-1) → stredová L aj P 2×; krajná vždy 2×
	await expect(mnozstvo(page, 'ZASK202519')).toHaveText('2 ks'); // stredová L 6mm R9006
	await expect(mnozstvo(page, 'ZASK202521')).toHaveText('2 ks'); // stredová P 6mm R9006
	await expect(mnozstvo(page, 'ZASK202523')).toHaveText('2 ks'); // krajná 6mm R9006
	// R9005 6mm varianty absent (zvolili sme R9006)
	for (const k of ['ZASK202520', 'ZASK202522', 'ZASK202524']) {
		await expect(riadok(page, k)).toHaveCount(0);
	}
	// 10mm varianty vôbec (iná hrúbka)
	for (const k of ['ZASK202525', 'ZASK202527', 'ZASK202529']) {
		await expect(riadok(page, k)).toHaveCount(0);
	}
	await expect(mnozstvo(page, 'ZASK00049')).toHaveText('2 ks'); // madlo
	await expect(mnozstvo(page, 'ZASK00007')).toContainText(/\d+(,\d+)? m/); // kefa kladkový
	await expect(mnozstvo(page, 'ZASK202542')).toContainText(/\d+(,\d+)? m/); // kefa klzný
	// 6mm objednávka je teraz KOMPLETNÁ — žiadne upozornenie na chýbajúce krytky
	await expect(page.getByTestId('plan-warn')).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});
