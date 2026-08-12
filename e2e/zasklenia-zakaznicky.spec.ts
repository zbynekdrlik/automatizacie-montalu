// Zákaznícky TLAČOVÝ list (#170 §2.10) — /zasklenia/navrh/zakaznicky. Vysoké
// rozlíšenie zachytené z live 3D scény, vložené do existujúceho VykresovyHarok
// shellu. Do Money NIČ nezapisuje (rovnaká disciplína ako /zasklenia/navrh).
//
// POZOR: obrázok aj caption sú vnorené v SVG `<foreignObject>` (aby sa dal
// použiť skutočný HTML `<img>`/`<div>` vnútri VykresovyHarok SVG rámu, §2.10).
// Playwright má ZDOKUMENTOVANÝ limit v tom, ako jeho `page.locator()`/
// `getByTestId()` selector engine rezolvuje obsah vnorený vo foreignObject —
// element PREUKÁZATEĽNE existuje (plain `document.querySelector` ho nájde,
// accessibility snapshot ho vidí, screenshot ho ukazuje), ale
// `locator(...).waitFor()`/`toBeVisible()`/`toContainText()` naň nikdy
// nerezolvujú (nájdené naživo, potvrdené izolovaným debug skriptom aj
// priamym testom). Preto sa tento konkrétny obsah overuje cez
// `page.waitForFunction()` + `page.evaluate()` (surové DOM API v kontexte
// stránky), nie cez bežné locator API — zvyšok stránky (mimo foreignObject)
// bežné locator API používa normálne.
import { test, expect, type Page } from '@playwright/test';
import { goto, loginAs, collectConsole, waitHydrated } from './helpers';

async function vyplnAOtvorZakaznickyList(page: Page) {
	await goto(page, '/zasklenia/navrh');
	await waitHydrated(page);
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('3K');
	await page.getByLabel('Celková šírka (mm) *').fill('4200');
	await page.getByLabel('Celková výška (mm) *').fill('2100');
	await page.getByTestId('rezim-farebny-radio').check();
	await page.getByLabel('RAL odtieň').selectOption('7016');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);
	await page.getByTestId('zakaznicky-list-btn').click();
	await waitHydrated(page);
}

/** Počká, kým `[data-testid="zakaznicky-obrazok"]` (vo foreignObject) dostane
 *  neprázdny `src` — surové DOM API, viď hlavičkový komentár. */
async function pockajNaObrazok(page: Page, timeout = 20000) {
	await page.waitForFunction(
		() => {
			const img = document.querySelector('[data-testid="zakaznicky-obrazok"]');
			return !!img?.getAttribute('src');
		},
		{ timeout }
	);
}

async function textObrazkovehoTestidu(page: Page, testid: string): Promise<string | null> {
	return page.evaluate(
		(tid) => document.querySelector(`[data-testid="${tid}"]`)?.textContent ?? null,
		testid
	);
}

test('zákaznícky list: zachytí PNG z 3D scény, caption nesie rozmery/RAL/poznámku, nula console errorov', async ({
	page
}) => {
	// Táto route stavia CELÚ 3D scénu (three.js + WebGL + PMREM environment)
	// na skrytom canvase a POTOM z nej zachytáva vysoké rozlíšenie (2400×1620,
	// so supersamplingom) — výrazne ťažšia práca než bežná stránka. Live CI
	// beh (GitHub Actions runner, softvérový WebGL) potreboval viac než
	// globálny `timeout: 30000` z playwright.config.ts (188/190 ostatných
	// testov v tom istom behu prešlo bez problému — toto je timing tejto
	// KONKRÉTNEJ route, nie všeobecná CI pomalosť).
	test.setTimeout(60000);
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await vyplnAOtvorZakaznickyList(page);

	await expect(page).toHaveURL(/\/zasklenia\/navrh\/zakaznicky/);
	await pockajNaObrazok(page);
	await expect(page.getByTestId('zakaznicky-tlac')).toBeEnabled();

	const src = await page.evaluate(
		() => document.querySelector('[data-testid="zakaznicky-obrazok"]')?.getAttribute('src') ?? null
	);
	expect(src).toMatch(/^blob:/);

	const caption = await textObrazkovehoTestidu(page, 'zakaznicky-caption');
	expect(caption).toContain('4200');
	expect(caption).toContain('2100');
	expect(caption).toContain('RAL 7016');
	expect(caption).toContain('Ilustračný');

	// technický výkres (kótovaný, autoritatívny) sa NEDOTKOL — stále je na
	// tej istej stránke ako pôvodne
	await expect(page.getByTestId('vykresovy-harok')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

test('zákaznícky list bez predchádzajúceho vykreslenia → jasná správa, žiadny pád', async ({
	page
}) => {
	await loginAs(page);
	await goto(page, '/zasklenia/navrh/zakaznicky');
	await waitHydrated(page);

	await expect(page.getByText('Najprv vykresli zasklenie')).toBeVisible();
	const existuje = await page.evaluate(
		() => !!document.querySelector('[data-testid="zakaznicky-obrazok"]')
	);
	expect(existuje).toBe(false);
});

test('žiadne "odoslať" (Money) tlačidlo na zákazníckom tlačovom liste', async ({ page }) => {
	// rovnaký dôvod ako vyššie — táto route stavia + zachytáva celú 3D scénu
	test.setTimeout(60000);
	await loginAs(page);
	await vyplnAOtvorZakaznickyList(page);
	await pockajNaObrazok(page);
	await expect(page.getByRole('button', { name: /odoslať/i })).toHaveCount(0);
});
