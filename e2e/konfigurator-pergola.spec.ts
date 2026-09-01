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
import { goto, collectConsole, skipAkLive, loginAs, logout } from './helpers';
// #288 review 🔵: kanonický klasifikátor (Node kontext — helper beží mimo page.evaluate),
// aby sa regresný guard nerozišiel s `SOFTVEROVY_RENDERER_RE` pri jej budúcej zmene.
import { jeSoftverovyRenderer } from '../src/lib/vizual/kvalita';

// #327: prémiový EDGE-TO-EDGE 3D náhľad je ~2.5× ťažší na softvérovom CI WebGL (renderuje na
// veľkosť kontajnera, viď vizual3d.md „CI softvérový WebGL je pomalší"). Počkaj, kým je scéna
// READY, PRED interakciou s formulárom — inak (a) enhance callback (cena/súhrn/chyba) mešká za
// synchrónnou stavbou 3D scény na hlavnom vlákne a (b) debounced `{#key}` remount pretekáva s
// ešte-mountujúcou scénou → sankcionovaný teardown `forceContextLoss` sa zaloguje. Ten istý
// sync-point, aký už používajú 3D testy nižšie (`data-viz-ready`), aplikovaný na form-testy.
async function konfReady(page: import('@playwright/test').Page) {
	await goto(page, '/konfigurator/pergola');
	await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 20000 });
}

