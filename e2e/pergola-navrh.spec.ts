// Pergola — zákaznícky návrhový výkres (#138, vzor OP260032). Všetko ČÍTACIE — modul
// do Money nič nezapisuje, takže sa dá pustiť aj proti nasadenej appke (BASE_URL).
import { test, expect, type Page } from '@playwright/test';
import { goto, loginAs, collectConsole, waitHydrated } from './helpers';

/** Rovnaká rekurzívna @page-detekcia ako v navrh-vykres.spec.ts (#137) — @page je
 *  vnorený v @media print bloku, plochý prechod cssRules ho nenájde. */
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
	await goto(page, '/pergola/navrh');
	await waitHydrated(page);
	await page.getByLabel('OP číslo').fill('OP260032');
	// hĺbka/výšky/počet polí/panelov už majú predvyplnené vzorové hodnoty OP260032
	// (6000=3000+3000, hĺbka 3500, výšky 2500/2800, 8 panelov) — netreba prepisovať
	await page.getByLabel('RAL (červená poznámka na výkrese)').fill('7016-ANTRACIT JŠ');
	await page
		.getByLabel('Text výplne / etapy (modrý text)')
		.fill('FIX v 1. etape STADUR RAL 7016JŠ');
	await page.getByRole('checkbox', { name: 'vpredu' }).first().check();
	await page.getByRole('checkbox', { name: 'vzadu (pri stene)' }).nth(2).check();
}

test('formulár → výkres OP260032: všetkých 5 pohľadov + pečiatka + kóty sedia na vzore', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	// všetkých 5 pohľadov prítomných v kresbe
	await expect(page.getByTestId('pn-panel-detail')).toBeVisible();
	await expect(page.getByTestId('pn-elevation')).toBeVisible();
	await expect(page.getByTestId('pn-section')).toBeVisible();
	await expect(page.getByTestId('pn-isometria')).toBeVisible();
	await expect(page.getByTestId('pn-texty')).toBeVisible();

	// detail strešnej výplne — presne sedí na vzore (6000/8−24=726, 3500−89=3411)
	await expect(page.getByTestId('pn-panel-pocet')).toContainText('8ks strešná výplň');

	// predný pohľad — polia 3000+3000=6000, výšky 2500/2310 (front/clearance)
	await expect(
		page.locator('[data-testid="pn-elevation"] text', { hasText: '3000 mm' })
	).toHaveCount(2);
	await expect(
		page.locator('[data-testid="pn-elevation"] text', { hasText: '6000 mm' })
	).toBeVisible();
	await expect(
		page.locator('[data-testid="pn-elevation"] text', { hasText: '2500 mm' })
	).toBeVisible();
	await expect(
		page.locator('[data-testid="pn-elevation"] text', { hasText: '2310 mm' })
	).toBeVisible();
	// zvislé <line> stĺpy majú nulovú ŠÍRKU bounding boxu (Playwright ich preto
	// nepovažuje za "visible") — sila je v POČTE (3 stĺpy pre 2 polia), nie vo
	// visibility-checku na perfektne zvislom prvku
	await expect(page.getByTestId(/pn-elevation-post-\d/)).toHaveCount(3);

	// bočný rez (VIEW A) — hĺbka 3500, sklon vypočítaný z 2500/2800/3500 (čestne, nie
	// natvrdo "4,3°" zo vzoru — dôvod je v design komentári na #138)
	await expect(
		page.locator('[data-testid="pn-section"] text', { hasText: '3500 mm' })
	).toBeVisible();
	await expect(
		page.locator('[data-testid="pn-section"] text', { hasText: '2800 mm' })
	).toBeVisible();
	const sklon = page.getByTestId('pn-sklon');
	await expect(sklon).toBeVisible();
	await expect(sklon).toHaveText(/^\d+,\d°$/);

	// 3D izometria — hrany, obe ZVOD šípky, poznámka. Niektoré hrany (stĺpy) sú
	// perfektne zvislé (nulová šírka bounding boxu → Playwright ich nepovažuje za
	// "visible", rovnaká pasca ako pri pn-elevation-post vyššie) — over POČET:
	// 2×3 stĺpy + 2 hlavné nosníky + (8 panelov+1) krokiev = 17 (viď
	// tests/pergola-navrh.test.ts izometriaHrany)
	await expect(page.getByTestId('pn-iso-hrany').locator('line')).toHaveCount(17);
	await expect(page.getByTestId('pn-zvod-label')).toHaveCount(2);
	await expect(page.getByTestId('pn-poznamka-izometria')).toContainText('bez výplne');

	// texty — modrý text výplne/etapy + červená RAL poznámka
	await expect(page.getByTestId('pn-text-vyplne')).toContainText(
		'FIX v 1. etape STADUR RAL 7016JŠ'
	);
	await expect(page.getByTestId('pn-ral')).toContainText('RAL: 7016-ANTRACIT JŠ');

	// pečiatka — vyplnená (zdieľaný TitleBlock zo #137)
	await expect(page.getByTestId('tb-cislo-vykresu')).toContainText('OP260032');
	await expect(page.getByTestId('tb-varianta')).toContainText('NAVRH');
	await expect(page.getByTestId('tb-navrh')).toHaveText('NAVRH');
	// mierka je VYPOČÍTANÁ (nikdy natvrdo "1:20")
	await expect(page.getByTestId('tb-mierka')).toHaveText(/^(≈1:\d+|—)$/);

	// tlačidlo tlače prítomné
	await expect(page.getByRole('button', { name: '🖨 Tlačiť / uložiť PDF' })).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});

