// Verejný zákaznícky konfigurátor pergoly (#275, fáza 1) — E2E cez reálny prehliadač.
// Kľúčové: flow BEZ prihlásenia (verejná route), a v odpovedi sa NEOBJAVÍ žiadna cena,
// Money kód (TS*) ani nárez. Display-only ČASŤ (súhrn) beží aj proti nasadenej appke
// (BASE_URL), bez skipAkLive. #277 pridal DOPYT tok (kontaktný formulár → PDF ponuka BEZ
// CIEN): ten zapisuje audit riadok do SQLite `dopyt` (Money-NEUTRÁLNE, žiadny Money
// import) — je za `skipAkLive`, nech proti LIVE prode nepribúdajú testovacie dopyt
// riadky (v CI beží proti preview, live:false → beží). Každý test = NULA console chýb.
import { test, expect } from '@playwright/test';
import { goto, collectConsole, skipAkLive } from './helpers';

test('konfigurátor: verejný flow BEZ prihlásenia → súhrn konfigurácie, žiadna cena/Money kód, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);

	// verejná route — žiadne prihlásenie; NESMIE presmerovať na /login
	await goto(page, '/konfigurator');
	await expect(page).toHaveURL(/\/konfigurator$/);
	await expect(page.getByRole('heading', { name: /Navrhni si.*pergolu/i })).toBeVisible();

	await page.getByTestId('sirka').fill('5000');
	await page.getByTestId('hlbka').fill('4000');
	await page.getByTestId('vyskaVpredu').fill('3000');
	await page.getByTestId('sklonDeg').fill('10');

	// vyber typ skla ZISTENÝ ZA BEHU ako NIE prvý v zozname (nova-stranka disciplína #3 —
	// aspoň jeden test vyberá non-default hodnotu, aby zachytil prípadný tichý revert)
	const sklo = page.getByTestId('sklo');
	const skloOptions = sklo.locator('option');
	const vybranySklo = (await skloOptions.nth(2).getAttribute('value')) ?? '';
	expect(vybranySklo).not.toBe('');
	await sklo.selectOption(vybranySklo);

	await page.getByTestId('zobrazit').click();

	const suhrn = page.getByTestId('suhrn');
	await expect(suhrn).toBeVisible();
	// dopočítané hodnoty (celé čísla — bez zaokrúhľovacej krehkosti)
	await expect(page.getByTestId('s-plocha')).toHaveText('20 m²'); // 5000·4000 mm = 20 m²
	await expect(page.getByTestId('s-svetla')).toHaveText('2810 mm'); // 3000 − 190 (nosník)
	await expect(page.getByTestId('s-sklon')).toContainText('10');
	// zvolený (non-default) typ skla sa prejaví v súhrne
	await expect(page.getByTestId('s-sklo')).toHaveText(vybranySklo);
	await expect(page.getByTestId('s-farba')).toContainText('RAL 7016');

	// ÚNIK GUARD: nikde na stránke žiadna cena (€/EUR), žiadny Money kód (TS###), žiadny nárez
	const telo = await page.locator('body').innerText();
	expect(telo).not.toMatch(/€|EUR\b/);
	expect(telo).not.toMatch(/TS\d{3}/);
	expect(telo).not.toMatch(/nárez/i);

	// verzia v pätičke (version-on-dashboard) — pätička je zdieľaná aj pre verejnú stránku
	await expect(page.getByTestId('version')).toHaveText(
		/^v\d+\.\d+\.\d+(-dev\.\d+)?(\s\([0-9a-f]{7}\))?$/
	);
	expect(consoleMsgs).toEqual([]);
});

test('konfigurátor: kombinácia výška+hĺbka+sklon nad rozmedzie → friendly chyba, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator');

	// všetky polia v rámci individuálnych min/max (prejdú client validáciou), ale
	// dopočítaná výška pri stene presiahne max enginu → server vráti friendly chybu
	await page.getByTestId('sirka').fill('8000');
	await page.getByTestId('hlbka').fill('6000');
	await page.getByTestId('vyskaVpredu').fill('4000');
	await page.getByTestId('sklonDeg').fill('30');
	await page.getByTestId('zobrazit').click();

	await expect(page.getByTestId('chyba')).toBeVisible();
	await expect(page.getByTestId('chyba')).toContainText(/stene/i);
	await expect(page.getByTestId('suhrn')).toHaveCount(0);
	expect(consoleMsgs).toEqual([]);
});