test('konfigurátor: verejný flow BEZ prihlásenia → súhrn + orientačná cena, žiadny Money kód/VO, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);

	// verejná route — žiadne prihlásenie; NESMIE presmerovať na /login
	await konfReady(page);
	await expect(page).toHaveURL(/\/konfigurator\/pergola$/);
	await expect(page.getByRole('heading', { name: /Navrhni si.*pergolu/i })).toBeVisible();

	await page.getByTestId('sirka').fill('5');
	await page.getByTestId('hlbka').fill('4');
	await page.getByTestId('vyskaVpredu').fill('3');
	await page.getByTestId('sklonDeg').fill('10');

	// vyber typ skla ZISTENÝ ZA BEHU ako NIE prvý v zozname (nova-stranka disciplína #3 —
	// aspoň jeden test vyberá non-default hodnotu, aby zachytil prípadný tichý revert).
	// #327: sklo je teraz CHIP (button `data-testid="sklo-chip"`). #329 časť 4: chip je ZÁKAZNÍCKA
	// KATEGÓRIA — jeho VIDITEĽNÝ label (napr. „Izolačné sklo — číre") ide do súhrnu, kým data-value
	// je KONKRÉTNY katalógový názov, ktorý sa POSTuje ďalej (pipeline).
	const skloChips = page.getByTestId('sklo-chip');
	const vybranaKategoria = (await skloChips.nth(2).innerText()).trim();
	const vybranyKatalog = (await skloChips.nth(2).getAttribute('data-value')) ?? '';
	expect(vybranaKategoria).not.toBe('');
	expect(vybranyKatalog).not.toBe('');
	await skloChips.nth(2).click();

	await page.getByTestId('zobrazit').click();

	const suhrn = page.getByTestId('suhrn');
	await expect(suhrn).toBeVisible();
	// dopočítané hodnoty (celé čísla — bez zaokrúhľovacej krehkosti)
	await expect(page.getByTestId('s-plocha')).toHaveText('20 m²'); // 5000·4000 mm = 20 m²
	await expect(page.getByTestId('s-svetla')).toHaveText('2810 mm'); // 3000 − 190 (nosník)
	await expect(page.getByTestId('s-sklon')).toContainText('10');
	// zvolená (non-default) kategória skla sa prejaví v súhrne ZÁKAZNÍCKYM labelom (bez hrúbky),
	// NIE interným katalógovým názvom (#329 časť 4: zákazník nikdy nevidí hrúbky na stránke)
	await expect(page.getByTestId('s-sklo')).toHaveText(vybranaKategoria);
	await expect(page.getByTestId('s-sklo')).not.toContainText(vybranyKatalog);
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
	await konfReady(page);

	// všetky polia v rámci individuálnych min/max (prejdú client validáciou), ale
	// dopočítaná výška pri stene presiahne max enginu → server vráti friendly chybu.
	// #329 časť 5: sklon max je teraz 10° — pri stene stále presiahne max (4000 + tan(10°)·6000 ≈ 5058).
	await page.getByTestId('sirka').fill('8');
	await page.getByTestId('hlbka').fill('6');
	await page.getByTestId('vyskaVpredu').fill('4');
	await page.getByTestId('sklonDeg').fill('10');
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

	await konfReady(page);
	await expect(page).toHaveURL(/\/konfigurator\/pergola$/);

	// 1) nakonfiguruj pergolu → zobraz súhrn
	await page.getByTestId('sirka').fill('4.5');
	await page.getByTestId('hlbka').fill('3.5');
	await page.getByTestId('vyskaVpredu').fill('2.8');
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

// #319: ZÁVÄZNÁ OBJEDNÁVKA (MO, neprihlásený). Súhrn → objednávková sekcia → kontakt + fakturačné
// údaje + súhlas → PDF na stiahnutie + potvrdenie. Zápisový tok (uloží objednávku) → proti LIVE
// prode preskočiť (skipAkLive), nech nepribúdajú testovacie objednávky. Money-neutrálne, nula console.
test('konfigurátor: objednávka (MO) — súhrn → záväzná objednávka → PDF na stiahnutie, nula console chýb', async ({
	page
}) => {
	await skipAkLive(page);
	const consoleMsgs = collectConsole(page);

	await konfReady(page);
	await page.getByTestId('sirka').fill('4.5');
	await page.getByTestId('hlbka').fill('3.5');
	await page.getByTestId('vyskaVpredu').fill('2.8');
	await page.getByTestId('sklonDeg').fill('8');
	await page.getByTestId('zobrazit').click();
	await expect(page.getByTestId('suhrn')).toBeVisible();
	await expect(page.getByTestId('cena-sdph')).toContainText('€');

	// objednávková sekcia (voliteľný krok „záväzne objednať")
	const objednavka = page.getByTestId('objednavka');
	await expect(objednavka).toBeVisible();
	await expect(objednavka.getByRole('heading', { name: /záväzne objednať/i })).toBeVisible();

	// kontakt — JASNE OZNAČENÁ testovacia objednávka (honeypot `firma_web` nechávame prázdny)
	await objednavka.getByLabel(/Meno a priezvisko/).fill('TEST E2E — ignorovať');
	await objednavka.getByLabel(/^E-mail/).fill('test-e2e@example.com');
	await objednavka.getByLabel(/Telefón/).fill('+421900000000');
	await objednavka.getByLabel(/Miesto stavby/).fill('83101 Bratislava');
	// fakturačné údaje
	await objednavka.getByLabel(/Meno alebo firma/).fill('TEST E2E s.r.o.');
	await objednavka.getByLabel(/Fakturačná adresa/).fill('Testovacia 1, 83101 Bratislava');
	await objednavka.getByLabel(/^IČO/).fill('12345678');
	await objednavka.getByLabel(/DIČ/).fill('SK1234567890');
	// súhlas s podmienkami je POVINNÝ — bez neho server objednávku odmietne
	await objednavka.getByTestId('objednavka-suhlas').check();

	const responsePromise = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('objednavka')
	);
	const downloadPromise = page.waitForEvent('download');
	await objednavka.getByTestId('objednavka-odoslat').click();

	const response = await responsePromise;
	expect(response.ok()).toBe(true);
	const download = await downloadPromise; // PDF špecifikácia objednávky sa reálne stiahla
	expect(download.suggestedFilename()).toMatch(/^Montalu-objednavka-\d{4}-\d{2}-\d{2}\.pdf$/);

	// potvrdenie úspechu (formulár nahradený poďakovaním)
	await expect(page.getByTestId('objednavka-ok')).toBeVisible();
	await expect(page.getByText('Ďakujeme! Objednávku sme prijali.')).toBeVisible();

	// ÚNIK GUARD: žiadny Money kód (TS###), nárez ani VEĽKOOBCHOD (VO) cena (MO objednávka)
	const telo = await page.locator('body').innerText();
	expect(telo).not.toMatch(/TS\d{3}/);
	expect(telo).not.toMatch(/nárez/i);
	expect(telo).not.toMatch(/priceB2B|ve[ľl]koobchod/i);

	expect(consoleMsgs).toEqual([]);
});

