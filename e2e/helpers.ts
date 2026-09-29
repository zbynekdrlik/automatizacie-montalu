import { expect, test, type Locator, type Page } from '@playwright/test';

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

// #325: /konfigurator teraz montuje 3D náhľad (lazy three.js chunk + HDRI) pri KAŽDOM
// loade. Keď test naviguje PREČ, kým je chunk/HDRI ešte v lete, prehliadač request ZRUŠÍ
// a zaloguje `Failed to load resource: net::ERR_ABORTED` — benígny artefakt navigácie
// (nie serverová chyba: 404/500 majú iný kód). Filter je EXACT na `net::ERR_ABORTED`,
// takže nikdy nezakryje skutočné zlyhanie fetchu (ERR_FAILED / HTTP status).
const NESKODNY_ABORT_VZOR = /Failed to load resource.*net::ERR_ABORTED/;

// #327: `WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost` je EXPLICITNÝ, SANKCIONOVANÝ
// teardown WebGL kontextu — prehliadač ho zaloguje VŽDY, keď appka zavolá
// `WEBGL_lose_context.loseContext()` (three.js `renderer.forceContextLoss()` pri unmounte /
// `{#key}` remounte 3D náhľadu — vizual3d.md „forceContextLoss je NEVRATNÉ, len pri odchode
// z komponentu"). NIE JE to
// pád GPU/OOM — ten Chrome loguje BEZ prefixu „loseContext:" (iná príčina straty kontextu).
// Preto je filter zakotvený na doslovný „loseContext: context lost" reťazec: zachytí len
// zámerný teardown, NIKDY reálnu chybu. Skutočne rozbitý 3D odhalia asserty „netriviálny
// render" (veľkosť PNG canvasu) + `data-viz-ready`, nie tento benígny warning.
const NESKODNY_CONTEXT_LOST_VZOR = /CONTEXT_LOST_WEBGL: loseContext: context lost/;

/** Zbiera console errors/warnings — každý test na konci overí, že je prázdne. */
export function collectConsole(page: Page): string[] {
	const messages: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error' || msg.type() === 'warning') {
			if (NESKODNY_GL_DRIVER_VZOR.test(msg.text())) return;
			if (NESKODNY_ABORT_VZOR.test(msg.text())) return;
			if (NESKODNY_CONTEXT_LOST_VZOR.test(msg.text())) return;
			messages.push(`[${msg.type()}] ${msg.text()}`);
		}
	});
	page.on('pageerror', (err) => messages.push(`[pageerror] ${err.message}`));
	return messages;
}

export const E2E_USER = process.env.E2E_USER || 'e2e';
export const E2E_PASS = process.env.E2E_PASS || 'e2e-heslo-123';

/**
 * #556 hotfix: HOLÝ názov skla z `<option>` textu. Nárezák `<option>` má `value` = holý lokálny
 * názov, ale TEXT nesie Odoo enrichment sufix „ · cenník: <Odoo name>" — a to LEN keď je Odoo
 * dostupné (PROD/post-deploy), nie v CI `test` jobe. Testy overujú MNOŽINU skiel (nie sufix), tak
 * porovnávajú `option.textContent` cez tento helper. Jediné miesto, kde sa sufix strippuje — platí
 * pre každý budúci Odoo enrichment popiskov v selecte. Bez sufixu vráti text nezmenený (len trim).
 */
export function bareSkloLabel(text: string): string {
	return text.split(' · cenník:')[0]!.trim();
}

/**
 * #579: selektor LOKÁLNYCH (výpočtových) volieb selectu „Sklo (základ)". Na PROD (Odoo dostupné)
 * select navyše ponúka Odoo typy skla podľa hrúbky systému (`value` s prefixom `odoo:`, skupiny
 * „Odoo — …"); v CI preview bez Odoo ich niet. Testy MNOŽINY lokálnej ponuky (allow-list #573,
 * IZO gate štýlu) preto čítajú `select.locator(LOKALNE_SKLA)`, nie všetky `option`.
 * #594: pri Odoo ponuke lokálne sklá NIE SÚ (len „Iné" / doplnková „pôvodné sklo z appky") —
 * množinu ponuky čítaj cez `ponukaSkla` (výpočtové sklá), nie cez tento selektor.
 */
