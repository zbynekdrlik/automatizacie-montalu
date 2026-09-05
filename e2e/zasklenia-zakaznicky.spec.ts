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
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/zasklenia/navrh/zakaznicky');
	await waitHydrated(page);

	await expect(page.getByText('Najprv vykresli zasklenie')).toBeVisible();
	const existuje = await page.evaluate(
		() => !!document.querySelector('[data-testid="zakaznicky-obrazok"]')
	);
	expect(existuje).toBe(false);
	expect(consoleMsgs).toEqual([]);
});

test('žiadne "odoslať" (Money) tlačidlo na zákazníckom tlačovom liste', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	// rovnaký dôvod ako vyššie — táto route stavia + zachytáva celú 3D scénu
	test.setTimeout(60000);
	await loginAs(page);
	await vyplnAOtvorZakaznickyList(page);
	await pockajNaObrazok(page);
	await expect(page.getByRole('button', { name: /odoslať/i })).toHaveCount(0);
	expect(consoleMsgs).toEqual([]);
});

// #464: „Skúsiť znova" retry path (3D capture failure) + navigačné linky
test('zákaznícky list: „Skúsiť znova" pri zlyhom zachytení + navigačné linky', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	test.setTimeout(60000);
	// Stub WebGL getContext to force capture failure
	await page.addInitScript(() => {
		const origGetContext = HTMLCanvasElement.prototype.getContext;
		let callCount = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(HTMLCanvasElement.prototype as any).getContext = function (type: string, ...args: unknown[]) {
			if (type === 'webgl2' || type === 'webgl') {
				callCount++;
				// Let the first few calls through for the probe, block rendering
				if (callCount > 2) return null;
			}
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return origGetContext.apply(this, [type, ...args] as any);
		};
	});
	await loginAs(page);
	await goto(page, '/zasklenia/navrh');
	await waitHydrated(page);

	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Celková šírka (mm) *').fill('3000');
	await page.getByLabel('Celková výška (mm) *').fill('2000');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);
	await page.getByTestId('zakaznicky-list-btn').click();
	await waitHydrated(page);

	// When 3D is unavailable, error or nedostupne message should show
	// Either chyba (zachytenie zlyhalo) or nedostupne (tier=none) depending on how the stub works
	const chyba = page.getByTestId('zakaznicky-chyba');
	const nedostupne = page.getByTestId('zakaznicky-nedostupne');
	// Wait for either error state
	await expect(chyba.or(nedostupne)).toBeVisible({ timeout: 30000 });

	if ((await chyba.count()) > 0) {
		// „Skúsiť znova" should be visible in the error paragraph
		const retry = chyba.getByRole('button', { name: 'Skúsiť znova' });
		await expect(retry).toBeVisible();
		await retry.click();
		// after retry, the error state persists (since getContext is still blocked)
		await expect(chyba.or(nedostupne)).toBeVisible({ timeout: 15000 });
	}

	// „← Späť na návrh" link navigates back
	const backLink = page.getByRole('link', { name: '← Späť na návrh' });
	await expect(backLink).toBeVisible();
	await backLink.click();
	await expect(page).toHaveURL(/\/zasklenia\/navrh$/);

	expect(consoleMsgs).toEqual([
		expect.stringMatching(/Zákaznícky list: zachytenie 3D náhľadu zlyhalo|CONTEXT_LOST/)
	]);
});

// #464: zákaznícky „návrhovej stránke" link (without prior drawing → jasná správa)
test('zákaznícky list: „návrhovej stránke" link naviguje na /zasklenia/navrh', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/zasklenia/navrh/zakaznicky');
	await waitHydrated(page);

	// bez predchádzajúceho vykreslenia — jasná správa
	await expect(page.getByText('Najprv vykresli zasklenie')).toBeVisible();
	const link = page.getByRole('link', { name: 'návrhovej stránke' });
	await expect(link).toBeVisible();
	await link.click();
	await expect(page).toHaveURL(/\/zasklenia\/navrh$/);
	expect(consoleMsgs).toEqual([]);
});