// #319 + #318: ZÁVÄZNÁ OBJEDNÁVKA prihláseného VEĽKOOBCHODNÉHO (b2b) zákazníka. b2b na verejnom
// konfigurátore vidí VO cenu (hladina sa odvodí server-side z účtu) A vie si záväzne objednať —
// objednaná cena sa zapečatí vrátane VO hladiny (overené unit testom). Účet sa vytvorí + zmaže cez
// /pouzivatelia (users tabuľka NIE JE Money → sankcionovaný live check, vzor #318). Zápisový tok →
// skipAkLive. Nula console chýb.
test('konfigurátor: objednávka (VO/b2b) — prihlásený veľkoobchod vidí VO cenu a záväzne objedná, nula console chýb (#319)', async ({
	page
}) => {
	await skipAkLive(page);
	const consoleMsgs = collectConsole(page);
	page.on('dialog', (d) => d.accept()); // confirm() pri Zmazať

	const voUser = `e2e-obj-vo-${Date.now().toString(36)}`;
	const voPass = 'e2eheslo1';

	const odhlas = async () => {
		await goto(page, '/zasklenia'); // nav s user menu je na authed stránke, nie na verejnom /konfigurator
		await logout(page);
	};

	// 1. interný vytvorí VO/b2b účet (rola defaultne B2B)
	await loginAs(page);
	await goto(page, '/pouzivatelia');
	await page.getByLabel('Prihlasovacie meno').fill(voUser);
	await page.getByLabel('Heslo (min. 6 znakov)').fill(voPass);
	await page.getByRole('button', { name: 'Pridať účet' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('vytvorený');

	// 2. prihlásenie ako VO/b2b + konfigurácia → VO cena + odznak
	await odhlas();
	await loginAs(page, voUser, voPass);
	await konfReady(page);
	await page.getByTestId('sirka').fill('5');
	await page.getByTestId('hlbka').fill('3');
	await page.getByTestId('vyskaVpredu').fill('2.8');
	await page.getByTestId('sklonDeg').fill('8');
	await page.getByTestId('zobrazit').click();
	await expect(page.getByTestId('suhrn')).toBeVisible();
	await expect(page.getByTestId('cena-hladina')).toBeVisible(); // VO odznak (b2b vidí veľkoobchod)
	await expect(page.getByTestId('cena-hladina')).toContainText(/ve[ľl]koobchod/i);

	// 3. VO/b2b vyplní záväznú objednávku
	const objednavka = page.getByTestId('objednavka');
	await objednavka.getByLabel(/Meno a priezvisko/).fill('TEST E2E VO — ignorovať');
	await objednavka.getByLabel(/^E-mail/).fill('test-e2e-vo@example.com');
	await objednavka.getByLabel(/Telefón/).fill('+421900000001');
	await objednavka.getByLabel(/Miesto stavby/).fill('01001 Žilina');
	await objednavka.getByLabel(/Meno alebo firma/).fill('VO Firma s.r.o.');
	await objednavka.getByLabel(/Fakturačná adresa/).fill('Priemyselná 5, 01001 Žilina');
	await objednavka.getByTestId('objednavka-suhlas').check();

	const responsePromise = page.waitForResponse(
		(r) => r.request().method() === 'POST' && r.url().includes('objednavka')
	);
	const downloadPromise = page.waitForEvent('download');
	await objednavka.getByTestId('objednavka-odoslat').click();
	const response = await responsePromise;
	expect(response.ok()).toBe(true);
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/^Montalu-objednavka-\d{4}-\d{2}-\d{2}\.pdf$/);
	await expect(page.getByTestId('objednavka-ok')).toBeVisible();

	// 4. upratanie: odhlásenie VO, prihlásenie interný, zmazanie throwaway účtu
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

// #279 Fáza C: cenová vrstva vo verejnom konfigurátore — výber modelu mení orientačnú cenu,
// mimo katalógu → „cena na vyžiadanie". Display-only (žiadny zápis) → beží aj proti nasadenej
// appke (BASE_URL), bez skipAkLive.
test('konfigurátor: cena — výber modelu mení cenu, mimo katalógu → individuálna ponuka, nula console chýb', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await konfReady(page);

	// 1) konfigurácia s modelom LIGHT (3,0 × 5,0 m) → orientačná cena (€) + porovnanie 3 modelov
	await page.getByTestId('sirka').fill('5');
	await page.getByTestId('hlbka').fill('3');
	await page.getByTestId('vyskaVpredu').fill('2.5');
	await page.getByTestId('sklonDeg').fill('6');
	await page.getByTestId('model-LIGHT').click();
	await page.getByTestId('zobrazit').click();

	await expect(page.getByTestId('cena')).toBeVisible();
	await expect(page.getByTestId('cena-sdph')).toContainText('€');
	const lightCena = (await page.getByTestId('cena-sdph').innerText()).trim();

	// porovnanie ukazuje všetky 3 modely (zrkadlo montalu.sk „ceny vedľa seba")
	await expect(page.getByTestId('porovnanie-LIGHT')).toBeVisible();
	await expect(page.getByTestId('porovnanie-ROBUST')).toBeVisible();
	await expect(page.getByTestId('porovnanie-MASSIVE')).toBeVisible();

	// 2) prepni na ROBUST → orientačná cena sa ZMENÍ (ROBUST je drahší než LIGHT)
	await page.getByTestId('model-ROBUST').click();
	await page.getByTestId('zobrazit').click();
	await expect(page.getByTestId('s-model')).toHaveText('ROBUST');
	await expect(page.getByTestId('cena-sdph')).toContainText('€');
	const robustCena = (await page.getByTestId('cena-sdph').innerText()).trim();
	expect(robustCena).not.toBe(lightCena);

	// 3) LIGHT nad hĺbku 4 m (5000 mm) → mimo katalógu → „cena na vyžiadanie" (individuálna)
	await page.getByTestId('model-LIGHT').click();
	await page.getByTestId('hlbka').fill('5');
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
	await page.getByTestId('sirka').fill('5');
	await page.getByTestId('hlbka').fill('3.8');
	await page.getByTestId('vyskaVpredu').fill('2.8');
	await page.getByTestId('sklonDeg').fill('8');
	// non-default sklo (mliečne → matný odtieň) + non-default RAL, nech 3D dostane reálny vstup.
	// #327: sklo = chip, farba = kruhový swatch (nie <select>) — klik na prvok s daným data-value.
	await page.locator('[data-testid="sklo-chip"][data-value="4.4.2 mliečne"]').click();
	await page.locator('[data-testid="farba-swatch"][data-value="9005"]').click();
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

test('konfigurátor: 3D náhľad je viditeľný HNEĎ pri načítaní + živý update (desktop, mid tier), nula console chýb, žiaden únik (#325)', async ({
	page
}) => {
	test.setTimeout(60000); // softvérový WebGL v CI je pomalší (lazy import + stavba scény + HDRI)
	const consoleMsgs = collectConsole(page);

	await goto(page, '/konfigurator/pergola?viz=mid');
	await expect(page).toHaveURL(/\/konfigurator\/pergola/);

	// #325 split-screen: 3D náhľad (defaultná pergola) je viditeľný HNEĎ, BEZ submitu —
	// invertuje pôvodný #276 lazy-lock (náhľad bol až po submite). Lazy import three.js
	// beží v onMount → komponent je namountovaný pri načítaní stránky.
	await expect(page.getByTestId('konf-viz')).toBeVisible();
	await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 20000 });
	await expect(page.getByTestId('vizual3d-canvas')).toBeVisible();
	// práve JEDEN WebGL kontext (žiaden leak)
	expect(
		await page.evaluate(() => (window as { __VIZ_CONTEXTS?: number }).__VIZ_CONTEXTS ?? null)
	).toBe(1);

	const box = await page.getByTestId('vizual3d-canvas').boundingBox();
	expect(box).not.toBeNull();
	expect(box!.width).toBeGreaterThan(50);
	expect(box!.height).toBeGreaterThan(50);
	// netriviálny obsah (nie prázdny/jednofarebný canvas)
	expect(await velkostCanvasPng(page)).toBeGreaterThan(5000);

	// ŽIVÝ UPDATE (#325): zmena rozmerov vo formulári sa prejaví v 3D BEZ submitu.
	// #361: čakáme na DETERMINISTICKÝ, od GL-frame ODPOJENÝ stavový signál `data-viz-rozmer`
	// na STABILNOM `konf-viz` uzle (mimo `{#key vizKluc}` bloku) — odráža APLIKOVANÉ (debounced)
	// rozmery kŕmené do 3D. Nahrádza krehký fixný 6 s text-diff poll: ten na softvérovom CI
	// WebGL súperil o jediné hlavné vlákno s `forceContextLoss`+scene-rebuildom keyed remountu
	// a pod záťažou main behov občas vyhladovel `expect.poll` nad 6 s (issue #361). Namiesto
	// „hocijaká zmena" čakáme na PRESNÚ očakávanú hodnotu s veľkorysým budgetom (v rámci
	// `test.setTimeout(60000)`) — deterministický dôkaz „form-state → 3D tečie naživo".
	const captionRozmer = page.getByTestId('pergola-caption-rozmer');
	await vyplnFormular(page); // sirka 5000, hlbka 3800, sklo mliečne, RAL 9005
	await expect(page.getByTestId('konf-viz')).toHaveAttribute('data-viz-rozmer', '5000×3800', {
		timeout: 30000
	});
	// caption (vo VizualPergolaZakaznik) tiež ukáže nové rozmery — deterministická PRESNÁ hodnota
	await expect(captionRozmer).toHaveText('Pergola 5000 × 3800 mm', { timeout: 15000 });

	// 3D ostáva zdravý po živých zmenách — stále JEDEN kontext, netriviálny render
	await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 20000 });
	await expect(page.getByTestId('vizual3d-canvas')).toBeVisible();
	await expect
		.poll(
			async () =>
				await page.evaluate(() => (window as { __VIZ_CONTEXTS?: number }).__VIZ_CONTEXTS ?? null),
			{ timeout: 8000 }
		)
		.toBe(1);
	expect(await velkostCanvasPng(page)).toBeGreaterThan(5000);

	// #288: post-processing gate (mid tier) — na softvérovom CI rendereri VYPNUTÝ (#290)
	await overPostprocGate(page);

	// submit → cena/súhrn v pravom paneli (3D vľavo stále žije). ÚNIK GUARD platí aj tu:
	// cena SMIE byť (owner ROZHODNUTÉ), zakázaný je Money kód (TS###)/nárez/VEĽKOOBCHOD (VO).
	await page.getByTestId('zobrazit').click();
	await expect(page.getByTestId('suhrn')).toBeVisible();
	await expect(page.getByTestId('cena-sdph')).toContainText('€');
	await expect(page.getByTestId('konf-viz')).toBeVisible(); // 3D ostáva viditeľný po submite

	const telo = await page.locator('body').innerText();
	expect(telo).not.toMatch(/TS\d{3}/);
	expect(telo).not.toMatch(/nárez/i);
	expect(telo).not.toMatch(/priceB2B|ve[ľl]koobchod/i);

	expect(consoleMsgs).toEqual([]);
});

