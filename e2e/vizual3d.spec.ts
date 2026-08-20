// Zákaznícky 3D náhľad (#170 §2.12) — e2e cez reálny prehliadač. Reálny
// WebGL2 kontext (Chromium v CI má softvérový/hardvérový GL), takže tieto
// testy bežia na SKUTOČNOM tieri, nie mockovanom — presne to dokazuje, že sa
// dá naozaj vykresliť, nie len že sa nezhodí typescript.
import { test, expect, type Page } from '@playwright/test';
import { goto, loginAs, collectConsole, waitHydrated } from './helpers';

async function vyplnAVykresli(page: Page) {
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
}

/** Screenshotuje canvas element (Playwright kompozitný screenshot — NEZÁVISÍ
 *  od `preserveDrawingBuffer`, na rozdiel od `gl.readPixels()` volaného ZVONKA
 *  appky: bez `preserveDrawingBuffer:true` (§2.10 to zámerne ZAKAZUJE — kradlo
 *  by výkon na telefóne) je WebGL kresliaci buffer platný LEN hneď po
 *  `render()`, takže externé `readPixels` o pár tickov neskôr prečíta už
 *  VYMAZANÝ/undefined buffer — presne to sa stalo pri prvom pokuse o tento
 *  test, viď git história). Vráti veľkosť PNG bajtov — detailný 3D render
 *  komprimuje na výrazne VIAC bajtov než plochá/prázdna farba (PNG deflate),
 *  čo je spoľahlivý, jednotkovo lacný dôkaz "nie je to prázdne/jednofarebné". */
async function velkostRenderuPng(page: Page, testid: string): Promise<number> {
	const buffer = await page.getByTestId(testid).screenshot({ type: 'png' });
	return buffer.length;
}