test('konfigurátor: dopyt tok — súhrn → kontaktný formulár → PDF ponuka (bez cien) na stiahnutie, nula console chýb', async ({
	page
}) => {
	// zápisový tok (audit riadok do `dopyt`) — proti LIVE prode preskočiť, nech nepribúdajú
	// testovacie dopyty. Money-neutrálne, ale poriadok je poriadok (vzor audit3.spec.ts).
	await skipAkLive(page);

	const consoleMsgs = collectConsole(page);

	await goto(page, '/konfigurator');
	await expect(page).toHaveURL(/\/konfigurator$/);

	// 1) nakonfiguruj pergolu → zobraz súhrn
	await page.getByTestId('sirka').fill('4500');
	await page.getByTestId('hlbka').fill('3500');
	await page.getByTestId('vyskaVpredu').fill('2800');
	await page.getByTestId('sklonDeg').fill('8');
	await page.getByTestId('zobrazit').click();
	await expect(page.getByTestId('suhrn')).toBeVisible();

	// 2) kontaktný formulár (#277) sa objaví až po súhrne
	const dopyt = page.getByTestId('dopyt');
	await expect(dopyt).toBeVisible();
	await expect(dopyt.getByRole('heading', { name: /Máš záujem/i })).toBeVisible();

	// 3) vyplň kontakt — JASNE OZNAČENÝ testovací dopyt (honeypot `firma_web` nechávame prázdny)
	await dopyt.getByLabel(/Meno a priezvisko/).fill('TEST E2E — ignorovať');
	await dopyt.getByLabel(/^E-mail/).fill('test-e2e@example.com');
	await dopyt.getByLabel(/Telefón/).fill('+421900000000');
	await dopyt.getByLabel(/Miesto stavby/).fill('83101 Bratislava');
	await dopyt.getByLabel(/Poznámka/).fill('TEST E2E — automatický test, prosím ignorovať.');

	// 4) odošli → server vráti PDF (base64) → komponent spustí stiahnutie
	const responsePromise = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('dopyt')
	);
	const downloadPromise = page.waitForEvent('download');
	await dopyt.getByRole('button', { name: /Odoslať dopyt/i }).click();

	const response = await responsePromise;
	expect(response.ok()).toBe(true); // POST akcie prešiel (2xx)

	const download = await downloadPromise; // PDF sa reálne stiahol
	expect(download.suggestedFilename()).toMatch(/^Montalu-ponuka-\d{4}-\d{2}-\d{2}\.pdf$/);

	// 5) potvrdenie úspechu (formulár nahradený poďakovaním)
	await expect(page.getByText('Ďakujeme! Dopyt sme prijali.')).toBeVisible();

	// 6) ÚNIK GUARD (rovnako ako display-only test): žiadna cena / Money kód / nárez na stránke
	const telo = await page.locator('body').innerText();
	expect(telo).not.toMatch(/€|EUR\b/);
	expect(telo).not.toMatch(/TS\d{3}/);
	expect(telo).not.toMatch(/nárez/i);

	expect(consoleMsgs).toEqual([]);
});

// #276: 3D náhľad pergoly na VEREJNEJ route. Náhľad sa objaví PO submite (lazy-loaded
// komponent — 3D/three.js bundle sa nenačíta pred zobrazením), previazaný na rozmery/sklo/
// RAL zo súhrnu. Kľúčové: render funguje + NULA console errorov/warningov (vrátane three.js
// warningov) + žiaden únik ceny/Money kódu. `?viz=` vynúti tier (e2e determinizmus). Beží aj
// proti nasadenej appke (display-only, žiadny zápis) — bez skipAkLive.

