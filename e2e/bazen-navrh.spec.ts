// Bazén — zákaznícky návrhový výkres, FÁZA 1 (#139, architektúra 1:1 podľa
// pergoly #138/#144/#150/#153 a zaskleniam #162). Všetko ČÍTACIE — modul do
// Money nič nezapisuje, takže sa dá pustiť aj proti nasadenej appke (BASE_URL).
import { test, expect, type Page } from '@playwright/test';
import { goto, loginAs, collectConsole, waitHydrated } from './helpers';

/** Rovnaká rekurzívna @page-detekcia ako v pergola-navrh.spec.ts/zasklenia-navrh.spec.ts
 *  (#137) — @page je vnorený v @media print bloku, plochý prechod cssRules ho nenájde. */
async function najdiPageSizes(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const out: string[] = [];
		const walk = (rules: CSSRuleList) => {
			for (const rule of Array.from(rules)) {
				if (rule instanceof CSSPageRule) out.push(rule.style.getPropertyValue('size').trim());
				else if (rule instanceof CSSMediaRule) walk(rule.cssRules);
			}
		};
		for (const sheet of Array.from(document.styleSheets)) {
			try {
				walk(sheet.cssRules);
			} catch {
				continue;
			}
		}
		return out;
	});
}

// vektor OP260055 (8570×4250×750, PREMIER S4, koľajisko 11100mm) — presné kóty
// z reálneho vzoru, viď design komentár na #139.
async function vyplnFormularOP260055(page: Page) {
	await goto(page, '/bazen/navrh');
	await waitHydrated(page);
	await page.getByLabel('Zatvorená dĺžka (mm) *').fill('8570');
	await page.getByLabel('Hĺbka (mm) *').fill('4250');
	await page.getByLabel('Dĺžka koľajiska (mm) *').fill('11100');
	await page.getByLabel('Výška najvyššej sekcie (mm) *').fill('750');
	await page.getByLabel('Výška najnižšej sekcie (mm) *').fill('480');
	await page.getByLabel('Počet sekcií *').fill('4');
	// "Koľaj" je substring "Dĺžka koľajiska" — musí byť exact (testing skill gotcha)
	await page.getByLabel('Koľaj', { exact: true }).selectOption('jednokolaj');
	await page.getByLabel('Smer posuvu').selectOption('vpravo');
	await page.getByLabel('Smer dverí').selectOption('vlavo');
	await page.getByLabel('Výška čela (mm) *').fill('96.2');
	await page.getByLabel('Model (voliteľné)').fill('PREMIER');
}

