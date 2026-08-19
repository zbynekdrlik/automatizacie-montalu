// Pergola — UI prehľadnosť (#222): jasná voľba režimu na /pergola + čitateľný
// stav výstupu na /pergola/narez (zhrnutie spočítané/čaká + per-riadkové stavové
// odznaky). Všetko ČÍTACIE — nič sa nezapisuje do Money, dá sa pustiť aj proti
// nasadenej appke (BASE_URL). Akceptácia = bežný používateľ rozozná režimy a stav
// bez vysvetľovania. Zero console errors (browser-console-zero-errors).
import { test, expect } from '@playwright/test';
import { goto, loginAs, collectConsole, waitHydrated } from './helpers';

test('rozcestník /pergola: tri režimy s popismi, aktívny CAD, funkčné odkazy', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola');

	// rozcestník je viditeľný a nesie práve tri režimy s názvami
	const rezimy = page.getByTestId('pergola-rezimy');
	await expect(rezimy).toBeVisible();
	await expect(rezimy).toContainText('CAD nárez → Money odpis');
	await expect(rezimy).toContainText('Rezervačný odpis');
	await expect(rezimy).toContainText('Návrhový výkres');

	// každý režim má jednovetový popis „kedy použiť" (nie len holý názov)
	await expect(rezimy).toContainText('Máš hotový CAD nárez');
	await expect(rezimy).toContainText('Ešte nemáš CAD');
	await expect(rezimy).toContainText('Pekný technický výkres pre zákazníka');

	// aktuálny režim (CAD) je vizuálne označený ako aktívny
	await expect(page.getByTestId('rezim-cad')).toHaveClass(/active/);

	// CAD formulár ostáva hneď pod rozcestníkom (rýchly tok interných nedotknutý)
	await expect(page.getByLabel('Materiál (CAD nárez) *')).toBeVisible();

	// odkaz na rezervačný odpis funguje
	await expect(page.getByTestId('link-narez')).toBeVisible();
	await page.getByTestId('link-narez').click();
	await waitHydrated(page);
	await expect(page).toHaveURL(/\/pergola\/narez$/);
	await expect(page.getByRole('heading', { name: 'Rezervačný odpis — pergola' })).toBeVisible();

	// späť na /pergola a odkaz na návrhový výkres funguje
	await goto(page, '/pergola');
	await expect(page.getByTestId('link-navrh')).toBeVisible();
	await page.getByTestId('link-navrh').click();
	await waitHydrated(page);
	await expect(page).toHaveURL(/\/pergola\/navrh$/);
	await expect(page.getByRole('heading', { name: 'Pergola — návrhový výkres' })).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

test('výstup narezu: stavové zhrnutie (spočítané/čaká) + per-riadkové odznaky + odznaky sekcií', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	// štandardná pergola z callu: Robust, na stenu, 4 nohy
	await page.locator('#system').selectOption('Robust');
	await page.locator('#sirka').fill('5000');
	await page.locator('#hlbka').fill('3500');
	await page.locator('#pocetPrednychNoh').fill('4');
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// zjednotený nadpis (žiadne staré „Materiál/nárez")
	const nadpis = page.getByTestId('narez-nadpis');
	await expect(nadpis).toContainText('Rezervačný odpis');
	await expect(nadpis).toContainText('Robust');

	// stavové zhrnutie navrchu: dve čísla — spočítané a čaká
	const stav = page.getByTestId('narez-stav');
	await expect(stav).toBeVisible();
	await expect(stav).toContainText('Spočítané');
	await expect(stav).toContainText('Čaká na vzorec');

	// spočítané je kladné (Robust 5000/4 nohy dá potvrdené položky), čaká nezáporné
	const spocitane = Number((await page.getByTestId('stav-spocitane').textContent())?.trim());
	const caka = Number((await page.getByTestId('stav-caka').textContent())?.trim());
	expect(Number.isFinite(spocitane)).toBe(true);
	expect(spocitane).toBeGreaterThan(0);
	expect(Number.isFinite(caka)).toBe(true);
	expect(caka).toBeGreaterThanOrEqual(0);

	// tabuľka Materiál má stavový stĺpec s per-riadkovými odznakmi (✅ v odpise / ⏳ čaká)
	const tab = page.getByTestId('narez-tabulka');
	await expect(tab.locator('thead')).toContainText('Stav');
	// priečka (18004) má neistú dĺžku (HH krovu) → ⏳ čaká; noha (18013) je spočítaná → ✅ v odpise
	// (kód môže mať viac riadkov — .first() proti strict-mode)
	await expect(page.getByTestId('polozka-18004').first()).toContainText('⏳ čaká');
	await expect(page.getByTestId('polozka-18013').first()).toContainText('✅ v odpise');

	// odznaky na sekciách: Materiál ✅ spočítané, Komponenty ⏳ len typy, nepodporované ⏳
	await expect(page.locator('.sec', { hasText: 'Materiál' })).toContainText('spočítané');
	await expect(page.locator('.sec', { hasText: 'Komponenty' })).toContainText('zatiaľ len typy');
	await expect(page.locator('.sec', { hasText: 'Zatiaľ nepodporované' })).toContainText('⏳');

	expect(consoleMsgs).toEqual([]);
});

// #233 — akceptačné kritérium: na obrazovkách pergoly NIE JE ani jedno „#N", „O-čko"
// (interné question ID typu O2/O5) ani odkaz na call. Skenuje CELÝ textový obsah stránky
// (aj zbalené <details>, ktoré textContent vracia) na plnom výsledku vrátane krovu,
// zosilneného nosníka a Robust výstuhy (najviac nepodporovaných položiek). ČÍTACIE.
test('#233 žiadny interný žargón (#N / O-čko / call) na obrazovke rezervačného odpisu', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/narez');

	// Massive + zosilnený nosník + sklon (krov) — čo najviac textu s poznámkami/nepodporované
	await page.locator('#system').selectOption('Massive');
	await page.locator('#sirka').fill('5760');
	await page.locator('#hlbka').fill('3500');
	await page.locator('#pocetPrednychNoh').fill('4');
	await page.locator('#sklonStrechy').fill('8'); // krov uloženie (potvrdené)
	await page.locator('#zosilnenyNosnik').check();
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// výsledok sa vykreslil (výkres, materiál, krov, nepodporované sú v DOM)
	await expect(page.getByTestId('narez-nepodporovane')).toBeVisible();
	await expect(page.getByTestId('narez-tabulka')).toBeVisible();

	// CELÝ text stránky — textContent zahŕňa aj zbalené <details>, takže žargón sa
	// neschová do rozklikávacieho detailu
	const text = (await page.locator('body').textContent()) ?? '';
	expect(text.length).toBeGreaterThan(0);
	// žiadne „#161"/„#206"/… (ticket ref)
	expect(text).not.toMatch(/#\d/);
	// žiadne interné question ID „O5"/„O2"/„O11"… (O + číslica; „OP260282" má za O písmeno)
	expect(text).not.toMatch(/\bO\d/);
	// žiadny odkaz na call
	expect(text).not.toMatch(/z callu|callu 13|call s Dominikom/i);

	// pozitívny protipól — plain náhrady SÚ prítomné (sekcia nepodporované nie je prázdna)
	await expect(page.getByTestId('narez-nepodporovane')).toContainText('vzorec');

	expect(consoleMsgs).toEqual([]);
});