/** Veľkosť PNG screenshotu canvasu — netriviálny 3D render deflate-komprimuje na výrazne
 *  VIAC bajtov než prázdna/jednofarebná plocha (rovnaká heuristika ako vizual-showroom). */
async function velkostCanvasPng(page: import('@playwright/test').Page): Promise<number> {
	const buffer = await page.getByTestId('vizual3d-canvas').screenshot({ type: 'png' });
	return buffer.length;
}

async function vyplnFormular(page: import('@playwright/test').Page) {
	await page.getByTestId('sirka').fill('5000');
	await page.getByTestId('hlbka').fill('3800');
	await page.getByTestId('vyskaVpredu').fill('2800');
	await page.getByTestId('sklonDeg').fill('8');
	// non-default sklo (mliečne → matný odtieň) + non-default RAL, nech 3D dostane reálny vstup
	await page.getByTestId('sklo').selectOption({ label: '4.4.2 mliečne' });
	await page.getByTestId('farba').selectOption('9005');
}

test('konfigurátor: 3D náhľad sa vyrenderuje po submite (desktop, mid tier), nula console chýb, žiaden únik', async ({
	page
}) => {
	test.setTimeout(60000); // softvérový WebGL v CI je pomalší (lazy import + stavba scény + HDRI)
	const consoleMsgs = collectConsole(page);

	await goto(page, '/konfigurator?viz=mid');
	await expect(page).toHaveURL(/\/konfigurator/);

	await vyplnFormular(page);

	// #276 lazy-load LOCK: PRED submitom 3D vrstva NIE JE aktívna — komponent nie je
	// namountovaný a žiadny WebGL kontext neexistuje → dôkaz, že 3D/three.js bundle sa
	// nenačíta pred zobrazením náhľadu (hard constraint konfigurator.md — lazy dynamic import).
	expect(await page.getByTestId('konf-viz').count()).toBe(0);
	expect(await page.getByTestId('vizual3d-canvas').count()).toBe(0);
	expect(
		await page.evaluate(() => (window as { __VIZ_CONTEXTS?: number }).__VIZ_CONTEXTS ?? null)
	).toBeNull();

	await page.getByTestId('zobrazit').click();
	await expect(page.getByTestId('suhrn')).toBeVisible();

	// 3D náhľad je „hero" súhrnu — objaví sa nad tabuľkou; lazy komponent + engine ready
	await expect(page.getByTestId('konf-viz')).toBeVisible();
	await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 20000 });
	await expect(page.getByTestId('vizual3d-canvas')).toBeVisible();

	const box = await page.getByTestId('vizual3d-canvas').boundingBox();
	expect(box).not.toBeNull();
	expect(box!.width).toBeGreaterThan(50);
	expect(box!.height).toBeGreaterThan(50);
	// netriviálny obsah (nie prázdny/jednofarebný canvas)
	expect(await velkostCanvasPng(page)).toBeGreaterThan(5000);

	// ÚNIK GUARD ostáva platný aj s 3D náhľadom na stránke
	const telo = await page.locator('body').innerText();
	expect(telo).not.toMatch(/€|EUR\b/);
	expect(telo).not.toMatch(/TS\d{3}/);
	expect(telo).not.toMatch(/nárez/i);

	expect(consoleMsgs).toEqual([]);
});

test('konfigurátor: 3D náhľad na MOBILNOM viewporte 390×844 (low tier fallback), nula console chýb', async ({
	page
}) => {
	test.setTimeout(60000);
	const consoleMsgs = collectConsole(page);
	await page.setViewportSize({ width: 390, height: 844 });

	await goto(page, '/konfigurator?viz=low');
	await vyplnFormular(page);
	await page.getByTestId('zobrazit').click();
	await expect(page.getByTestId('suhrn')).toBeVisible();

	await expect(page.getByTestId('konf-viz')).toBeVisible();
	await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 20000 });
	await expect(page.getByTestId('vizual3d-canvas')).toBeVisible();
	// low tier (bez HDRI/reálnych tieňov) musí stále vykresliť netriviálny obsah
	expect(await velkostCanvasPng(page)).toBeGreaterThan(5000);

	expect(consoleMsgs).toEqual([]);
});