test.describe('Vizual3D — zákaznícky 3D náhľad (#170)', () => {
	test('reálna konfigurácia → [data-viz-ready="true"], nula console errors/warnings', async ({
		page
	}) => {
		const consoleMsgs = collectConsole(page);
		await loginAs(page);
		await vyplnAVykresli(page);

		await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 10000 });
		await expect(page.getByTestId('vizual3d-canvas')).toBeVisible();

		expect(consoleMsgs).toEqual([]);
	});

	test('canvas má nenulovú veľkosť a nenulovú varianciu pixelov (nie prázdny/jednofarebný buffer)', async ({
		page
	}) => {
		const consoleMsgs = collectConsole(page);
		await loginAs(page);
		await vyplnAVykresli(page);
		await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 10000 });

		const box = await page.getByTestId('vizual3d-canvas').boundingBox();
		expect(box).not.toBeNull();
		expect(box!.width).toBeGreaterThan(50);
		expect(box!.height).toBeGreaterThan(50);

		const tier = await page.locator('[data-testid="vizual3d"]').getAttribute('data-viz-ready');
		// T0 (WebGL nedostupné) by v CI Chromium nemalo nastať — ak nastane,
		// nasledujúci assert to jasne odhalí (poster namiesto canvasu)
		expect(tier).toBe('true');

		const bajtov = await velkostRenderuPng(page, 'vizual3d-canvas');
		// prázdna/jednofarebná plocha PNG-kompresuje na pár stoviek bajtov;
		// detailný 3D render (rám/sklo/dlažba/stena/obloha) na desiatky KB
		expect(bajtov).toBeGreaterThan(5000);
		expect(consoleMsgs).toEqual([]);
	});

	test('presety menia kameru (data-viz-preset + data-viz-cam), RAL čip mení farbu (data-viz-ral)', async ({
		page
	}) => {
		const consoleMsgs = collectConsole(page);
		await loginAs(page);
		await vyplnAVykresli(page);
		await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 10000 });

		const kontajner = page.locator('[data-testid="vizual3d"]');
		await expect(kontajner).toHaveAttribute('data-viz-preset', 'troStvrte');
		const camPred = await kontajner.getAttribute('data-viz-cam');

		await page.getByTestId('viz-preset-celny').click();
		await expect(kontajner).toHaveAttribute('data-viz-preset', 'celny');
		await expect.poll(async () => kontajner.getAttribute('data-viz-cam')).not.toBe(camPred);

		await page.getByTestId('viz-preset-zvnutra').click();
		await expect(kontajner).toHaveAttribute('data-viz-preset', 'zvnutra');

		await expect(kontajner).toHaveAttribute('data-viz-ral', '7016');
		await page.getByTestId('viz-ral-9010').click();
		await expect(kontajner).toHaveAttribute('data-viz-ral', '9010');
		expect(consoleMsgs).toEqual([]);
	});

	test('prepínač "Otvoriť" posúva krídla (geometria sa prestaví bez pádu na T0 poster)', async ({
		page
	}) => {
		const consoleMsgs = collectConsole(page);
		await loginAs(page);
		await vyplnAVykresli(page);
		await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 10000 });

		await page.getByTestId('viz-otvorene-toggle').click();
		await expect(page.getByTestId('viz-otvorene-toggle')).toContainText('Zatvoriť');
		// scéna ostáva živá (nespadla na T0 poster) — canvas je stále viditeľný
		// a stále má reálny obsah
		await expect(page.getByTestId('vizual3d-poster-overlay')).toHaveCount(0);
		await expect(page.getByTestId('vizual3d-canvas')).toBeVisible();
		const bajtov = await velkostRenderuPng(page, 'vizual3d-canvas');
		expect(bajtov).toBeGreaterThan(5000);

		await page.getByTestId('viz-otvorene-toggle').click();
		await expect(page.getByTestId('viz-otvorene-toggle')).toContainText('Otvoriť');

		expect(consoleMsgs).toEqual([]);
	});

	test('reset tlačidlo vráti kameru na default preset', async ({ page }) => {
		const consoleMsgs = collectConsole(page);
		await loginAs(page);
		await vyplnAVykresli(page);
		await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 10000 });

		await page.getByTestId('viz-preset-zvnutra').click();
		await expect(page.locator('[data-testid="vizual3d"]')).toHaveAttribute(
			'data-viz-preset',
			'zvnutra'
		);

		await page.getByTestId('viz-reset').click();
		await expect(page.locator('[data-testid="vizual3d"]')).toHaveAttribute(
			'data-viz-preset',
			'troStvrte'
		);
		expect(consoleMsgs).toEqual([]);
	});

	test('caption pásik nesie rozmery a RAL — v RENDERI (canvas) samotnom nie je žiadny text', async ({
		page
	}) => {
		const consoleMsgs = collectConsole(page);
		await loginAs(page);
		await vyplnAVykresli(page);
		await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 10000 });

		await expect(page.getByTestId('viz-caption-rozmer')).toHaveText('4200 × 2100 mm');
		await expect(page.getByTestId('viz-caption-ral')).toContainText('RAL 7016');
		// caption je HTML mimo <canvas> — canvas sám neobsahuje žiadny <text>/DOM prvok
		await expect(page.getByTestId('vizual3d-canvas').locator('text')).toHaveCount(0);
		expect(consoleMsgs).toEqual([]);
	});

	test('RAL "iný…" (voľný text) → povinná ilustračná poznámka v caption', async ({ page }) => {
		const consoleMsgs = collectConsole(page);
		await loginAs(page);
		await goto(page, '/zasklenia/navrh');
		await waitHydrated(page);
		await page.getByLabel('Systém').selectOption('Robust');
		await page.getByLabel('Štýl').selectOption('3K');
		await page.getByLabel('Celková šírka (mm) *').fill('4200');
		await page.getByLabel('Celková výška (mm) *').fill('2100');
		await page.getByTestId('rezim-farebny-radio').check();
		await page.getByLabel('RAL odtieň').selectOption('iny');
		await page.getByTestId('ral-iny-text').fill('RAL 7021 matná');
		await page.getByTestId('nakreslit').click();
		await waitHydrated(page);
		await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 10000 });

		await expect(page.getByTestId('vizual3d-caption')).toContainText('ilustračná');
		await expect(page.getByTestId('vizual3d-caption')).toContainText('RAL 7021 matná');
		expect(consoleMsgs).toEqual([]);
	});

	test('leak test SPA navigácie: mount → odnavigovať → vrátiť sa → nula console errorov, presne 1 živý VIZ kontext', async ({
		page
	}) => {
		const consoleMsgs = collectConsole(page);
		await loginAs(page);
		await vyplnAVykresli(page);
		await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 10000 });

		await goto(page, '/zasklenia');
		await goto(page, '/zasklenia/navrh');
		await waitHydrated(page);
		// druhé vykreslenie po návrate — mount/destroy cyklus komponenty
		await page.getByLabel('Systém').selectOption('Robust');
		await page.getByLabel('Štýl').selectOption('2K');
		await page.getByLabel('Celková šírka (mm) *').fill('3000');
		await page.getByLabel('Celková výška (mm) *').fill('1800');
		await page.getByTestId('nakreslit').click();
		await waitHydrated(page);
		await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 10000 });

		const kontexty = await page.evaluate(
			() => (globalThis as unknown as { __VIZ_CONTEXTS?: number }).__VIZ_CONTEXTS
		);
		expect(kontexty).toBe(1);

		expect(consoleMsgs).toEqual([]);
	});

	test('tier "none" (WebGL zablokované): vykreslí sa SVG poster, žiadna výnimka, nula console errorov', async ({
		page
	}) => {
		// stub getContext PRED akýmkoľvek app JS — simuluje zariadenie bez WebGL2
		await page.addInitScript(() => {
			const povodny = HTMLCanvasElement.prototype.getContext;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(HTMLCanvasElement.prototype as any).getContext = function (typ: string, ...rest: unknown[]) {
				if (typ === 'webgl2' || typ === 'webgl') return null;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				return (povodny as any).call(this, typ, ...rest);
			};
		});
		const consoleMsgs = collectConsole(page);
		await loginAs(page);
		await vyplnAVykresli(page);

		await expect(page.getByTestId('vizual3d-poster-overlay')).toBeVisible({ timeout: 10000 });
		await expect(page.getByTestId('vizual3d-poster')).toBeVisible();
		// T0 poster = existujúca SVG elevácia (ZaskleniaNavrhVykres), nie prázdne miesto
		await expect(page.getByTestId('vizual3d-poster').getByTestId('zn-elevacia')).toBeVisible();

		expect(consoleMsgs).toEqual([]);
	});
});

test.describe('Vizual3D — money-guard (žiadny zápis do Money z tejto stránky)', () => {
	test('zákaznícky náhľad na /zasklenia/navrh nevystaví žiadne "odoslať" tlačidlo', async ({
		page
	}) => {
		const consoleMsgs = collectConsole(page);
		await loginAs(page);
		await vyplnAVykresli(page);
		await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 10000 });
		await expect(page.getByRole('button', { name: /odoslať/i })).toHaveCount(0);
		expect(consoleMsgs).toEqual([]);
	});
});
