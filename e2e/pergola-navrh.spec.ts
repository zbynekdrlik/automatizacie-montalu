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
	// #150: RAL je teraz select ("iný…" odomkne voľný text) — rovnaký reťazec ako
	// predtým, len cez novú UI (dropdown → free text), aby ostali existujúce
	// asercie na "7016-ANTRACIT JŠ" nižšie nezmenené. Dedikovaný známy-RAL/farebný
	// režim flow má vlastné testy nižšie.
	await page.getByLabel('RAL odtieň').selectOption('iny');
	await page.getByLabel('RAL — vlastný text').fill('7016-ANTRACIT JŠ');
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
	// #146 bod 1: kóty BEZ jednotky "mm" (CAD píše holé čísla) — presná zhoda,
	// nie substring (aby "3000" nekolidovalo s "23000"/"30000" a pod.)
	await expect(
		page.locator('[data-testid="pn-elevation"] text', { hasText: /^3000$/ })
	).toHaveCount(2);
	await expect(
		page.locator('[data-testid="pn-elevation"] text', { hasText: /^6000$/ })
	).toBeVisible();
	await expect(
		page.locator('[data-testid="pn-elevation"] text', { hasText: /^2500$/ })
	).toBeVisible();
	await expect(
		page.locator('[data-testid="pn-elevation"] text', { hasText: /^2310$/ })
	).toBeVisible();
	// stĺpy — #146 bod 2: kreslené ako <rect> s reálnou hrúbkou v mierke (nie
	// jednočiarové), počet (3 stĺpy pre 2 polia) je stále silnejší/jednoduchší
	// dôkaz než visibility-check na jednotlivom prvku
	await expect(page.getByTestId(/pn-elevation-post-\d/)).toHaveCount(3);

	// bočný rez (VIEW A) — hĺbka 3500, sklon vypočítaný z 2500/2800/3500 (čestne, nie
	// natvrdo "4,3°" zo vzoru — dôvod je v design komentári na #138). #146 bod 1: bez "mm".
	await expect(
		page.locator('[data-testid="pn-section"] text', { hasText: /^3500$/ })
	).toBeVisible();
	await expect(
		page.locator('[data-testid="pn-section"] text', { hasText: /^2800$/ })
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
	const consoleMsgs = collectConsole(page);
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
	expect(consoleMsgs).toEqual([]);
});

test('Money odpis existujúceho /pergola formulára nedotknutý — odkaz na návrh nezasahuje do CAD nárezu', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
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
	expect(consoleMsgs).toEqual([]);
});

test('← Späť a upraviť: formulár sa vráti s predvyplneným vstupom (nevynuluje sa)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await expect(page.getByLabel('OP číslo')).toHaveValue('OP260032');
	await expect(page.getByLabel('Hĺbka (mm) *')).toHaveValue('3500');
	await expect(page.getByLabel('Výška vpredu (mm) *')).toHaveValue('2500');
	expect(consoleMsgs).toEqual([]);
});

test('ručný prepis šírky/dĺžky panelu výplne prepíše dopočítanú hodnotu na výkrese', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByLabel('Šírka panelu (mm) — ručný prepis').fill('700');
	await page.getByLabel('Dĺžka panelu (mm) — ručný prepis').fill('3000');
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await expect(page.getByTestId('pn-panel-obrys')).toBeVisible();
	// kóty v detaile výplne teraz nesú PREPÍSANÉ hodnoty, nie dopočítané (726/3411).
	// #146 bod 1: bez "mm" — presná zhoda, nie substring.
	await expect(
		page.locator('[data-testid="pn-panel-detail"] text', { hasText: /^700$/ })
	).toBeVisible();
	await expect(
		page.locator('[data-testid="pn-panel-detail"] text', { hasText: /^3000$/ })
	).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});