// #329 REGRESSION (RED pred fixom): zmena LEN farby (RAL) / LEN skla — BEZ zmeny rozmeru (žiadny
// {#key} remount) — MUSÍ skutočne prekresliť 3D scénu, nie len caption. Root cause: prekresliRAL/
// prekresliSklo efekty vo Vizual3D mali `if (!ziva) return` PRED čítaním ralKod/skloVzhlad → prvý
// beh efektu (ziva===null, kým beží async stavba scény) sa vrátil pred čítaním reaktívneho vstupu
// → Svelte 5 efekt nezaregistroval závislosť → mŕtvy efekt → materiál sa pri neskoršej zmene
// nezmutoval. `data-viz-ral-applied`/`data-viz-sklo-applied` je ČESTNÝ signál skutočného
// prekreslenia (zapísaný LEN v prekresliRAL/prekresliSklo, kde sa materiál naozaj mutuje), nie
// prop-pass ako `data-viz-ral`. Owner (29.8.): „ked vyberiem farbu nic sa nestane, ked skla tiež".
test('konfigurátor: zmena LEN farby a LEN skla naozaj prekreslí 3D (nie len caption), nula console chýb (#329)', async ({
	page
}) => {
	test.setTimeout(60000);
	const consoleMsgs = collectConsole(page);

	await goto(page, '/konfigurator/pergola?viz=mid');
	await expect(page.locator('[data-viz-ready="true"]')).toBeVisible({ timeout: 20000 });
	const viz = page.getByTestId('vizual3d');

	// baseline applied atribút (nastavený pri stavbe scény z počiatočného RAL)
	await expect(viz).toHaveAttribute('data-viz-ral-applied', /.+/, { timeout: 20000 });
	const ralPred = (await viz.getAttribute('data-viz-ral-applied')) ?? '';
	expect(ralPred).not.toBe('');

	// --- LEN FARBA: klik na swatch s INÝM RAL kódom, BEZ zmeny rozmeru (žiadny remount) ---
	const swatche = page.getByTestId('farba-swatch');
	const pocetSwatchov = await swatche.count();
	let inaFarba = '';
	for (let i = 0; i < pocetSwatchov; i++) {
		const kod = await swatche.nth(i).getAttribute('data-value');
		if (kod && kod !== ralPred) {
			inaFarba = kod;
			break;
		}
	}
	expect(inaFarba).not.toBe('');
	await page.locator(`[data-testid="farba-swatch"][data-value="${inaFarba}"]`).click();
	// 3D sa MUSÍ prekresliť na novú farbu — na buggy kóde ostane starý applied → RED
	await expect(viz).toHaveAttribute('data-viz-ral-applied', inaFarba, { timeout: 6000 });

	// --- LEN SKLO: číre → mliečne (rôzne vizuálne rodiny cire/matne), BEZ zmeny rozmeru ---
	await page.locator('[data-testid="sklo-chip"][data-value="4.4.2 číre"]').click();
	await expect(viz).toHaveAttribute('data-viz-sklo-applied', /.+/, { timeout: 6000 });
	const skloPred = (await viz.getAttribute('data-viz-sklo-applied')) ?? '';
	await page.locator('[data-testid="sklo-chip"][data-value="4.4.2 mliečne"]').click();
	// applied signál skla sa MUSÍ zmeniť (mliečne = iná vizuálna rodina) — RED na buggy kóde
	await expect(viz).not.toHaveAttribute('data-viz-sklo-applied', skloPred, { timeout: 6000 });

	// zmena farby/skla NEROBÍ remount → stále práve JEDEN WebGL kontext (žiaden leak)
	expect(
		await page.evaluate(() => (window as { __VIZ_CONTEXTS?: number }).__VIZ_CONTEXTS ?? null)
	).toBe(1);

	expect(consoleMsgs).toEqual([]);
});

