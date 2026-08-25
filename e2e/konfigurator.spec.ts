// Verejný zákaznícky konfigurátor pergoly (#275/#279 Fáza C) — E2E cez reálny prehliadač.
// Kľúčové: flow BEZ prihlásenia (verejná route). #279 Fáza C: v odpovedi SMIE byť orientačná
// MO cena (owner ROZHODNUTÉ), ale NIKDY VEĽKOOBCHOD (VO) cena, Money kód (TS*) ani nárez.
// Display-only ČASŤ (súhrn + cena) beží aj proti nasadenej appke (BASE_URL), bez skipAkLive.
// #277 DOPYT tok (kontaktný formulár → PDF ponuka s orientačnou cenou): zapisuje audit riadok
// do SQLite `dopyt` (Money-NEUTRÁLNE, žiadny Money import) — je za `skipAkLive`, nech proti
// LIVE prode nepribúdajú testovacie dopyty. Každý test = NULA console chýb.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { goto, collectConsole, skipAkLive, loginAs } from './helpers';
// #288 review 🔵: kanonický klasifikátor (Node kontext — helper beží mimo page.evaluate),
// aby sa regresný guard nerozišiel s `SOFTVEROVY_RENDERER_RE` pri jej budúcej zmene.
import { jeSoftverovyRenderer } from '../src/lib/vizual/kvalita';

