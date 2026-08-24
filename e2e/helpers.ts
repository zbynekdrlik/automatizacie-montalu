import { expect, test, type Page } from '@playwright/test';

// Chromium/ANGLE niekedy vypíše VLASTNÚ nízkoúrovňovú GPU driver diagnostiku
// (nie `console.error`/`console.warn` z APLIKAČNÉHO JS, ale priamo z GL
// backendu prehliadača) presne RAZ za život WORKEROVHO browser procesu — pri
// PRVOM VÔBEC vytvorenom WebGL kontexte (nezávisle od toho, ktorý test/stránka
// ho vytvorí). Nájdené naživo (#170, Vizual3D 3D náhľad): "GPU stall due to
// ReadPixels" hlásenie o VÝKONE, nie o chybe — reprodukovalo sa v teste, ktorý
// `readPixels` vôbec nevolá, a nikdy znova v tom istom workeri. Je to
// hardvér/driver-špecifické (viazané na skutočný OpenGL backend tohto stroja,
// nie na SwiftShader softvérové vykresľovanie, aké typicky beží v CI), takže
// filter je zámerne ÚZKY (presný vzor GL Driver Message + Performance), nikdy
// nezachytí skutočnú aplikačnú chybu.
const NESKODNY_GL_DRIVER_VZOR = /GL Driver Message.*Performance.*GPU stall due to ReadPixels/;

// model-viewer (#286, AR náhľad pergoly) vypíše na CPU-hladovanom runneri VLASTNÝ
// interný self-diagnostický warning "rAF timed out in updateSource" — jeho 500ms
// rAF-vs-setTimeout poistka v [$updateSource] (node_modules/@google/model-viewer/
// src/model-viewer-base.ts, `console.warn('rAF timed out in updateSource')`), NIE
// chyba z APLIKAČNÉHO JS. Funkčné asserty (loaded/modelIsVisible/src/ar-modes)
// prešli. Filter je EXACT-MATCH (celý reťazec zakotvený ^…$), aby nikdy nezakryl
// skutočnú aplikačnú chybu.
const NESKODNY_MODEL_VIEWER_VZOR = /^rAF timed out in updateSource$/;

/** Zbiera console errors/warnings — každý test na konci overí, že je prázdne. */
export function collectConsole(page: Page): string[] {
	const messages: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error' || msg.type() === 'warning') {
			if (NESKODNY_GL_DRIVER_VZOR.test(msg.text())) return;
			if (NESKODNY_MODEL_VIEWER_VZOR.test(msg.text())) return;
			messages.push(`[${msg.type()}] ${msg.text()}`);
		}
	});
	page.on('pageerror', (err) => messages.push(`[pageerror] ${err.message}`));
	return messages;
}

export const E2E_USER = process.env.E2E_USER || 'e2e';
export const E2E_PASS = process.env.E2E_PASS || 'e2e-heslo-123';

/**
 * goto + počkanie na hydratáciu. fill() pred dokončenou hydratáciou prehráva
 * s Svelte, ktorá value-bound inputy vráti na serverový stav (cez pomalý SSH
 * tunel sa JS načítava neskoro — v CI to nikdy nevidno).
 */
export async function waitHydrated(page: Page) {
	await page.waitForSelector('html[data-hydrated="1"]', { state: 'attached' });
}

export async function goto(page: Page, path: string) {
	await page.goto(path);
	await waitHydrated(page);
}

/** TVRDÁ POISTKA: zápisové testy sa NIKDY nespúšťajú proti LIVE nasadeniu —
 * testovací odpis nesmie skončiť v ostrom Money importe. */
export async function skipAkLive(page: Page) {
	const res = await page.request.get('/health');
	const { live } = (await res.json()) as { live: boolean };
	test.skip(live === true, 'LIVE nasadenie (MONEY_LIVE=1) — zápisové E2E preskočené');
}

export async function loginAs(page: Page, user = E2E_USER, pass = E2E_PASS) {
	await goto(page, '/login');
	await page.getByLabel('Meno').fill(user);
	await page.getByLabel('Heslo').fill(pass);
	await page.getByRole('button', { name: 'Prihlásiť' }).click();
	await expect(page).toHaveURL(/\/zasklenia/);
	await page.waitForSelector('html[data-hydrated="1"]', { state: 'attached' });
}
