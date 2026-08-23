// AR náhľad pergoly (#286) — E2E cez reálny prehliadač. Tri veci:
//  (1) serverový GLB endpoint vráti VALIDNÝ binárny glTF (magic "glTF", verzia 2, dĺžka),
//  (2) na mobile /konfigurator ukáže „Pozri v AR" ODKAZ na AR stránku (BEZ model-viewer na
//      súhrne → jedna three inštancia → zero-console; multi-instance three by inak varoval),
//  (3) samostatná AR stránka /konfigurator/ar načíta model-viewer a VYKRESLÍ GLB model.
// Verejná route, Money-neutrálne (GLB = čistá geometria/materiály) → žiadny skipAkLive.
// Každý test = NULA console chýb.
import { test, expect } from '@playwright/test';
import { goto, collectConsole } from './helpers';

const GLB_URL =
	'/konfigurator/model.glb?sirka=5000&hlbka=4000&vyskaVpredu=2500&vyskaPriStene=2920&sklo=cire&farba=7016';

async function submitKonfig(page: import('@playwright/test').Page) {
	await page.getByTestId('sirka').fill('5000');
	await page.getByTestId('hlbka').fill('4000');
	await page.getByTestId('vyskaVpredu').fill('2500');
	await page.getByTestId('sklonDeg').fill('6');
	await page.getByTestId('zobrazit').click();
	await expect(page.getByTestId('suhrn')).toBeVisible();
}

test('konfigurátor AR: GLB endpoint vráti validný binárny glTF (magic, verzia, dĺžka, content-type), nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator');

	const res = await page.request.get(GLB_URL);
	expect(res.status()).toBe(200);
	expect(res.headers()['content-type']).toBe('model/gltf-binary');

	const buf = await res.body();
	expect(buf.length).toBeGreaterThan(500); // netriviálny model
	// GLB header: magic "glTF", verzia (u32 LE), celková dĺžka (u32 LE)
	expect(buf.subarray(0, 4).toString('ascii')).toBe('glTF');
	expect(buf.readUInt32LE(4)).toBe(2); // glTF verzia 2
	expect(buf.readUInt32LE(8)).toBe(buf.length); // deklarovaná dĺžka == skutočná

	// mimo rozmedzia → 400 (validácia cez KONF rozmedzia)
	const bad = await page.request.get(
		'/konfigurator/model.glb?sirka=99999&hlbka=4000&vyskaVpredu=2500&vyskaPriStene=2900&sklo=cire&farba=7016'
	);
	expect(bad.status()).toBe(400);

	expect(consoleMsgs).toEqual([]);
});

test('konfigurátor AR: mobil ukáže „Pozri v AR" odkaz na AR stránku (bez model-viewer na súhrne), nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await goto(page, '/konfigurator');
	await submitKonfig(page);

	// AR sekcia je súčasťou súhrnu; na mobile je to ODKAZ na /konfigurator/ar
	const open = page.getByTestId('pergola-ar-open');
	await expect(open).toBeVisible();
	const href = await open.getAttribute('href');
	expect(href).toContain('/konfigurator/ar?');
	expect(href).toContain('sirka=5000');
	expect(href).toContain('sklo=cire');

	// model-viewer sa NEnačíta na /konfigurator (dôkaz jednej three inštancie → zero-console)
	expect(await page.locator('model-viewer').count()).toBe(0);

	expect(consoleMsgs).toEqual([]);
});

test('konfigurátor AR: samostatná AR stránka načíta model-viewer a vykreslí GLB model, nula console chýb', async ({
	page
}) => {
	test.setTimeout(60000); // softvérový WebGL v CI je pomalší (model-viewer + GLB load)
	const consoleMsgs = collectConsole(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await goto(page, GLB_URL.replace('/model.glb', '/ar'));

	const mv = page.getByTestId('pergola-ar-viewer');
	await expect(mv).toBeVisible({ timeout: 20000 });

	// model-viewer skutočne NAČÍTAL a VYKRESLIL GLB (loaded + modelIsVisible = true)
	await page.waitForFunction(
		() => {
			const el = document.querySelector('[data-testid="pergola-ar-viewer"]') as
				(Element & { loaded?: boolean; modelIsVisible?: boolean }) | null;
			return !!el && el.loaded === true && el.modelIsVisible === true;
		},
		{ timeout: 30000 }
	);

	// src (property — Svelte 5 nastaví na custom element ako property) mieri na GLB endpoint
	const src = await mv.evaluate((el) => (el as unknown as { src: string }).src);
	expect(src).toContain('/konfigurator/model.glb?');
	expect(src).toContain('sklo=cire');
	// AR je zapnuté (ar property) + ar-modes pokrýva WebXR/Scene Viewer/Quick Look
	const arEnabled = await mv.evaluate((el) => (el as unknown as { ar: boolean }).ar === true);
	expect(arEnabled).toBe(true);
	expect(await mv.getAttribute('ar-modes')).toBe('webxr scene-viewer quick-look');

	expect(consoleMsgs).toEqual([]);
});