// review nález (#138): zaškrtnutý zvod na vysokom stĺpe + neskoršie zníženie počtu
// polí by inak nechalo v stave zaniknutý zvod (checkbox už nie je v UI vidno), server
// by odoslanie odmietol s neintuitívnou chybou — zníženie počtu polí ho musí zahodiť
test('zníženie počtu polí po zaškrtnutí zvodu na zaniknutom stĺpe: odoslanie prejde bez chyby', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
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
	expect(consoleMsgs).toEqual([]);
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

// #145: nadpisy pohľadov (PREDNÝ POHĽAD / REZ A) kreslené na y={r.y - 1} kolidovali
// s hornou rastrovou lištou hárku (r.y pre tieto dva top-row pohľady == oblast.y ==
// presne dolná hranica lišty; "-1" skončí VNÚTRI nej). Zmerané cez getBoundingClientRect
// vo vlastnom review komentári na #145 (bbox nadpisu takmer identický s bbox čísla
// stĺpca v hornej lište). Regresný test overuje priamo to isté meranie: nadpis musí
// byť CELÝ POD hornou rastrovou lištou (jeho top >= spodná hranica lišty).
test('regresia #145: nadpisy PREDNÝ POHĽAD / REZ A nekolidujú s hornou rastrovou lištou', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	// horná rastrová lišta — čísla stĺpcov majú rovnakú y-pozíciu naprieč celým
	// riadkom (líši sa len x), takže ľubovoľné jedno stačí ako referenčná spodná
	// hranica lišty
	const gridTopNumber = page.locator('[data-testid="mriezka-stlpce"] text').first();
	const gridBox = await gridTopNumber.boundingBox();
	expect(gridBox).not.toBeNull();

	for (const heading of ['PREDNÝ POHĽAD', 'REZ A']) {
		const headingBox = await page
			.locator('[data-testid="vykresovy-harok"] text', { hasText: heading })
			.first()
			.boundingBox();
		expect(headingBox, `bounding box pre nadpis "${heading}"`).not.toBeNull();
		// nadpis musí začínať AŽ POD hornou rastrovou lištou (žiadny vertikálny prekryv)
		expect(
			headingBox!.y,
			`nadpis "${heading}" (top=${headingBox!.y}) koliduje s hornou rastrovou lištou (spodná hranica=${gridBox!.y + gridBox!.height})`
		).toBeGreaterThanOrEqual(gridBox!.y + gridBox!.height);
	}
	expect(consoleMsgs).toEqual([]);
});

// #150 — farebný režim výkresu podľa RAL
const attr = (page: Page, testid: string, name: string) =>
	page.getByTestId(testid).getAttribute(name);

test('#150/#153: technický režim (default) — konštrukcia svetlá s čiernym obrysom (nezmenené farby, #153 zjednotilo strecha/predok v REZ A na rovnaký obrysový kontrakt)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/navrh');
	await page.getByLabel('OP číslo').fill('OP260032');
	// default je "Technický (čiernobiely)" — netreba nič prepínať
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	expect(await attr(page, 'pn-elevation-strecha', 'fill')).toBe('#eff6ff');
	expect(await attr(page, 'pn-elevation-post-0', 'fill')).toBe('#fff');
	// #153: predtým '#0f172a' (plný čierny silueta) — teraz rovnaká svetlá fill ako
	// elevation (rovnaký fyzický prvok, iný pohľad) + VŽDY viditeľný čierny obrys
	expect(await attr(page, 'pn-section-strecha', 'fill')).toBe('#eff6ff');
	expect(await attr(page, 'pn-section-predok', 'fill')).toBe('#fff');
	expect(await attr(page, 'pn-section-predok', 'stroke')).toBe('#0f172a');
	expect(await attr(page, 'pn-iso-hrany', 'stroke')).toBe('#0f172a');

	expect(consoleMsgs).toEqual([]);
});