export const LOKALNE_SKLA = 'option:not([value^="odoo:"])';

// ---- #594: „Sklo (základ)" pri dostupnom Odoo ponúka LEN Odoo typy (žiadne lokálne sklá) ----
//
// Každá `<option>` nesie `data-vypocet` = LOKÁLNE výpočtové sklo, ktorým sa voľba počíta (v CI
// bez Odoo = jej vlastný názov). Specy preto vyberajú a overujú sklo RELAČNE podľa výpočtového
// skla — rovnaký kód funguje v CI (lokálna záloha) aj v post-deploy proti PROD (Odoo typy).

const INE_SKLO = 'Iné (vlastná skladba)';

/** Hodnota voľby, ktorá sa počíta sklom `sklo` (lokálna voľba toho mena, inak PRVÁ Odoo voľba). */
async function hodnotaSkla(select: Locator, sklo: string): Promise<string | null> {
	return select.evaluate((el, sk) => {
		const opts = [...(el as HTMLSelectElement).options];
		const o = opts.find((x) => x.value === sk) ?? opts.find((x) => x.dataset.vypocet === sk);
		return o?.value ?? null;
	}, sklo);
}

/**
 * Vyber v selecte skla voľbu počítanú výpočtovým sklom `sklo` (alebo sentinel „Iné"). Počká, kým
 * ju (reaktívne prekreslená) ponuka má — ponuka závisí od systému/štýlu. Bez takej voľby test
 * PADNE (nikdy tichý výber iného skla).
 */
export async function vyberSklo(select: Locator, sklo: string): Promise<void> {
	await expect
		.poll(() => hodnotaSkla(select, sklo), { message: `ponuka nemá voľbu počítanú „${sklo}"` })
		.not.toBeNull();
	await select.selectOption((await hodnotaSkla(select, sklo))!);
}

/** Výpočtové sklo zvolenej voľby (v CI = jej názov; na PROD = sklo, ktorým sa Odoo typ počíta). */
export async function vypocetSkla(select: Locator): Promise<string> {
	return select.evaluate((el) => {
		const o = (el as HTMLSelectElement).selectedOptions[0];
		return o ? (o.dataset.vypocet ?? o.value) : '';
	});
}

/** Over, že select ukazuje voľbu počítanú sklom `sklo` (reaktívne — poll). */
export async function expectSklo(select: Locator, sklo: string): Promise<void> {
	await expect.poll(() => vypocetSkla(select)).toBe(sklo);
}

/**
 * Ponuka selectu skla: `odoo` = ponúka Odoo typy (post-deploy PROD), `vypocty` = RÔZNE výpočtové
 * sklá volieb v poradí (bez „Iné"). V CI (bez Odoo) sú `vypocty` presne lokálne sklá ponuky.
 */
export async function ponukaSkla(select: Locator): Promise<{ odoo: boolean; vypocty: string[] }> {
	const opts = await select.locator('option').evaluateAll((els) =>
		els.map((e) => ({
			value: (e as HTMLOptionElement).value,
			vypocet: (e as HTMLOptionElement).dataset.vypocet ?? (e as HTMLOptionElement).value
		}))
	);
	const vypocty = [...new Set(opts.filter((o) => o.value !== INE_SKLO).map((o) => o.vypocet))];
	return { odoo: opts.some((o) => o.value.startsWith('odoo:')), vypocty };
}

/**
 * Over ponuku voči očakávanej množine výpočtových skiel: bez Odoo PRESNE `ocakavane` (allow-list);
 * s Odoo (PROD) podmnožina `ocakavane` a neprázdna — Odoo ponúka len sklá, ktoré má (#594), takže
 * lokálne sklo bez Odoo typu v ponuke chýba zámerne.
 */
export function overPonukuSkla(p: { odoo: boolean; vypocty: string[] }, ocakavane: string[]): void {
	if (!p.odoo) {
		expect([...p.vypocty].sort()).toEqual([...ocakavane].sort());
		return;
	}
	expect(p.vypocty.length).toBeGreaterThan(0);
	for (const v of p.vypocty) expect(ocakavane, `Odoo voľba počítaná „${v}"`).toContain(v);
}