test('tlač A4 na šírku (@page landscape) — LEN na tejto route, nedotýka sa nárezáku/fixu', async ({
	page
}) => {
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	const pageSizes = await najdiPageSizes(page);
	expect(pageSizes.some((s) => /landscape/i.test(s))).toBe(true);

	// prechod na existujúci portrait modul overí, že landscape @page NEPRETRVÁ
	// (route-CSS-splitting, #137 bod 3)
	await goto(page, '/zasklenia');
	const inePageSizes = await najdiPageSizes(page);
	expect(inePageSizes.length).toBeGreaterThan(0);
	expect(inePageSizes.some((s) => /landscape/i.test(s))).toBe(false);
});

test('Money odpis existujúceho /pergola formulára nedotknutý — odkaz na návrh nezasahuje do CAD nárezu', async ({
	page
}) => {
	await loginAs(page);
	await goto(page, '/pergola');
	await waitHydrated(page);
	// pôvodný formulár (CAD nárez → Money) je stále na svojom mieste
	await expect(page.getByLabel('Materiál (CAD nárez) *')).toBeVisible();
	// nový odkaz na návrhový výkres je prítomný a smeruje na /pergola/navrh
	const link = page.getByTestId('link-navrh');
	await expect(link).toBeVisible();
	await link.click();
	await waitHydrated(page);
	await expect(page).toHaveURL(/\/pergola\/navrh$/);
	await expect(page.getByRole('heading', { name: 'Pergola — návrhový výkres' })).toBeVisible();
});

test('← Späť a upraviť: formulár sa vráti s predvyplneným vstupom (nevynuluje sa)', async ({
	page
}) => {
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await expect(page.getByLabel('OP číslo')).toHaveValue('OP260032');
	await expect(page.getByLabel('Hĺbka (mm) *')).toHaveValue('3500');
	await expect(page.getByLabel('Výška vpredu (mm) *')).toHaveValue('2500');
});

test('ručný prepis šírky/dĺžky panelu výplne prepíše dopočítanú hodnotu na výkrese', async ({
	page
}) => {
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByLabel('Šírka panelu (mm) — ručný prepis').fill('700');
	await page.getByLabel('Dĺžka panelu (mm) — ručný prepis').fill('3000');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('pn-panel-obrys')).toBeVisible();
	// kóty v detaile výplne teraz nesú PREPÍSANÉ hodnoty, nie dopočítané (726/3411)
	await expect(
		page.locator('[data-testid="pn-panel-detail"] text', { hasText: '700 mm' })
	).toBeVisible();
	await expect(
		page.locator('[data-testid="pn-panel-detail"] text', { hasText: '3000 mm' })
	).toBeVisible();
});