// #329 časti 3/4/5: zákaznícke kategórie skla (6, bez hrúbky), info karty (fotka + text) na
// modeloch aj skle, a realistický sklon (max 10°, default 3°). Display-only, beží aj proti
// nasadeniu (bez skipAkLive).
test('konfigurátor: zákaznícke kategórie skla + info karty + realistický sklon, nula console chýb (#329)', async ({
	page
}) => {
	test.setTimeout(60000); // 3D náhľad je na CI softvérovom WebGL ťažší (#327 timing)
	const consoleMsgs = collectConsole(page);
	await konfReady(page); // goto + počkaj na [data-viz-ready] pred interakciou s formulárom
	await expect(page).toHaveURL(/\/konfigurator\/pergola$/);

	// (4) presne 6 kategórií skla, žiadny label neodhaľuje hrúbku (4.4.2 / -8-6 / mm)
	const skloChips = page.getByTestId('sklo-chip');
	await expect(skloChips).toHaveCount(6);
	const pocetSkla = await skloChips.count();
	for (let i = 0; i < pocetSkla; i++) {
		const label = (await skloChips.nth(i).innerText()).trim();
		expect(label, `label chipu odhaľuje hrúbku: ${label}`).not.toMatch(/\d\.\d\.\d|-\d+-\d+|mm/);
	}

	// (5) sklon: max 10°, default 3° (číselný twin nesie name+testid)
	const sklonInput = page.getByTestId('sklonDeg');
	await expect(sklonInput).toHaveAttribute('max', '10');
	await expect(sklonInput).toHaveValue('3');

	// (3) info karty: modely aj sklo majú ⓘ tlačidlo; tap ho rozbalí (mobil-safe vzor,
	// neblokuje výber). Karta je v DOM skrytá, po tape má triedu `otvorene`.
	const infoBtn = page.getByTestId('konf-info-btn');
	// 3 modely + 6 skiel = 9 info tlačidiel
	await expect(infoBtn).toHaveCount(9);
	const infoKarta = page.getByTestId('konf-info-karta');
	// tapni ⓘ NEvybraného modelu ROBUST (nth(1)) — default je LIGHT
	await expect(page.getByTestId('model-LIGHT')).toHaveClass(/vybrany/);
	await expect(page.getByTestId('model-ROBUST')).not.toHaveClass(/vybrany/);
	await expect(infoKarta.nth(1)).not.toHaveClass(/otvorene/);
	await infoBtn.nth(1).click();
	await expect(infoKarta.nth(1)).toHaveClass(/otvorene/);
	// tap na ⓘ ROBUST-u NEVYBRAL model ROBUST (karta je len informačná, nezmení výber)
	await expect(page.getByTestId('model-ROBUST')).not.toHaveClass(/vybrany/);
	await expect(page.getByTestId('model-LIGHT')).toHaveClass(/vybrany/);
	// Escape zatvorí kartu (dismissible)
	await page.keyboard.press('Escape');
	await expect(infoKarta.nth(1)).not.toHaveClass(/otvorene/);

	// (4) výber kategórie POSTuje KONKRÉTNY katalógový názov ďalej: klik na „Izolačné sklo —
	// mliečne" (data-value = katalógový názov s hrúbkou, skrytý v atribúte) → súhrn ukáže
	// ZÁKAZNÍCKY label, telo stránky NEUKÁŽE Money kód.
	const mliecnyChip = page.locator('[data-testid="sklo-chip"][data-value="IZO 4.4.2-8-6 mliečne"]');
	await expect(mliecnyChip).toHaveText('Izolačné sklo — mliečne');
	await mliecnyChip.click();
	await page.getByTestId('zobrazit').click();
	await expect(page.getByTestId('s-sklo')).toHaveText('Izolačné sklo — mliečne');

	// ÚNIK GUARD: žiadny Money kód (TS###) / nárez / VO na verejnej ploche
	const telo = await page.locator('body').innerText();
	expect(telo).not.toMatch(/TS\d{3}/);
	expect(telo).not.toMatch(/nárez/i);
	expect(telo).not.toMatch(/priceB2B|ve[ľl]koobchod/i);

	expect(consoleMsgs).toEqual([]);
});