/**
 * #555 HOTFIX: očakávané rozmery joklov ODVODENÉ z rozmeru SIEŤOVINY zobrazeného na tej istej
 * stránke/karte (testid `sietka-rozmer` na karte zasklenia, `sietka-samostatna-rozmer` na
 * `/sietka`). Post-deploy E2E beží proti ŽIVEJ PROD cfg, kde sú Robust vzorce upravené editorom
 * (sklo/sieťovina o pár mm inak než seed) — takže PEVNÝ mm literál zo seed cfg je env-viazaný a
 * padne (main run 35588964456, deploy fail). Odvodenie z DOM je odolné voči zmene cfg editorom.
 *
 * Delty +10 / −22 a `ks` 4 sú JEDINÉ miesto v E2E, kde žijú — držia paritu s `JOKLE_DELTA` a
 * `JOKLE_KS` v `src/lib/sietka.ts` (import konštánt do E2E nie je možný bez buildu — Tier 0).
 * Paritu overuje unit test `tests/sietka-jokle.test.ts` („JOKLE_DELTA / JOKLE_KS — parita").
 *
 * Vstup je text rozmeru sieťoviny „1447 × 2116 mm" (fmtM, sieťovina má celé mm). Vzorec zhodný
 * s `rozmerJokle`: jokel.šírka = sieťovina.šírka + 10, jokel.výška = sieťovina.výška − 22.
 */
export function jokleZoSietoviny(rozmerText: string): { sirka: number; vyska: number; ks: number } {
	const m = rozmerText.match(/(\d+)\s*×\s*(\d+)/);
	if (!m) throw new Error(`jokleZoSietoviny: nečakaný text rozmeru sieťoviny „${rozmerText}"`);
	return { sirka: Number(m[1]) + 10, vyska: Number(m[2]) - 22, ks: 4 };
}

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
 * testovací odpis nesmie skončiť v ostrom Money importe.
 *
 * Používa Node.js `fetch()` namiesto `page.request.get()` kvôli stale-connection
 * bugu v post-deploy E2E cez SSH tunel: Playwright globálny `httpHappyEyeballsAgent`
 * (`keepAlive: true`, proces-wide singleton) pooluje TCP spojenia naprieč testami.
 * Na konkrétnom mieste (konfigurator-zasklenie test 2 → 3 browser-only testy →
 * konfigurator-zimna-zahrada test 3) znovupoužitie pooled socketu koinciduje so
 * serverovým keepAliveTimeout (5 s) close — cez SSH tunel sa FIN propaguje s oneskorením,
 * takže agent dispatchne na stale socket → "socket hang up" (CI runy 34454348804,
 * 34468718466; deterministic na TEJTO pozícii, nie každá medzera). Node.js `fetch()`
 * (undici Pool, `keepAliveTimeout: 4000` ms) proaktívne disposal idle spojení pred
 * server timeoutom a rešpektuje server hint, takže close-race nevznikne. `/health` je
 * verejný JSON GET bez session cookies a bez x-forwarded-* hlavičiek (CSRF je len POST). */