// review nález (#138): zaškrtnutý zvod na vysokom stĺpe + neskoršie zníženie počtu
// polí by inak nechalo v stave zaniknutý zvod (checkbox už nie je v UI vidno), server
// by odoslanie odmietol s neintuitívnou chybou — zníženie počtu polí ho musí zahodiť
test('zníženie počtu polí po zaškrtnutí zvodu na zaniknutom stĺpe: odoslanie prejde bez chyby', async ({
	page
}) => {
	await loginAs(page);
	await goto(page, '/pergola/navrh');
	await page.getByLabel('OP číslo').fill('OP260032');
	// 8 polí → 9 stĺpov, zaškrtneme zvod na poslednom (index 8)
	await page.selectOption('#pocetPoli', '8');
	const poslednyRiadok = page.getByTestId('zvody-box').locator('.row').last();
	await poslednyRiadok.getByRole('checkbox', { name: 'vpredu' }).check();
	// zníženie na 1 pole → 2 stĺpy, zaniknutý zvod sa musí ticho zahodiť
	await page.selectOption('#pocetPoli', '1');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('form-error')).toHaveCount(0);
	await expect(page.getByTestId('pn-isometria')).toBeVisible();
});

// Neplatný vstup (mimo rozsahu hĺbka/výška/panely, neplatná pozícia zvodu a pod.) je
// pokrytý priamo v tests/pergola-navrh-vstup.test.ts / tests/pergola-navrh.test.ts
// (server je jediný strážca rozsahov — rovnaká disciplína ako fix-vstup.test.ts) —
// formulárové polia tu majú HTML5 `required`/min/max, takže reálny používateľ sa
// k neplatnému stavu cez UI vôbec nedostane; e2e simuluje SKUTOČNÉHO používateľa, nie
// skriptovaný obchádzajúci POST (to je práve to, čo unit testy nad parserom pokrývajú
// lepšie). OP číslo je od #144 VOLITEĽNÉ (rovnaké testy) — nie je v tomto zozname.

// #144 — VO odberateľ (b2b) dostáva prístup na tento display-only návrhový výkres:
// nav odkaz, samotné otvorenie/vykreslenie funguje, /pergola (Money odpis) ostáva
// zablokované, a keď b2b (bez Montalu OP čísla) OP nechá prázdne, pečiatka to ukáže
// ako „—" (nie prázdny text ani natvrdo predstierané "0"/meno).
test('b2b: nav odkaz "Pergola návrh", otvorenie funguje, /pergola ostáva blokované, prázdne OP = "—" v pečiatke (#144)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	// b2b throwaway účet (rovnaký vzor ako app.spec.ts/sietka.spec.ts B2B testy)
	page.on('dialog', (d) => d.accept());
	const b2bUser = `e2e-pergola-navrh-b2b-${Date.now().toString(36)}`;
	const b2bPass = 'e2eheslo1';
	await goto(page, '/pouzivatelia');
	await page.getByLabel('Prihlasovacie meno').fill(b2bUser);
	await page.getByLabel('Heslo (min. 6 znakov)').fill(b2bPass);
	await page.getByRole('button', { name: 'Pridať účet' }).click(); // rola defaultne B2B
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('vytvorený');

	await page.getByRole('button', { name: 'Odhlásiť' }).click();
	await expect(page).toHaveURL(/\/login/);
	await loginAs(page, b2bUser, b2bPass);

	// nav odkaz viditeľný pre b2b, pôvodná "Pergola" (Money odpis) NIE JE v b2b menu
	await expect(page.getByRole('link', { name: 'Pergola návrh' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Pergola', exact: true })).toHaveCount(0);

	await page.getByRole('link', { name: 'Pergola návrh' }).click();
	await waitHydrated(page);
	await expect(page).toHaveURL(/\/pergola\/navrh$/);

	// OP číslo ostáva PRÁZDNE (VO odberateľ nemá Montalu OP číslo) — dimenzie majú
	// platné predvolené hodnoty, vykreslenie prejde aj tak
	await expect(page.getByLabel('OP číslo')).toHaveValue('');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('form-error')).toHaveCount(0);
	await expect(page.getByTestId('pn-isometria')).toBeVisible();
	await expect(page.getByTestId('tb-cislo-vykresu')).toHaveText('—');
	await expect(page.getByTestId('tb-revizia')).toHaveText('—');
	// review nález (deep review na #144): OP prázdne + názov výkresu prázdny (obe
	// nevyplnené v tomto teste) by bez fallbacku dali VIZUÁLNE PRÁZDNY <h1> nad
	// samotným výkresom — musí ukázať „—", nie prázdny nadpis.
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('—');
	await expect(page.getByRole('button', { name: '🖨 Tlačiť / uložiť PDF' })).toBeVisible();

	// priama navigácia na /pergola (Money odpis z CAD nárezu) OSTÁVA zablokovaná
	await goto(page, '/pergola');
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