// #329 info karta sa zmestí do viewportu a Escape ju zavrie: karta bola ukotvená stredom nad
// triggerom (`left:50%` + translateX(-50%)) → pri triggeri blízko pravého okraja panela
// bounding box presiahol viewport (desktop aj mobil). Fix ukotvil kartu PRAVÝM okrajom na
// trigger — over, že sa vždy zmestí, na desktope aj mobile viewporte, a že Escape zatvorí
// otvorenú (tap) kartu.
test('konfigurátor: info karta sa zmestí do viewportu a Escape ju zavrie (#329)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await konfReady(page);

	const trigger = page.locator('button[aria-label="Viac o: Pergola MASSIVE"]');
	await trigger.click();
	const karta = page.locator('[data-testid="konf-info-karta"].otvorene');

	// desktop: otvorená karta ostáva CELÁ vo viewporte (žiaden presah cez pravý okraj)
	const viewportDesktop = page.viewportSize();
	expect(viewportDesktop).not.toBeNull();
	let box = await karta.boundingBox();
	expect(box).not.toBeNull();
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(viewportDesktop!.width);

	// mobil 390×844: znova otvor a over rovnaké ohraničenie
	await page.setViewportSize({ width: 390, height: 844 });
	await trigger.click(); // zavrie predchádzajúce otvorenie (toggle)
	await trigger.click(); // znova otvorí na novom viewporte
	box = await karta.boundingBox();
	expect(box).not.toBeNull();
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(390);

	// Escape zatvorí otvorenú (tap) kartu — žiadna info-karta ostáva viditeľná
	await page.keyboard.press('Escape');
	const infoKarty = page.getByTestId('konf-info-karta');
	const pocet = await infoKarty.count();
	for (let i = 0; i < pocet; i++) {
		await expect(infoKarty.nth(i)).not.toHaveClass(/otvorene/);
	}

	expect(consoleMsgs).toEqual([]);
});