// #153 (šéf: "ostrejšie kontúry, pôsobí to rozmazane") — root cause bola PRÁVE táto
// dvojica javov: (1) fill=CIERNA priamo na strecha/predok v REZ A (plný čierny tvar),
// (2) stred-zarovnaný stroke ŠIRŠÍ než reálna nakreslená hrúbka profilu (stĺp
// STLP_HRUBKA_VIZ_MM=100mm pri vzorovej mierke ≈1,6-1,65mm), ktorý zhltol aj správne
// nastavenú svetlú fill. Tento test priamo overuje OBRYSOVÝ kontrakt — každý
// konštrukčný tvar musí mať stroke-width MENŠÍ než jeho rozmer (viditeľná svetlá
// výplň dnu = "obrys", nie "plný pás"), čierny obrys a hrúbku viditeľne HRUBŠIU než
// hlavná kótová čiara (hierarchia "konštrukcia > kóty ~2:1" — #146/#153).
test('#153: konštrukčné prvky sú OBRYSOVÉ profily (svetlá výplň + čierny obrys), nie plné pásy — technický režim', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await vyplnFormular(page);
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	// elevation — strecha (rect, previs zarátaný do width) + prvý stĺp
	for (const testid of ['pn-elevation-strecha', 'pn-elevation-post-0']) {
		const el = page.getByTestId(testid);
		const w = parseFloat((await el.getAttribute('width')) ?? '0');
		const h = parseFloat((await el.getAttribute('height')) ?? '0');
		const sw = parseFloat((await el.getAttribute('stroke-width')) ?? '0');
		const menšiRozmer = Math.min(w, h);
		expect(menšiRozmer, `${testid}: menší rozmer tvaru`).toBeGreaterThan(0);
		expect(
			sw,
			`${testid}: stroke-width (${sw}) musí byť menší než rozmer tvaru (${menšiRozmer}), inak fill zmizne (obrys namiesto plného pásu)`
		).toBeLessThan(menšiRozmer);
		expect(await el.getAttribute('shape-rendering'), `${testid}: crisp osovo zarovnaný rect`).toBe(
			'crispEdges'
		);
	}

	// section (REZ A) — predný stĺp je rovnako osovo zarovnaný rect
	{
		const el = page.getByTestId('pn-section-predok');
		const w = parseFloat((await el.getAttribute('width')) ?? '0');
		const h = parseFloat((await el.getAttribute('height')) ?? '0');
		const sw = parseFloat((await el.getAttribute('stroke-width')) ?? '0');
		expect(sw).toBeLessThan(Math.min(w, h));
		expect(await el.getAttribute('shape-rendering')).toBe('crispEdges');
	}

	// section — strešný profil je ŠIKMÁ cesta (podľa sklonu strechy) — NESMIE mať
	// crispEdges (zúbkovala by sa diagonála), ale MUSÍ mať rovnaký obrysový kontrakt
	{
		const el = page.getByTestId('pn-section-strecha');
		expect(await el.getAttribute('fill')).not.toBe('#0f172a');
		expect(await el.getAttribute('stroke')).toBe('#0f172a');
		expect(await el.getAttribute('shape-rendering')).not.toBe('crispEdges');
	}

	// izometrické hrany (diagonálne z princípu) tiež bez crispEdges
	expect(await attr(page, 'pn-iso-hrany', 'shape-rendering')).not.toBe('crispEdges');

	// hierarchia hrúbok: hlavný konštrukčný obrys je viditeľne HRUBŠÍ než hlavná
	// kótová čiara (Kota.svelte stroke-width 0.7 na g[data-testid="kota"]). Meria sa
	// na STRESNOM ráme (pn-elevation-strecha), nie na stĺpe — `obrysStroke()` (review
	// nález nižšie) môže stĺp per-vstup zoštíhliť POD hierarchickú hranicu, kým
	// strecha/nosník má vlastnú spodnú hranicu hrúbky (NOSNIK_HRUBKA_MM=190mm,
	// roofH≥1,5mm) vždy nad STRUKTURA_STROKE — bezpečná referencia pre tento pomer.
	const strukturaSw = parseFloat(
		(await page.getByTestId('pn-elevation-strecha').getAttribute('stroke-width')) ?? '0'
	);
	const kotaSw = parseFloat(
		(await page.getByTestId('kota').first().getAttribute('stroke-width')) ?? '0'
	);
	expect(kotaSw).toBeGreaterThan(0);
	expect(
		strukturaSw / kotaSw,
		`pomer konštrukcia/kóty (${strukturaSw}/${kotaSw}) musí byť viditeľne > 1 (hierarchia #146/#153)`
	).toBeGreaterThan(1.5);
	expect(consoleMsgs).toEqual([]);
});