export async function skipAkLive(_page: Page) {
	const baseUrl = process.env.BASE_URL || 'http://localhost:4173';
	const res = await fetch(`${baseUrl}/health`);
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

/**
 * #392: „Používatelia" + „Odhlásiť" žijú v user menu (`<details data-testid=
 * "user-menu-toggle">`, uzavreté defaultne) — otvor ho pred kontrolou/klikom na
 * čokoľvek vnútri (nezávislé od dynamického username v summary textu).
 */
export async function openUserMenu(page: Page) {
	// #583: klik na summary PREPÍNA — už otvorené menu by druhý klik zavrel; otvor len zatvorené
	// stav `open` čítame jednorazovo → najprv hydratácia, nech ho už nič neprepíše
	await waitHydrated(page);
	const menu = page.locator('details.nav-user');
	if ((await menu.getAttribute('open')) === null)
		await page.getByTestId('user-menu-toggle').click();
	await expect(menu).toHaveAttribute('open', '');
}

/**
 * #392: „Nástroje" (Optimalizátor/Vzorce/História/Dopyty/Problém) je vždy dropdown
 * (`<summary data-testid="tools-menu-toggle">`) — testid, nie ARIA rola (naživo overené:
 * `<summary>` sa v tomto Chromiu/Playwright behu nesprával spoľahlivo ako
 * `getByRole('button', …)`, hoci HTML-AAM ju mapuje na "button").
 */
export async function openTools(page: Page) {
	await page.getByTestId('tools-menu-toggle').click();
}

/**
 * #592: „Pevné zasklenie" (Fix z appky / Fix z CADu / Zábradlia (CLIP)) je vnorený dropdown v
 * primárnej lište (desktop). Rovnako ako `openUserMenu`: summary klik PREPÍNA (#583), takže otvor
 * len zatvorené menu a najprv počkaj na hydratáciu.
 */
export async function openPevneZasklenie(page: Page) {
	await waitHydrated(page);
	const menu = page.locator('details.nav-pevne');
	if ((await menu.getAttribute('open')) === null)
		await page.getByTestId('pevne-menu-toggle').click();
	await expect(menu).toHaveAttribute('open', '');
}

/**
 * #392: „Odhlásiť" presunuté do user menu — otvor ho, klikni, počkaj na /login.
 * Nahrádza predošlé priame `page.getByRole('button', { name: 'Odhlásiť' }).click()`.
 */
export async function logout(page: Page) {
	// #583: po dlhom náhľade (plný POST → nový dokument) počkaj na hydratáciu a na VIDITEĽNÚ položku
	// menu pred klikom — pád 0.25.50 bol klik na položku zavretého menu (`.card intercepts…`).
	await waitHydrated(page);
	await openUserMenu(page);
	const odhlasit = page.getByRole('button', { name: 'Odhlásiť' });
	await expect(odhlasit).toBeVisible();
	await odhlasit.click();
	await expect(page).toHaveURL(/\/login/);
}

/**
 * #464: Stub `window.print()` — injektuje script PRED navigáciou, ktorý nahradí
 * `window.print` počítadlom. Volaj PRED `goto`/`loginAs`. Po kliku na print
 * tlačidlo zavolaj vrátený `assertPrintCalled()` na overenie, že `window.print`
 * bol volaný aspoň raz.
 */
export async function stubWindowPrint(page: Page) {
	await page.addInitScript(() => {
		(window as unknown as Record<string, number>).__printCallCount = 0;
		window.print = () => {
			(window as unknown as Record<string, number>).__printCallCount++;
		};
	});
	return {
		async assertPrintCalled() {
			const count = await page.evaluate(
				() => (window as unknown as Record<string, number>).__printCallCount
			);
			expect(count).toBeGreaterThan(0);
		}
	};
}

/**
 * #338: kovanie RS Robust/Štandard vyžaduje zvolenú RAL farbu — bez nej engine
 * odmietne odpis a náhľad sa nezobrazí. Tento pomocník zvolí farbu, keď je select
 * na obrazovke (Robust/Štandard, aj Deluxe — jeho krytky majú RAL variant), a je
 * NO-OP pri systémoch bez farebného kovania (Slide/Štandard +). Volaj ho PRED „Spočítať".
 *
 * BEZ explicitného `farba` argumentu (VŠETKY existujúce volania v e2e/*.spec.ts)
 * si zvolí PLATNÚ hodnotu z reálnych `<option>` na obrazovke namiesto natvrdo
 * `R9005` (#354). Deluxe ponúka krytky per HRÚBKA skla (#431 kolo 2: 6mm R9006/R9005,
 * 10mm R9006/R7016), takže natvrdo `R9005` by na 10mm Deluxe zlyhalo. Robust/Štandard
 * naďalej dostanú R9005 (prvá platná možnosť). Deluxe 10mm dostane R9006, Deluxe 6mm
 * (ak je R9005 v ponuke) R9005 — na deterministický výsledok posielaj `farba` explicitne.
 */
export async function vyberFarbuKovania(page: Page, farba?: 'R9005' | 'R9006' | 'R7016') {
	const sel = page.getByTestId('farba-kovania');
	if ((await sel.count()) === 0) return;
	if (farba) {
		await sel.selectOption(farba);
		return;
	}
	const hodnoty = (
		await sel
			.locator('option')
			.evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value))
	).filter(Boolean);
	await sel.selectOption(hodnoty.includes('R9005') ? 'R9005' : hodnoty[0]!);
}