test('konfigurátor: verejný flow BEZ prihlásenia → súhrn + orientačná cena, žiadny Money kód/VO, nula console chýb', async ({
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

	// #279 Fáza C: orientačná cena sa zobrazí (default model LIGHT) + súhrn nesie model
	await expect(page.getByTestId('s-model')).toHaveText('LIGHT');
	await expect(page.getByTestId('cena')).toBeVisible();
	await expect(page.getByTestId('cena-sdph')).toContainText('€');
	await expect(page.getByTestId('cena-bezdph')).toContainText('bez DPH');
	// #318: neprihlásený návštevník je MO — NIKDY nevidí VO odznak (ani náznak VO hladiny)
	await expect(page.getByTestId('cena-hladina')).toHaveCount(0);

	// ÚNIK GUARD (redefinovaný, #279 Fáza C): orientačná cena SMIE byť na stránke (owner
	// ROZHODNUTÉ) — zakázaný ostáva len Money kód (TS###), nárez a VEĽKOOBCHOD (VO) cena.
	const telo = await page.locator('body').innerText();
	expect(telo).not.toMatch(/TS\d{3}/);
	expect(telo).not.toMatch(/nárez/i);
	expect(telo).not.toMatch(/priceB2B|ve[ľl]koobchod/i);

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

test('konfigurátor: dopyt tok — súhrn → kontaktný formulár → PDF ponuka s orientačnou cenou na stiahnutie, nula console chýb', async ({
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

	// 6) ÚNIK GUARD (#279 Fáza C redefinícia): orientačná cena SMIE byť na stránke; zakázaný
	//    ostáva Money kód (TS###), nárez a VEĽKOOBCHOD (VO) cena.
	const telo = await page.locator('body').innerText();
	expect(telo).not.toMatch(/TS\d{3}/);
	expect(telo).not.toMatch(/nárez/i);
	expect(telo).not.toMatch(/priceB2B|ve[ľl]koobchod/i);

	// 7) #279 Fáza C: stiahnuté PDF nesie ORIENTAČNÚ cenu (čítané z metadát — custom-font
	//    glyfy sa z PDF textu nedajú spoľahlivo prečítať, metadáta áno) a NIKDY VO cenu.
	const pdfCesta = await download.path();
	const pdfBytes = await readFile(pdfCesta);
	const doc = await PDFDocument.load(pdfBytes);
	const subject = doc.getSubject() ?? '';
	expect(subject).toMatch(/Orientačná cena:.*€/);
	expect(subject).not.toMatch(/priceB2B|ve[ľl]koobchod/i);

	expect(consoleMsgs).toEqual([]);
});

// #279 Fáza C: cenová vrstva vo verejnom konfigurátore — výber modelu mení orientačnú cenu,
// mimo katalógu → „cena na vyžiadanie". Display-only (žiadny zápis) → beží aj proti nasadenej
// appke (BASE_URL), bez skipAkLive.
test('konfigurátor: cena — výber modelu mení cenu, mimo katalógu → individuálna ponuka, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/konfigurator');

	// 1) konfigurácia s modelom LIGHT (3,0 × 5,0 m) → orientačná cena (€) + porovnanie 3 modelov
	await page.getByTestId('sirka').fill('5000');
	await page.getByTestId('hlbka').fill('3000');
	await page.getByTestId('vyskaVpredu').fill('2500');
	await page.getByTestId('sklonDeg').fill('6');
	await page.getByTestId('model-LIGHT').check();
	await page.getByTestId('zobrazit').click();

	await expect(page.getByTestId('cena')).toBeVisible();
	await expect(page.getByTestId('cena-sdph')).toContainText('€');
	const lightCena = (await page.getByTestId('cena-sdph').innerText()).trim();

	// porovnanie ukazuje všetky 3 modely (zrkadlo montalu.sk „ceny vedľa seba")
	await expect(page.getByTestId('porovnanie-LIGHT')).toBeVisible();
	await expect(page.getByTestId('porovnanie-ROBUST')).toBeVisible();
	await expect(page.getByTestId('porovnanie-MASSIVE')).toBeVisible();

	// 2) prepni na ROBUST → orientačná cena sa ZMENÍ (ROBUST je drahší než LIGHT)
	await page.getByTestId('model-ROBUST').check();
	await page.getByTestId('zobrazit').click();
	await expect(page.getByTestId('s-model')).toHaveText('ROBUST');
	await expect(page.getByTestId('cena-sdph')).toContainText('€');
	const robustCena = (await page.getByTestId('cena-sdph').innerText()).trim();
	expect(robustCena).not.toBe(lightCena);

	// 3) LIGHT nad hĺbku 4 m (5000 mm) → mimo katalógu → „cena na vyžiadanie" (individuálna)
	await page.getByTestId('model-LIGHT').check();
	await page.getByTestId('hlbka').fill('5000');
	await page.getByTestId('zobrazit').click();
	await expect(page.getByTestId('cena-individualna')).toBeVisible();
	await expect(page.getByTestId('cena-individualna')).toContainText(/vyžiadanie/i);

	// leak-guard (redefinovaný): žiadny Money kód (TS###), nárez ani VEĽKOOBCHOD (VO) cena
	const telo = await page.locator('body').innerText();
	expect(telo).not.toMatch(/TS\d{3}/);
	expect(telo).not.toMatch(/nárez/i);
	expect(telo).not.toMatch(/priceB2B|ve[ľl]koobchod/i);

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

/** #288 post-processing gate — regresný guard. `data-viz-postproc` MUSÍ byť vždy
 *  vydrôtovaný (`true`/`false`, nikdy chýbajúci). Na SOFTVÉROVOM rendereri (CI
 *  SwiftShader, #290 malý alokačný rozpočet) MUSÍ ostať composer VYPNUTÝ (`false` →
 *  priamy render, nulová regresia); na hardvéri je zapnutý, preto sa striktný
 *  `false` assert vzťahuje LEN na softvér (robustné voči budúcemu hardvérovému CI). */
async function overPostprocGate(page: import('@playwright/test').Page) {
	const info = await page.evaluate(() => {
		const el = document.querySelector('[data-testid="vizual3d"]');
		const c = document.createElement('canvas');
		const gl = c.getContext('webgl2');
		let renderer = '';
		if (gl) {
			const ext = gl.getExtension('WEBGL_debug_renderer_info');
			if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
		}
		return { renderer, postproc: el?.getAttribute('data-viz-postproc') };
	});
	expect(['true', 'false']).toContain(info.postproc);
	if (jeSoftverovyRenderer(info.renderer ?? '')) expect(info.postproc).toBe('false');
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

	// #288: post-processing gate (mid tier) — na softvérovom CI rendereri VYPNUTÝ (#290)
	await overPostprocGate(page);

	// ÚNIK GUARD (redefinovaný, #279 Fáza C) ostáva platný aj s 3D náhľadom: cena SMIE byť,
	// zakázaný je Money kód (TS###), nárez a VEĽKOOBCHOD (VO) cena.
	const telo = await page.locator('body').innerText();
	expect(telo).not.toMatch(/TS\d{3}/);
	expect(telo).not.toMatch(/nárez/i);
	expect(telo).not.toMatch(/priceB2B|ve[ľl]koobchod/i);

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

	// #288: low tier NIKDY nemá post-processing (postproc flag=false) — vždy priamy render
	await overPostprocGate(page);

	expect(consoleMsgs).toEqual([]);
});

// #318: VO (veľkoobchodná) cenová vrstva pre prihlásených veľkoobchodných (b2b) zákazníkov.
// Overuje CELÝ rozsah rozhodnutia hladiny naraz proti ROVNAKÉMU rozmeru:
//  • INTERNÝ (prihlásený, nie b2b) → MO cena, žiadny VO odznak (interný = maloobchod)
//  • VO/b2b → VEĽKOOBCHODNÁ cena + odznak, a cena je NIŽŠIA než MO (VO ≈ 65 % MO)
// (neprihlásený = MO bez odznaku je overený v prvom teste vyššie). Účet sa vytvorí + zmaže
// cez /pouzivatelia (users tabuľka NIE JE Money → sankcionovaný live check, vzor app.spec B2B).
test('konfigurátor: prihlásený VO/b2b vidí VEĽKOOBCHODNÚ cenu (< MO); interný vidí MO bez VO odznaku, nula console chýb (#318)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	page.on('dialog', (d) => d.accept()); // confirm() pri Zmazať

	const voUser = `e2e-vo-${Date.now().toString(36)}`;
	const voPass = 'e2eheslo1';

	// vyplň konfigurátor FIXNÝM rozmerom (LIGHT default, v katalógu) a spočítaj → cena s DPH (€ ako number)
	const spocitajCenu = async (): Promise<number> => {
		await goto(page, '/konfigurator');
		await page.getByTestId('sirka').fill('5000');
		await page.getByTestId('hlbka').fill('3000');
		await page.getByTestId('vyskaVpredu').fill('2800');
		await page.getByTestId('sklonDeg').fill('8');
		await page.getByTestId('zobrazit').click();
		await expect(page.getByTestId('cena-sdph')).toContainText('€');
		const txt = (await page.getByTestId('cena-sdph').innerText()).trim();
		// "4 452,06 €" → 4452.06
		return Number(txt.replace(/[^\d,]/g, '').replace(',', '.'));
	};
	const odhlas = async () => {
		await goto(page, '/zasklenia'); // nav s Odhlásiť je na authed stránke, nie na verejnom /konfigurator
		await page.getByRole('button', { name: 'Odhlásiť' }).click();
		await expect(page).toHaveURL(/\/login/);
	};

	// 1. interný vytvorí VO/b2b účet (rola defaultne B2B)
	await loginAs(page);
	await goto(page, '/pouzivatelia');
	await page.getByLabel('Prihlasovacie meno').fill(voUser);
	await page.getByLabel('Heslo (min. 6 znakov)').fill(voPass);
	await page.getByRole('button', { name: 'Pridať účet' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('vytvorený');

	// 2. INTERNÝ vidí MO — žiadny VO odznak (interný v zákazníckom konfigurátore = maloobchod)
	const moCena = await spocitajCenu();
	await expect(page.getByTestId('cena-hladina')).toHaveCount(0);
	expect(moCena).toBeGreaterThan(0);

	// 3. odhlásenie + prihlásenie ako VO/b2b účet
	await odhlas();
	await loginAs(page, voUser, voPass);

	// 4. VO/b2b vidí VEĽKOOBCHODNÚ cenu — odznak + cena NIŽŠIA než MO
	const voCena = await spocitajCenu();
	await expect(page.getByTestId('cena-hladina')).toBeVisible();
	await expect(page.getByTestId('cena-hladina')).toContainText(/ve[ľl]koobchod/i);
	expect(voCena).toBeGreaterThan(0);
	expect(voCena).toBeLessThan(moCena); // VO ≈ 65 % MO — reálne nižšia než maloobchod

	// 5. upratanie: odhlásenie VO, prihlásenie interný, zmazanie throwaway účtu
	await odhlas();
	await loginAs(page);
	await goto(page, '/pouzivatelia');
	const row = page.locator('tr', { hasText: voUser });
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: 'Zmazať' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('zmazaný');
	await expect(page.locator('tr', { hasText: voUser })).toHaveCount(0);
	expect(consoleMsgs).toEqual([]);
});