// review nález (#153, deep-review pred mergom): pevná STRUKTURA_STROKE=1,2mm bola
// bezpečná len pri VZOROVEJ mierke OP260032 — `stlpHalfW()` má vlastnú spodnú
// hranicu 0,5mm (polovica), teda stĺp/predný stĺp v reze môže pri hĺbke/výške
// bližšie k hornej hranici validného vstupu (HLBKA_MAX=10000, VYSKA_MAX=4500)
// reálne vyjsť už len 1,0mm ŠIROKÝ — ŠIRŠÍ obrys než 1,2mm by fill znova celý
// zhltol (presne ten istý bug, ktorý #153 malo opraviť), navyše NOVÁ regresia pre
// farebný RAL režim (predtým vždy bezpečná tenká STRUKTURA_STROKE_VEDLAJSIA=0,4mm
// v OBOCH režimoch). `obrysStroke()` fix: obrys nikdy nepresiahne polovicu rozmeru
// tvaru — tento test priamo overuje EXTRÉMNY (ale validný) vstup, kde by sa bez
// tohto fixu fill znova stratil.
test('#153 review nález: fill neostáva zhltnutý pri extrémnych (ale validných) rozmeroch — technický aj farebný režim', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/navrh');
	// 3 polia × 3000mm = 9000mm celková šírka (elevation swallow nad ~8250mm),
	// hĺbka 6000mm (section-predok swallow nad ~5844mm, pri ĽUBOVOĽNEJ výške)
	await page.selectOption('#pocetPoli', '3');
	await page.getByLabel('Rozpätie 1 (mm)').fill('3000');
	await page.getByLabel('Rozpätie 2 (mm)').fill('3000');
	await page.getByLabel('Rozpätie 3 (mm)').fill('3000');
	await page.getByLabel('Hĺbka (mm) *').fill('6000');
	await page.getByLabel('Výška vpredu (mm) *').fill('2500');
	await page.getByLabel('Výška pri stene (mm) *').fill('2800');

	const overObrys = async (testid: string) => {
		const el = page.getByTestId(testid);
		const w = parseFloat((await el.getAttribute('width')) ?? '0');
		const h = parseFloat((await el.getAttribute('height')) ?? '0');
		const sw = parseFloat((await el.getAttribute('stroke-width')) ?? '0');
		const menšiRozmer = Math.min(w, h);
		expect(menšiRozmer, `${testid}: menší rozmer tvaru pri extrémnom vstupe`).toBeGreaterThan(0);
		expect(
			sw,
			`${testid}: stroke-width (${sw}) musí byť menší než rozmer tvaru (${menšiRozmer}) aj pri extrémnom vstupe — inak fill zmizne`
		).toBeLessThan(menšiRozmer);
	};

	// technický režim (default)
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);
	await overObrys('pn-elevation-post-0');
	await overObrys('pn-section-predok');

	// farebný RAL režim — predtým TOTO bolo vždy bezpečné (STRUKTURA_STROKE_VEDLAJSIA
	// v celom rozsahu vstupu), unifikácia #153 to muselo overiť/zachovať
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.getByLabel('RAL odtieň').selectOption('7016');
	await page.getByRole('radio', { name: 'Farebný (podľa RAL)' }).check();
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);
	await overObrys('pn-elevation-post-0');
	await overObrys('pn-section-predok');
	expect(consoleMsgs).toEqual([]);
});