test('vyplnenie formulára (OP260055) nakreslí bokorys/pôdorys s presnými kótami, zero console errors', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await vyplnFormularOP260055(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('form-error')).toHaveCount(0);
	await expect(page.getByTestId('bn-bokorys')).toBeVisible();
	await expect(page.getByTestId('bn-podorys')).toBeVisible();

	// zatvorená dĺžka (8570), dĺžka koľajiska (11100) a presah (2530 = 11100-8570)
	// — presná zhoda, nie substring (aby "8570" nekolidovalo so "18570" a pod.).
	// "8570" je v BOKORYSE aj v PÔDORYSE (obe majú vlastnú zatvorenaDlzka kótu) —
	// scopeujeme na bokorys, kde sa vyskytuje presne raz.
	await expect(page.locator('[data-testid="bn-bokorys"] text', { hasText: /^8570$/ })).toHaveCount(
		1
	);
	await expect(page.locator('[data-testid="bn-bokorys"] text', { hasText: /^11100$/ })).toHaveCount(
		1
	);
	await expect(
		page.locator('[data-testid="bn-bokorys-presah"] text', { hasText: /^2530$/ })
	).toHaveCount(1);
	// review nález (#168): kóty museli čítať MIN_DIM_FONT (3) — pred opravou bola
	// kóta presahu natvrdo 2,8 (pod deklarovanou spoločnou podlahou čitateľnosti
	// z kompozicia.ts, ktorá tvrdí "NIKDY nekresli menšie").
	const presahFontSize = await page
		.locator('[data-testid="bn-bokorys-presah"] [data-testid="kota-label"]')
		.getAttribute('font-size');
	expect(Number(presahFontSize)).toBeGreaterThanOrEqual(3);
	await expect(page.locator('[data-testid="bn-bokorys"] text', { hasText: /^750$/ })).toHaveCount(
		1
	);
	await expect(page.locator('[data-testid="bn-bokorys"] text', { hasText: /^480$/ })).toHaveCount(
		1
	);
	await expect(page.locator('[data-testid="bn-podorys"] text', { hasText: /^4250$/ })).toHaveCount(
		1
	);

	// štyri sekcie v bokoryse (S4)
	await expect(page.getByTestId('bn-bokorys-sekcia-0')).toHaveCount(1);
	await expect(page.getByTestId('bn-bokorys-sekcia-3')).toHaveCount(1);
	await expect(page.getByTestId('bn-bokorys-sekcia-4')).toHaveCount(0);

	// varianta S4 v pečiatke
	await expect(page.getByTestId('tb-varianta')).toHaveText('S4');

	// textový popis
	await expect(page.getByTestId('bn-spec-posuv')).toContainText('JEDNOKOĽAJ VPRAVO');
	await expect(page.getByTestId('bn-spec-dvere')).toContainText('VĽAVO');
	await expect(page.getByTestId('bn-spec-model')).toContainText('PREMIER');
	await expect(page.getByTestId('bn-spec-vyska-cela')).toContainText('96,2');
	await expect(page.getByTestId('bn-spec-dlzka-kolajiska')).toContainText('11100');

	// rez sekciou — rezervovaný, nikdy vymyslený oblúk
	await expect(page.getByTestId('bn-rez-sekciou')).toBeVisible();
	await expect(page.getByTestId('bn-rez-sekciou-poznamka')).toContainText('doplní');

	// dverová sekcia zvýraznená oranžovo
	await expect(page.getByTestId('bn-podorys-dvere')).toHaveCount(1);

	// podpisová lišta (#139, opt-in prop) je vykreslená
	await expect(page.getByTestId('podpisova-lista')).toBeVisible();
	await expect(page.getByTestId('pl-rezal')).toHaveText('Rezal');
	await expect(page.getByTestId('pl-opracoval')).toHaveText('Opracoval');
	await expect(page.getByTestId('pl-kompletoval')).toHaveText('Kompletoval');
	await expect(page.getByTestId('pl-balil-gumoval')).toHaveText('Balil/Gumoval');

	await expect(page.getByRole('button', { name: '🖨 Tlačiť / uložiť PDF' })).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

// #168: REZ SEKCIOU je odteraz MALÝ pevný poznámkový box (nie stĺpec cez celú výšku
// hárku) — priama regresia živého nálezu "prázdny box zaberá tretinu šírky a dve
// tretiny výšky, kresba zaberá ~pätinu hárku" (viď design komentár na #168).
test('#168: REZ SEKCIOU je malý pevný box (nezaberá celú výšku hárku), bokorys/pôdorys sú väčšie', async ({
	page
}) => {
	await loginAs(page);
	await vyplnFormularOP260055(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	const ramW = Number(await page.getByTestId('bn-rez-sekciou-ram').getAttribute('width'));
	const ramH = Number(await page.getByTestId('bn-rez-sekciou-ram').getAttribute('height'));
	// starý box: oblast.w*0.17 (~47mm) × takmer celá výška hárku (~184mm) — nový box
	// je pevný a MALÝ v OBOCH rozmeroch (viď kompozicia.ts noteW=52/noteH=24)
	expect(ramW).toBeLessThan(60);
	expect(ramH).toBeLessThan(30);

	// bokorys aj pôdorys sú stále prítomné a viditeľné (kompozícia sa zmenila,
	// obsah nie)
	await expect(page.getByTestId('bn-bokorys')).toBeVisible();
	await expect(page.getByTestId('bn-podorys')).toBeVisible();
});

test('šírka prvej sekcie sa vykreslí LEN keď je ručne zadaná (appka nehádže vnorenie)', async ({
	page
}) => {
	await loginAs(page);
	await vyplnFormularOP260055(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('bn-bokorys-sirka-sekcie')).toHaveCount(0);

	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.getByLabel('Šírka prvej sekcie (mm) — ručný prepis').fill('2183.2');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('bn-bokorys-sirka-sekcie')).toHaveCount(1);
	await expect(
		page.locator('[data-testid="bn-bokorys-sirka-sekcie"] text', { hasText: /2183,2/ })
	).toHaveCount(1);
	// review nález (#168): kóty museli čítať MIN_DIM_FONT (3) — pred opravou bola
	// táto kóta natvrdo 2,8 (pod deklarovanou spoločnou podlahou čitateľnosti).
	const sirkaFontSize = await page
		.locator('[data-testid="bn-bokorys-sirka-sekcie"] [data-testid="kota-label"]')
		.getAttribute('font-size');
	expect(Number(sirkaFontSize)).toBeGreaterThanOrEqual(3);
});

test('dvojkoľaj (obojsmerný posuv) — POSUV popis a bez smerového poľa vo formulári', async ({
	page
}) => {
	await loginAs(page);
	await goto(page, '/bazen/navrh');
	await waitHydrated(page);
	await page.getByLabel('Koľaj', { exact: true }).selectOption('dvojkolaj');
	// smer posuvu sa skrýva pri dvojkoľaji (relevantný len pre jednokoľaj)
	await expect(page.getByLabel('Smer posuvu')).toHaveCount(0);
	await page.getByLabel('Zatvorená dĺžka (mm) *').fill('10500');
	await page.getByLabel('Hĺbka (mm) *').fill('3788');
	await page.getByLabel('Dĺžka koľajiska (mm) *').fill('13000');
	await page.getByLabel('Výška najvyššej sekcie (mm) *').fill('1600');
	await page.getByLabel('Výška najnižšej sekcie (mm) *').fill('1320');
	await page.getByLabel('Počet sekcií *').fill('5');
	await page.getByLabel('Výška čela (mm) *').fill('90');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('form-error')).toHaveCount(0);
	await expect(page.getByTestId('bn-spec-posuv')).toContainText('OBOJSMERNÝ');
	await expect(page.getByTestId('tb-varianta')).toHaveText('S5');
	await expect(page.getByTestId('bn-bokorys-sekcia-4')).toHaveCount(1);
	await expect(page.getByTestId('bn-bokorys-sekcia-5')).toHaveCount(0);
});