test('konfigurátor: 3D náhľad viditeľný HNEĎ na MOBILNOM viewporte 390×844 (low tier fallback), nula console chýb (#325)', async ({
	page
}) => {
	test.setTimeout(60000);
	const consoleMsgs = collectConsole(page);
	await page.setViewportSize({ width: 390, height: 844 });

	await goto(page, '/konfigurator/pergola?viz=low');
	// #325 mobil-first: vizuál hore, viditeľný HNEĎ pri načítaní (bez submitu)
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
		await konfReady(page);
		await page.getByTestId('sirka').fill('5');
		await page.getByTestId('hlbka').fill('3');
		await page.getByTestId('vyskaVpredu').fill('2.8');
		await page.getByTestId('sklonDeg').fill('8');
		await page.getByTestId('zobrazit').click();
		await expect(page.getByTestId('cena-sdph')).toContainText('€');
		const txt = (await page.getByTestId('cena-sdph').innerText()).trim();
		// "4 452,06 €" → 4452.06
		return Number(txt.replace(/[^\d,]/g, '').replace(',', '.'));
	};
	const odhlas = async () => {
		await goto(page, '/zasklenia'); // nav s user menu je na authed stránke, nie na verejnom /konfigurator
		await logout(page);
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

// #327: PRÉMIOVÝ redizajn (Tesla/Apple showroom) — split-screen 3D edge-to-edge, prémiové
// ovládanie (RAL swatche + sklo chips + segmentové karty modelu) NAMIESTO defaultných
// <select>/radio, prilepený cenový panel. Display-only (žiadny zápis) → beží aj proti
// nasadenej appke (BASE_URL), bez skipAkLive. Nula console chýb.
test('konfigurátor: prémiový redizajn — split-screen + swatche/chips namiesto <select> + sticky cena, nula console chýb (#327)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await konfReady(page);

	// split-screen: 3D náhľad je viditeľný HNEĎ (ľavý stĺpec, bez submitu)
	await expect(page.getByTestId('konf-viz')).toBeVisible();

	// prémiové ovládanie NAMIESTO defaultných <select> — žiadny <select> pre sklo/farbu
	expect(await page.locator('select[name="sklo"]').count()).toBe(0);
	expect(await page.locator('select[name="farba"]').count()).toBe(0);

	// kruhové RAL swatche + sklo chips existujú (a je ich viac než jeden)
	expect(await page.getByTestId('farba-swatch').count()).toBeGreaterThan(1);
	expect(await page.getByTestId('sklo-chip').count()).toBeGreaterThan(1);

	// segmentové karty modelu (nie <select>)
	await expect(page.getByTestId('model-ROBUST')).toBeVisible();

	// #327 review 🔴 REGRESIA: popisok rozmeru je <label for> → klik naň FOKUSUJE input, NEMENÍ
	// hodnotu. (Starý <label>-obal sa viazal na prvý potomok = mínus tlačidlo → klik na text
	// znižoval hodnotu a cez stale-clear mazal cenu.) #333: hodnota je v METROCH (4,2 m);
	// regex znáša bodku (rozpísaný stav) aj čiarku (znormalizovaný po blure).
	await page.getByTestId('sirka').fill('4.2');
	await page.getByText('Šírka', { exact: true }).click();
	await expect(page.getByTestId('sirka')).toHaveValue(/^4[.,]2$/);

	// klik na swatch vyberie farbu (aria-pressed prejde na true)
	const swatch9005 = page.locator('[data-testid="farba-swatch"][data-value="9005"]');
	await swatch9005.click();
	await expect(swatch9005).toHaveAttribute('aria-pressed', 'true');

	// vyplň + submit (sklonDeg cez číselný „twin" — .fill() funguje aj so sliderom)
	await page.getByTestId('sirka').fill('5');
	await page.getByTestId('hlbka').fill('3');
	await page.getByTestId('vyskaVpredu').fill('2.5');
	await page.getByTestId('sklonDeg').fill('6');
	await page.getByTestId('zobrazit').click();
	await expect(page.getByTestId('suhrn')).toBeVisible();

	// prilepený cenový panel ukáže orientačnú cenu s DPH
	await expect(page.getByTestId('cta-cena')).toContainText('€');
	await expect(page.getByTestId('cta-cena')).toContainText(/Orientačná cena od/i);

	// minimal chrome: žiadna interná admin navigácia na verejnej stránke
	expect(await page.locator('nav.top').count()).toBe(0);

	expect(consoleMsgs).toEqual([]);
});

// #327: prihlásený interný/b2b user NEVIDÍ internú admin navigáciu na zákazníckej stránke
// /konfigurator (bola tam pred redizajnom) — dostane len decentný „← interná aplikácia"
// odkaz. Login je read-only (žiadny Money zápis) → beží aj proti prode. Nula console chýb.
test('konfigurátor: prihlásený user NEVIDÍ admin navigáciu, len „← interná aplikácia" + pätička s verziou (#327)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await konfReady(page);

	// žiadna interná admin navigácia (Optimalizátor/Používatelia/…) na zákazníckej stránke
	expect(await page.locator('nav.top').count()).toBe(0);
	await expect(page.getByRole('link', { name: 'Optimalizátor' })).toHaveCount(0);

	// len decentný odkaz späť do internej aplikácie
	await expect(page.getByRole('link', { name: /interná aplikácia/i })).toBeVisible();

	// pätička s verziou ostáva — práve JEDNA na stránke (version-on-dashboard)
	await expect(page.getByTestId('version')).toHaveCount(1);
	await expect(page.getByTestId('version')).toHaveText(
		/^v\d+\.\d+\.\d+(-dev\.\d+)?(\s\([0-9a-f]{7}\))?$/
	);

	expect(consoleMsgs).toEqual([]);
});

