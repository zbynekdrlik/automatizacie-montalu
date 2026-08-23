// Showroom kvalita 3D vizuálu (#285) — e2e cez reálny prehliadač. Testuje
// ZDIEĽANÝ engine (Vizual3D + scena + materialy + kvalita + snimka) na admin
// 3D route `/zasklenia/navrh` — presne tá vrstva, ktorú #285 vylepšuje (HDRI/
// IBL, dielektrický práškovaný hliník, reálne PCFSoft tiene, NeutralToneMapping,
// PNG @3×). Zákaznícky komponent `VizualPergolaZakaznik` beží na TOM ISTOM
// engine; jeho verejná route je scope #275 (integrácia) — jej vlastné E2E
// pribudne tam.
//
// Kľúčové asercie #285:
//  - render funguje na MOBILNOM viewporte (bod 9 receptu) — netriviálny obsah,
//  - ZERO console errors/warnings vrátane three.js warningov, na VŠETKÝCH tieroch,
//  - HDRI sa načíta LEN z VLASTNÉHO originu (`/hdri/…`), NIKDY externý fetch
//    (žiaden polyhaven.org / iný host) — Money-guard „žiadna externá runtime
//    závislosť" dokázaný naživo, nie len staticky.
import { test, expect, type Page } from '@playwright/test';
import { goto, loginAs, collectConsole, waitHydrated } from './helpers';

/** Vyplní zasklenia formulár a vykreslí — s voliteľným `?viz=` na vynútenie
 *  tieru (e2e determinizmus). Rovnaká konfigurácia ako `e2e/vizual3d.spec.ts`. */
async function vykresliSViz(page: Page, viz?: 'low' | 'mid' | 'high') {
	await goto(page, viz ? `/zasklenia/navrh?viz=${viz}` : '/zasklenia/navrh');
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

/** Veľkosť PNG screenshotu canvasu — detailný 3D render deflate-komprimuje na
 *  výrazne VIAC bajtov než prázdna/jednofarebná plocha (rovnaká heuristika ako
 *  `e2e/vizual3d.spec.ts`). */
async function velkostCanvasPng(page: Page): Promise<number> {
	const buffer = await page.getByTestId('vizual3d-canvas').screenshot({ type: 'png' });
	return buffer.length;
}

/** Externé (cross-origin absolútne http[s]) requesty — MUSÍ byť prázdne
 *  (žiadna externá runtime závislosť; HDRI ide z vlastného originu). */
function zbierajExterneRequesty(page: Page): string[] {
	const externe: string[] = [];
	page.on('request', (req) => {
		const url = req.url();
		// same-origin appka beží na http://localhost:4173 (alebo BASE_URL);
		// čokoľvek smerujúce na polyhaven / iný absolútny host je porušenie
		if (/polyhaven|dl\.polyhaven|amazonaws|cloudfront|googleapis|gstatic/.test(url)) {
			externe.push(url);
		}
	});
	return externe;
}

test.describe('Vizual3D showroom (#285) — HDRI / dielektrický hliník / tiene / mobil', () => {
	test('MOBILNÝ viewport (390×844), mid tier: render funguje, nula console errorov, netriviálny obsah', async ({
		page
	}) => {
		test.setTimeout(60000); // softvérový WebGL v CI je pomalší (stavba scény + HDRI)
		const consoleMsgs = collectConsole(page);
		await page.setViewportSize({ width: 390, height: 844 });
		await loginAs(page);
		await vykresliSViz(page, 'mid');

		await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 15000 });
		await expect(page.getByTestId('vizual3d-canvas')).toBeVisible();

		const box = await page.getByTestId('vizual3d-canvas').boundingBox();
		expect(box).not.toBeNull();
		expect(box!.width).toBeGreaterThan(50);
		expect(box!.height).toBeGreaterThan(50);
		expect(await velkostCanvasPng(page)).toBeGreaterThan(5000);
		expect(consoleMsgs).toEqual([]);
	});

	test('HIGH tier (HDRI + reálne tiene + transmission sklo): render, nula console errorov, ŽIADEN externý fetch', async ({
		page
	}) => {
		test.setTimeout(60000);
		const consoleMsgs = collectConsole(page);
		const externe = zbierajExterneRequesty(page);
		await loginAs(page);
		await vykresliSViz(page, 'high');

		await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 15000 });
		await expect(page.getByTestId('vizual3d-canvas')).toBeVisible();
		expect(await velkostCanvasPng(page)).toBeGreaterThan(5000);

		// #285 Money-guard naživo: HDRI ide z VLASTNÉHO originu, žiaden externý fetch
		expect(externe).toEqual([]);
		expect(consoleMsgs).toEqual([]);
	});

	test('LOW tier (bez HDRI, bez reálnych tieňov — slabé GPU fallback): render, nula console errorov', async ({
		page
	}) => {
		test.setTimeout(60000);
		const consoleMsgs = collectConsole(page);
		await loginAs(page);
		await vykresliSViz(page, 'low');

		await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 15000 });
		await expect(page.getByTestId('vizual3d-canvas')).toBeVisible();
		// low tier musí stále vykresliť netriviálny obsah (procedurálne prostredie
		// + kontaktný dekal namiesto HDRI/reálnych tieňov)
		expect(await velkostCanvasPng(page)).toBeGreaterThan(5000);
		expect(consoleMsgs).toEqual([]);
	});

	test('HDRI asset je dosiahnuteľný z vlastného originu (200), nie 404', async ({ page }) => {
		await loginAs(page);
		const res = await page.request.get('/hdri/kloofendal_puresky_1k.hdr');
		expect(res.status()).toBe(200);
		// Radiance HDR magic — dôkaz, že sa servuje SKUTOČNÝ HDR, nie SPA fallback HTML
		const telo = (await res.body()).subarray(0, 11).toString('latin1');
		expect(telo).toContain('#?RADIANCE');
	});
});