test('#150: farebný režim + známy RAL (7016 ANTRACIT) — konštrukcia sa vyfarbí, kóty/poznámky ostávajú', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/navrh');
	await page.getByLabel('OP číslo').fill('OP260032');
	await page.getByLabel('RAL odtieň').selectOption('7016');
	await expect(page.getByTestId('ral-swatch')).toBeVisible();
	await page.getByRole('radio', { name: 'Farebný (podľa RAL)' }).check();
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	// konštrukcia vyfarbená na skutočný hex 7016 ANTRACIT
	expect(await attr(page, 'pn-elevation-strecha', 'fill')).toBe('#383E42');
	expect(await attr(page, 'pn-elevation-post-0', 'fill')).toBe('#383E42');
	expect(await attr(page, 'pn-section-strecha', 'fill')).toBe('#383E42');
	expect(await attr(page, 'pn-section-predok', 'fill')).toBe('#383E42');
	// existujúci tmavý obrys ostáva (nezmizne pri farebnej výplni)
	expect(await attr(page, 'pn-section-predok', 'stroke')).toBe('#0f172a');
	// izometria — tmavý odtieň sa NEmení (nie je tmavyObrys)
	expect(await attr(page, 'pn-iso-hrany', 'stroke')).toBe('#383E42');
	// izometrické drôtené hrany sú stále rovnaký POČET ako v technickom režime
	// (žiadne zdvojenie elementov — pozri design komentár na #150)
	await expect(page.getByTestId('pn-iso-hrany').locator('line')).toHaveCount(17);

	// kóty ostávajú modré, RAL poznámka ostáva červená a odráža výber
	await expect(page.getByTestId('pn-ral')).toHaveCSS('fill', 'rgb(220, 38, 38)');
	await expect(page.getByTestId('pn-ral')).toContainText('RAL: 7016 ANTRACIT');

	expect(consoleMsgs).toEqual([]);
});

test('#150: svetlý RAL (9006 STRIEBORNÁ) — filled prvky majú svetlú výplň s tmavým obrysom, izometria je stmavená (nezmizne na bielom)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/navrh');
	await page.getByLabel('OP číslo').fill('OP260032');
	await page.getByLabel('RAL odtieň').selectOption('9006');
	await page.getByRole('radio', { name: 'Farebný (podľa RAL)' }).check();
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	// filled tvary — svetlá výplň, existujúci CIERNA stroke drží obrys viditeľný
	expect(await attr(page, 'pn-elevation-post-0', 'fill')).toBe('#A5A8A6');
	expect(await attr(page, 'pn-elevation-post-0', 'stroke')).toBe('#0f172a');
	expect(await attr(page, 'pn-section-predok', 'fill')).toBe('#A5A8A6');
	expect(await attr(page, 'pn-section-predok', 'stroke')).toBe('#0f172a');

	// regresia (nález pri vizuálnej iterácii #150, prekalibrované #153): stĺpy sú
	// pri bežnej mierke UŽŠIE než pôvodná hrubá STRUKTURA_STROKE (1,8mm, teraz
	// 1,2mm) — stred-zarovnaný SVG stroke by mohol prekryť CELÚ fill plochu a
	// stĺp by vyšiel vždy čierny bez ohľadu na RAL. Vo farebnom režime MUSÍ byť
	// stroke-width < šírka tvaru, inak je fill neviditeľný (rovnaký kontrakt teraz
	// platí aj v technickom režime — priamy test #153 nižšie).
	for (const testid of ['pn-elevation-post-0', 'pn-section-predok']) {
		const w = parseFloat((await attr(page, testid, 'width')) ?? '0');
		const sw = parseFloat((await attr(page, testid, 'stroke-width')) ?? '0');
		expect(w, `${testid}: šírka tvaru`).toBeGreaterThan(0);
		expect(
			sw,
			`${testid}: stroke-width (${sw}) musí byť menší než šírka tvaru (${w}), inak fill zmizne`
		).toBeLessThan(w);
	}
	// izometria (bez fill) — stroke sa STMAVIL, nie je to surová #A5A8A6 (zmizla by
	// na bielom hárku)
	const isoStroke = await attr(page, 'pn-iso-hrany', 'stroke');
	expect(isoStroke).not.toBe('#A5A8A6');
	expect(isoStroke).toMatch(/^#[0-9a-f]{6}$/i);
	expect(consoleMsgs).toEqual([]);
});

test('#150: "iný…" RAL — voľný text, farebný režim použije neutrálnu tmavosivú a povie to', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/navrh');
	await page.getByLabel('OP číslo').fill('OP260032');
	await page.getByLabel('RAL odtieň').selectOption('iny');
	await expect(page.getByTestId('ral-iny-hint')).toContainText('neutrálnu tmavosivú');
	await page.getByLabel('RAL — vlastný text').fill('RAL 7021 matná');
	await expect(page.getByTestId('ral-swatch')).toBeVisible();
	await page.getByRole('radio', { name: 'Farebný (podľa RAL)' }).check();
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	expect(await attr(page, 'pn-elevation-post-0', 'fill')).toBe('#4b5563');
	await expect(page.getByTestId('pn-ral')).toContainText('RAL: RAL 7021 matná');
	expect(consoleMsgs).toEqual([]);
});