test('RAL farebný variant — výber odtieňa vyplní farbu a poznámku', async ({ page }) => {
	await loginAs(page);
	await vyplnFormularOP260055(page);
	await page.getByTestId('rezim-farebny-radio').check();
	await page.getByLabel('RAL odtieň').selectOption('9006');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('bn-ral-text')).toHaveText('RAL: 9006 STRIEBORNÁ');
});

// tlač: rovnaký mechanizmus ako /pergola/navrh a /zasklenia/navrh (route-scoped
// @page landscape).
test('tlač: @page je A4 landscape, len na tejto route (route-CSS-splitting)', async ({ page }) => {
	await loginAs(page);
	await vyplnFormularOP260055(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	const pageSizes = await najdiPageSizes(page);
	expect(pageSizes.some((s) => /landscape/i.test(s))).toBe(true);

	// prechod na /bazen (portrait, z app.css) nesmie zdediť landscape
	await goto(page, '/bazen');
	const bazenSizes = await najdiPageSizes(page);
	expect(bazenSizes.some((s) => /landscape/i.test(s))).toBe(false);
});

test('← Späť a upraviť: vstup prežije (echo akcia, nie <a href> ktorý by ho vynuloval)', async ({
	page
}) => {
	await loginAs(page);
	await vyplnFormularOP260055(page);
	await page.getByLabel('Názov výkresu (voliteľné)').fill('Ponuka pre ZAK202699');
	await page.getByLabel('OP číslo').fill('OP260055');
	await page.getByLabel('Dverová sekcia (poradie) *').fill('2');
	await page.getByLabel('Aretácia (voliteľné)').fill('VPRAVO automaticky');
	await page.getByTestId('rezim-farebny-radio').check();
	await page.getByLabel('RAL odtieň').selectOption('9006');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);

	await expect(page.getByLabel('Zatvorená dĺžka (mm) *')).toHaveValue('8570');
	await expect(page.getByLabel('Dĺžka koľajiska (mm) *')).toHaveValue('11100');
	await expect(page.getByLabel('Názov výkresu (voliteľné)')).toHaveValue('Ponuka pre ZAK202699');
	await expect(page.getByLabel('OP číslo')).toHaveValue('OP260055');
	await expect(page.getByLabel('Dverová sekcia (poradie) *')).toHaveValue('2');
	await expect(page.getByLabel('Aretácia (voliteľné)')).toHaveValue('VPRAVO automaticky');
	await expect(page.getByTestId('rezim-farebny-radio')).toBeChecked();
	await expect(page.getByLabel('RAL odtieň')).toHaveValue('9006');
	await expect(page.getByTestId('ral-swatch')).toBeVisible();

	// opätovné vykreslenie po obnovení potvrdí, že sa NIČ nestratilo
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);
	await expect(page.getByTestId('bn-ral-text')).toHaveText('RAL: 9006 STRIEBORNÁ');
	await expect(page.getByTestId('bn-podorys-dvere')).toHaveCount(1);
});