// #333: rozmery v METROCH (owner „plus nech pridáva v metroch"), wrap-proof stepper
// (owner bug: `+` sa zalamoval nad číslo na úzkom viewporte) a viditeľná výzva OTÁČAŤ.
// Verejná route, žiadny Money zápis → beží aj proti prode. Nula console chýb.
test('konfigurátor: rozmery v metroch — stepper krok 0,5/0,1 m, žiadne zalomenie na 360 px, výzva otáčať (#333)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await konfReady(page);

	const sirka = page.getByTestId('sirka');
	// hodnota sa zobrazuje v METROCH s čiarkou (1 desatinné), nie v mm
	await expect(sirka).toHaveValue(/^\d+,\d$/);

	// stepper: šírka krok 0,5 m (+ pridá, − odoberie); interne ostáva mm (POST cez skrytý input)
	await sirka.fill('4');
	await sirka.blur();
	await expect(sirka).toHaveValue('4,0');
	await page.getByLabel('Zväčšiť šírku').click();
	await expect(sirka).toHaveValue('4,5');
	await page.getByLabel('Zmenšiť šírku').click();
	await expect(sirka).toHaveValue('4,0');

	// výška krok 0,1 m (rozsah 2–4 m, celý meter by bol nepoužiteľný)
	const vyska = page.getByTestId('vyskaVpredu');
	await vyska.fill('2.5');
	await vyska.blur();
	await expect(vyska).toHaveValue('2,5');
	await page.getByLabel('Zväčšiť výšku').click();
	await expect(vyska).toHaveValue('2,6');

	// ÚZKY viewport (~360 px): stepper − [hodnota] + NIKDY nezalomí `+` nad číslo — všetky tri
	// prvky (−, input, +) majú zhodný vertikálny stred = jeden riadok (owner-reportovaný bug).
	await page.setViewportSize({ width: 360, height: 800 });
	await sirka.scrollIntoViewIfNeeded();
	const [bMinus, bInput, bPlus] = await Promise.all([
		page.getByLabel('Zmenšiť šírku').boundingBox(),
		sirka.boundingBox(),
		page.getByLabel('Zväčšiť šírku').boundingBox()
	]);
	expect(bMinus).not.toBeNull();
	expect(bInput).not.toBeNull();
	expect(bPlus).not.toBeNull();
	const stred = (b: { y: number; height: number }) => b.y + b.height / 2;
	expect(Math.abs(stred(bMinus!) - stred(bInput!))).toBeLessThan(6);
	expect(Math.abs(stred(bPlus!) - stred(bInput!))).toBeLessThan(6);

	// viditeľná výzva na otáčanie (desktop AJ mobil) s textom
	const hint = page.getByTestId('vizual3d-dotyk-overlay');
	await expect(hint).toBeVisible();
	await expect(hint).toContainText('Potiahnite a otáčajte');

	expect(consoleMsgs).toEqual([]);
});