test('#150 review nález: zrušenie výberu RAL ("— nevybraté —") vymaže aj červenú poznámku — neostáva starý odtieň', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/navrh');
	await page.getByLabel('OP číslo').fill('OP260032');
	await page.getByLabel('RAL odtieň').selectOption('7016');
	await expect(page.getByLabel('RAL odtieň')).toHaveValue('7016');

	// späť na „— nevybraté —" — swatch aj hint zmiznú, poznámka sa nesmie „zaseknúť"
	// na starej hodnote „7016 ANTRACIT"
	await page.getByLabel('RAL odtieň').selectOption('');
	await expect(page.getByTestId('ral-swatch')).not.toBeVisible();

	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	// vstup.ral je prázdny → celý <text data-testid="pn-ral"> sa nevykresľuje
	await expect(page.getByTestId('pn-ral')).not.toBeAttached();
	expect(consoleMsgs).toEqual([]);
});

test('#150: prepnutie technický ↔ farebný na tej istej kresbe (Späť a upraviť) mení farby bez straty ostatného vstupu', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await vyplnFormular(page); // "iný…" RAL "7016-ANTRACIT JŠ", technický (default)
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);
	expect(await attr(page, 'pn-elevation-post-0', 'fill')).toBe('#fff');

	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	// vstup sa nevynuloval — OP aj RAL voľný text ostali
	await expect(page.getByLabel('OP číslo')).toHaveValue('OP260032');
	await expect(page.getByLabel('RAL — vlastný text')).toHaveValue('7016-ANTRACIT JŠ');

	await page.getByRole('radio', { name: 'Farebný (podľa RAL)' }).check();
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);
	// "iný" RAL bez známeho hexu → neutrálny fallback
	expect(await attr(page, 'pn-elevation-post-0', 'fill')).toBe('#4b5563');
	expect(consoleMsgs).toEqual([]);
});

test('#150: tlač zachováva farbu (print-color-adjust: exact na výkresovom hárku)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/pergola/navrh');
	await page.getByLabel('OP číslo').fill('OP260032');
	await page.getByLabel('RAL odtieň').selectOption('7016');
	await page.getByRole('radio', { name: 'Farebný (podľa RAL)' }).check();
	await page.getByTestId('nakreslit').click();
	await waitHydrated(page);

	await page.emulateMedia({ media: 'print' });
	const hodnota = await page.getByTestId('vykresovy-harok').evaluate((el) => {
		const cs = getComputedStyle(el);
		return (
			cs.getPropertyValue('print-color-adjust') || cs.getPropertyValue('-webkit-print-color-adjust')
		);
	});
	expect(hodnota.trim()).toBe('exact');

	// #153 bod 3: obrysové profily (crispEdges, tenšia STRUKTURA_STROKE) nesmú
	// zaviesť žiadny raster do tlačového/PDF výstupu — celý hárok ostáva čisto
	// vektorový <svg> (rect/path/line/text), žiadny <image>/<canvas>, aj pod
	// print médiom (shape-rendering je len vykresľovací hint, nie rasterizácia).
	const vektorovyStav = await page.getByTestId('vykresovy-harok').evaluate((el) => ({
		raster: el.querySelectorAll('image, canvas, foreignObject').length,
		strechaTag: el.querySelector('[data-testid="pn-section-strecha"]')?.tagName,
		predokTag: el.querySelector('[data-testid="pn-section-predok"]')?.tagName
	}));
	expect(vektorovyStav.raster).toBe(0);
	expect(vektorovyStav.strechaTag).toBe('path');
	expect(vektorovyStav.predokTag).toBe('rect');

	await page.emulateMedia({ media: 'screen' });
	expect(consoleMsgs).toEqual([]);
});