// #139 zadanie: "pre b2b stránka prístupná nebude" — na rozdiel od
// /pergola/navrh a /zasklenia/navrh (obe b2b PRÍSTUPNÉ) je /bazen/navrh
// pre b2b ÚPLNE zablokovaná, presne ako existujúca /bazen (Money odpis).
test('b2b: /bazen/navrh je presmerovaná preč (#139 — na rozdiel od pergoly/zasklenia)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	page.on('dialog', (d) => d.accept());
	const b2bUser = `e2e-bazen-navrh-b2b-${Date.now().toString(36)}`;
	const b2bPass = 'e2eheslo1';
	await goto(page, '/pouzivatelia');
	await page.getByLabel('Prihlasovacie meno').fill(b2bUser);
	await page.getByLabel('Heslo (min. 6 znakov)').fill(b2bPass);
	await page.getByRole('button', { name: 'Pridať účet' }).click(); // rola defaultne B2B
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('vytvorený');

	await page.getByRole('button', { name: 'Odhlásiť' }).click();
	await expect(page).toHaveURL(/\/login/);
	await loginAs(page, b2bUser, b2bPass);

	await expect(page).toHaveURL(/\/zasklenia$/);
	// b2b menu neobsahuje /bazen vôbec (bazén nie je b2b modul) — a teda ani jeho
	// odkaz "→ Návrhový výkres"
	await expect(page.getByRole('link', { name: 'Bazén' })).toHaveCount(0);

	// priamy prístup na /bazen/navrh presmeruje preč (rovnaká vrstva ako /bazen samotné)
	await goto(page, '/bazen/navrh');
	await expect(page).toHaveURL(/\/zasklenia$/);

	// upratanie
	await page.getByRole('button', { name: 'Odhlásiť' }).click();
	await expect(page).toHaveURL(/\/login/);
	await loginAs(page);
	await goto(page, '/pouzivatelia');
	await page.locator('tr', { hasText: b2bUser }).getByRole('button', { name: 'Zmazať' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('zmazaný');

	expect(errs).toEqual([]);
});

test('internal: odkaz "→ Návrhový výkres" na /bazen vedie na /bazen/navrh, žiadne tlačidlo odoslania do Money', async ({
	page
}) => {
	await loginAs(page);
	await goto(page, '/bazen');
	await expect(page.getByTestId('link-navrh')).toBeVisible();
	await page.getByTestId('link-navrh').click();
	await waitHydrated(page);
	await expect(page).toHaveURL(/\/bazen\/navrh$/);

	await vyplnFormularOP260055(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('form-error')).toHaveCount(0);
	await expect(page.getByTestId('bn-bokorys')).toBeVisible();
	// žiadna zápisová (Money odpis) akcia dostupná na tejto stránke
	await expect(page.getByRole('button', { name: /odoslať/i })).toHaveCount(0);
});
