// Zasklenia — zákaznícky návrhový výkres (#162, architektúra 1:1 podľa pergoly
// #138/#144/#150/#153). Všetko ČÍTACIE — modul do Money nič nezapisuje, takže sa
// dá pustiť aj proti nasadenej appke (BASE_URL).
import { test, expect, type Page } from '@playwright/test';
import { goto, loginAs, collectConsole, waitHydrated } from './helpers';

/** Rovnaká rekurzívna @page-detekcia ako v navrh-vykres.spec.ts/pergola-navrh.spec.ts
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

async function vyplnFormular(page: Page) {
	await goto(page, '/zasklenia/navrh');
	await waitHydrated(page);
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Celková šírka (mm) *').fill('3000');
	await page.getByLabel('Celková výška (mm) *').fill('2000');
	await page.getByLabel('Smer otvárania').selectOption('P - L');
}

// REGRESIA (nájdené pri LIVE post-deploy overení #162, nie lokálnym testom —
// pozri vysvetlenie nižšie): reštart-effect v +page.svelte čítal `stylyForSystem
// (systemS)` HNEĎ PO tom, čo ten istý effect `systemS` zapísal o riadok vyššie —
// sebareferenčné čítanie effect samo-prihlásilo na `systemS`, takže KAŽDÁ
// zmena selectu „Systém" effect znova spustila a effect (form je pred
// odoslaním stále null) `systemS` TICHO PREPÍSAL SPÄŤ na `data.systemy[0]`.
// Odoslaný formulár preto vždy niesol PRVÝ systém v DB zozname, nikdy ten
// zvolený v UI — na produkcii (prvý systém = Deluxe) to bolo viditeľné, no
// lokálny/CI seed má prvý systém `Robust`, presne ten istý, aký si predošlé
// testy v tomto súbore VŽDY vyberajú — zhoda náhodne maskovala chybu. Tento
// test si preto vyberá systém EXPLICITNE ZISTENÝ ako NIE prvý v zozname.
test('regresia (live nález): zmena systému sa NEVRÁTI späť na prvý v zozname (self-loop v reštart-effecte)', async ({
	page
}) => {
	await loginAs(page);
	await goto(page, '/zasklenia/navrh');
	await waitHydrated(page);

	const initial = await page.locator('#system').inputValue();
	const systemyOptions = await page.locator('#system').locator('option').allTextContents();
	// zvoľ systém, ktorý NIE JE ten pôvodne vybraný (teda nie systemy[0])
	const cielovyIdx = systemyOptions.findIndex((label) => label !== initial);
	const cielovy = await page
		.locator('#system')
		.locator('option')
		.nth(cielovyIdx)
		.getAttribute('value');
	expect(cielovy).not.toBe(initial);
	expect(cielovy).not.toBeNull();

	await page.getByLabel('Systém').selectOption(cielovy!);
	// over hodnotu HNEĎ aj o chvíľu neskôr — self-loop bug ju prepisoval späť
	// na najbližšom reaktívnom flushi, nie okamžite pri samotnom výbere
	await expect(page.locator('#system')).toHaveValue(cielovy!);
	await page.waitForTimeout(300);
	await expect(page.locator('#system')).toHaveValue(cielovy!);

	const stylOptions = await page.locator('#styl').locator('option').allTextContents();
	await page.getByLabel('Štýl').selectOption(stylOptions[0]);
	await page.getByLabel('Celková šírka (mm) *').fill('3000');
	await page.getByLabel('Celková výška (mm) *').fill('2000');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('form-error')).toHaveCount(0);
	// nadpis pod výkresom nesie SKUTOČNE zvolený systém, nie prvý v zozname
	await expect(page.getByTestId('zn-system')).toContainText(cielovy!);
});

test('vyplnenie formulára nakreslí predný pohľad s kótami — 2 krídla (Robust 2K), zero console errors', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('form-error')).toHaveCount(0);
	await expect(page.getByTestId('zn-elevacia')).toBeVisible();
	await expect(page.getByTestId('zn-kridlo-0')).toHaveCount(1);
	await expect(page.getByTestId('zn-kridlo-1')).toHaveCount(1);
	await expect(page.getByTestId('zn-kridlo-2')).toHaveCount(0);
	// celková šírka 3000mm / 2 krídla = 1500mm na krídlo — OBIDVE rovnako široké
	// krídla teda dajú DVE zhodné kóty "1500" — presná zhoda, nie substring (aby
	// "3000" nekolidovalo s "23000"/"30000" a pod.)
	await expect(page.locator('[data-testid="zn-elevacia"] text', { hasText: /^1500$/ })).toHaveCount(
		2
	);
	await expect(page.locator('[data-testid="zn-elevacia"] text', { hasText: /^3000$/ })).toHaveCount(
		1
	);
	await expect(page.locator('[data-testid="zn-elevacia"] text', { hasText: /^2000$/ })).toHaveCount(
		1
	);
	// smer otvárania sa vykreslil
	await expect(page.getByTestId('zn-smer')).toBeVisible();
	await expect(page.getByTestId('zn-smer-text')).toHaveText('P - L');
	await expect(page.getByRole('button', { name: '🖨 Tlačiť / uložiť PDF' })).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

// #168 bod 2/3: väčšia hlavička (čitateľná) + šípka na pohyblivom krídle — priama
// regresia nálezu "horná tretina prázdna, hlavička mikroskopická, nevidno ktoré pole
// sa hýbe" (živá kontrola po #162, viď design komentár na #168).
test('#168: väčší nadpis + šípka na pohyblivom krídle podľa smeru otvárania (P-L/L-P/Opona)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await vyplnFormular(page); // Robust 2K, 3000×2000, P-L
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	// hlavička je čitateľná — MIN_TITLE_FONT (6) > pôvodných 4,5
	const titulFontSize = await page.getByTestId('zn-titul').getAttribute('font-size');
	expect(Number(titulFontSize)).toBeGreaterThanOrEqual(6);

	// P-L: LEN krídlo 0 (vľavo) je pohyblivé, krídlo 1 (vpravo, jediné druhé pri n=2) nie
	await expect(page.getByTestId('zn-pohyblive-pole-0')).toBeVisible();
	await expect(page.getByTestId('zn-pohyblive-pole-1')).toHaveCount(0);

	// zmena na L-P: pohyblivé je teraz posledné krídlo (index 1), nie prvé —
	// „Vykresliť" nahradí formulár výsledkom, treba sa najprv vrátiť späť
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.getByLabel('Smer otvárania').selectOption('L - P');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);
	await expect(page.getByTestId('zn-pohyblive-pole-0')).toHaveCount(0);
	await expect(page.getByTestId('zn-pohyblive-pole-1')).toBeVisible();

	// Opona: OBIDVE krajné krídla sú pohyblivé
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.getByLabel('Smer otvárania').selectOption('Opona');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);
	await expect(page.getByTestId('zn-pohyblive-pole-0')).toBeVisible();
	await expect(page.getByTestId('zn-pohyblive-pole-1')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

// #162 bod 4: „bez rámčeka vpravo dole a bez konštrukčných mierok" — na rozdiel od
// pergoly (ktorá titleBlock prop POSIELA) táto stránka VykresovyHarok volá BEZ
// titleBlock, takže `title-block`/`tb-*` testidy sa NIKDY nevykreslia.
test('#162 bod 4: zákaznícka verzia bez info rámčeka (žiadny title-block)', async ({ page }) => {
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('title-block')).toHaveCount(0);
	await expect(page.getByTestId('tb-mierka')).toHaveCount(0);
	await expect(page.getByTestId('tb-cislo-vykresu')).toHaveCount(0);
	// hárok s mriežkou (rám papiera) je STÁLE tam — len bez pečiatky
	await expect(page.getByTestId('vykresovy-harok')).toBeVisible();
});

test('RAL farebný variant — výber odtieňa vyplní farbu a poznámku', async ({ page }) => {
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByTestId('rezim-farebny-radio').check();
	await page.getByLabel('RAL odtieň').selectOption('7016');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('zn-ral-text')).toHaveText('RAL: 7016 ANTRACIT');
	await expect(page.getByTestId('zn-elevation-ram')).toHaveAttribute('fill', '#383E42');
});

test('klín nad posuvom — vyplnené polia sa vykreslia s kótou', async ({ page }) => {
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByRole('checkbox', { name: 'Klín nad posuvom' }).check();
	await page.getByLabel('Dĺžka (mm)', { exact: true }).fill('1000');
	await page.getByLabel('Šírka (mm)', { exact: true }).fill('300');
	await page.getByLabel('Výška 1 (mm)', { exact: true }).fill('80');
	await page.getByLabel('Výška 2 (mm)', { exact: true }).fill('40');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('zn-klin')).toBeVisible();
	await expect(page.getByTestId('zn-klin-obrys')).toHaveCount(1);
	await expect(page.getByTestId('zn-klin-v1')).toHaveText('v1 80 mm');
	await expect(page.getByTestId('zn-klin-v2')).toHaveText('v2 40 mm');
	// review nález (#168): v1/v2 popisky museli čítať MIN_DIM_FONT (3) — pred
	// opravou boli natvrdo 2,8 (pod deklarovanou spoločnou podlahou čitateľnosti
	// z kompozicia.ts, ktorá tvrdí "NIKDY nekresli menšie").
	const v1FontSize = await page.getByTestId('zn-klin-v1').getAttribute('font-size');
	const v2FontSize = await page.getByTestId('zn-klin-v2').getAttribute('font-size');
	expect(Number(v1FontSize)).toBeGreaterThanOrEqual(3);
	expect(Number(v2FontSize)).toBeGreaterThanOrEqual(3);
});

test('ručná koľajnica — vyplnená horná dĺžka sa vykreslí ako poznámka', async ({ page }) => {
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByLabel('Horná (mm)').fill('2690');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('zn-kolajnica')).toBeVisible();
	await expect(page.getByTestId('zn-kolajnica-text')).toContainText('horná 2690 mm');
});

// tlač: rovnaký mechanizmus ako /pergola/navrh (route-scoped @page landscape).
test('tlač: @page je A4 landscape, len na tejto route (route-CSS-splitting)', async ({ page }) => {
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	const pageSizes = await najdiPageSizes(page);
	expect(pageSizes.some((s) => /landscape/i.test(s))).toBe(true);

	// prechod na /zasklenia (portrait, z app.css) nesmie zdediť landscape
	await goto(page, '/zasklenia');
	const zaskleniaSizes = await najdiPageSizes(page);
	expect(zaskleniaSizes.some((s) => /landscape/i.test(s))).toBe(false);
});

test('← Späť a upraviť: vstup prežije (echo akcia, nie <a href> ktorý by ho vynuloval)', async ({
	page
}) => {
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByLabel('Názov výkresu (voliteľné)').fill('Ponuka pre ZAK202699');
	// #162 review nález: round-trip musí pokryť AJ klín/koľajnicu/RAL/režim —
	// presne tá trieda polí, ktorú `zasklenia-form-reactivity.md` (#132) označuje
	// za historicky náchylnú na stratu pri „← Späť a upraviť"
	await page.getByRole('checkbox', { name: 'Klín nad posuvom' }).check();
	await page.getByLabel('Dĺžka (mm)', { exact: true }).fill('1000');
	await page.getByLabel('Šírka (mm)', { exact: true }).fill('300');
	await page.getByLabel('Výška 1 (mm)', { exact: true }).fill('80');
	await page.getByLabel('Výška 2 (mm)', { exact: true }).fill('40');
	await page.getByLabel('Horná (mm)').fill('2690');
	await page.getByLabel('Spodná (mm)').fill('2695');
	await page.getByTestId('rezim-farebny-radio').check();
	await page.getByLabel('RAL odtieň').selectOption('7016');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);

	await expect(page.getByLabel('Celková šírka (mm) *')).toHaveValue('3000');
	await expect(page.getByLabel('Celková výška (mm) *')).toHaveValue('2000');
	await expect(page.getByLabel('Názov výkresu (voliteľné)')).toHaveValue('Ponuka pre ZAK202699');
	await expect(page.getByRole('checkbox', { name: 'Klín nad posuvom' })).toBeChecked();
	await expect(page.getByLabel('Dĺžka (mm)', { exact: true })).toHaveValue('1000');
	await expect(page.getByLabel('Šírka (mm)', { exact: true })).toHaveValue('300');
	await expect(page.getByLabel('Výška 1 (mm)', { exact: true })).toHaveValue('80');
	await expect(page.getByLabel('Výška 2 (mm)', { exact: true })).toHaveValue('40');
	await expect(page.getByLabel('Horná (mm)')).toHaveValue('2690');
	await expect(page.getByLabel('Spodná (mm)')).toHaveValue('2695');
	await expect(page.getByTestId('rezim-farebny-radio')).toBeChecked();
	await expect(page.getByLabel('RAL odtieň')).toHaveValue('7016');
	await expect(page.getByTestId('ral-swatch')).toBeVisible();

	// opätovné vykreslenie po obnovení potvrdí, že sa NIČ nestratilo
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);
	await expect(page.getByTestId('zn-klin')).toBeVisible();
	await expect(page.getByTestId('zn-kolajnica-text')).toContainText('horná 2690 mm');
	await expect(page.getByTestId('zn-kolajnica-text')).toContainText('spodná 2695 mm');
	await expect(page.getByTestId('zn-ral-text')).toHaveText('RAL: 7016 ANTRACIT');
});

// #162 bod 5: b2b — dostupná AUTOMATICKY (na rozdiel od pergoly nepotrebuje výnimku
// v B2B_ALLOWED_EXCEPTIONS, lebo /zasklenia/* nie je v B2B_FORBIDDEN_PREFIXES) —
// odkaz na stránke /zasklenia (obe role ju vidia), otvorenie a vykreslenie funguje.
test('b2b: odkaz "→ Návrhový výkres" na /zasklenia, otvorenie a vykreslenie funguje (#162)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	// b2b throwaway účet (rovnaký vzor ako pergola-navrh.spec.ts/sietka.spec.ts B2B testy)
	page.on('dialog', (d) => d.accept());
	const b2bUser = `e2e-zaskl-navrh-b2b-${Date.now().toString(36)}`;
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
	// #162 review nález: top-nav odkaz (b2b menu, rovnaká disciplína ako "Pergola
	// návrh" #144) AJ in-page odkaz na /zasklenia — obe cesty musia fungovať
	await expect(page.getByRole('link', { name: 'Zasklenia návrh' })).toBeVisible();
	await expect(page.getByTestId('link-navrh')).toBeVisible();
	await page.getByTestId('link-navrh').click();
	await waitHydrated(page);
	await expect(page).toHaveURL(/\/zasklenia\/navrh$/);

	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Celková šírka (mm) *').fill('3000');
	await page.getByLabel('Celková výška (mm) *').fill('2000');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('form-error')).toHaveCount(0);
	await expect(page.getByTestId('zn-elevacia')).toBeVisible();
	// žiadna zápisová (Money odpis) akcia dostupná na tejto stránke
	await expect(page.getByRole('button', { name: /odoslať/i })).toHaveCount(0);

	// upratanie
	await page.getByRole('button', { name: 'Odhlásiť' }).click();
	await expect(page).toHaveURL(/\/login/);
	await loginAs(page);
	await goto(page, '/pouzivatelia');
	await page.locator('tr', { hasText: b2bUser }).getByRole('button', { name: 'Zmazať' }).click();
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('zmazaný');

	expect(errs).toEqual([]);
});
