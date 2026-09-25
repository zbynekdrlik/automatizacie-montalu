// Sieťka na Štandarde / Štandard + (#110) — Patrik, Odoo kanál 207, 2026-08-03.
// Rovnaký vzor ako e2e/sietka.spec.ts (Robust/Slide), plus #110-špecifický výber
// SYSTÉMU sieťky, ktorý na Robust/Slide vôbec neexistuje.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated, vyberFarbuKovania } from './helpers';

async function zaklad(page: Page, zak: string, zakaznik: string, system = 'Štandard +') {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill(zakaznik);
	await page.selectOption('#system', system);
	await page.selectOption('#styl', '3K');
	await page.locator('#s').fill('3000');
	await page.locator('#v').fill('1850');
}

async function odpisRiadky(page: Page): Promise<string[]> {
	const karta = page.locator('.card', { hasText: 'Odpis (do Money)' }).first();
	return (await karta.locator('.row').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
}

/** #569: kladkový profil (ZASP202415) z NÁREZ riadka („6×952 mm + 2×936 mm") → základný rez
 *  posuvu (najväčší počet ks) a rez sieťky (2 ks, keď je sieťka iného systému). Relačné —
 *  post-deploy beží proti PROD cfg (editor vzorcov), nikdy pevný mm literál (testing.md). */
async function kladkoveRezy(page: Page): Promise<{ posuv: number; sietka: number | null }> {
	const txt = (await page.getByRole('row', { name: /Rez profilu ZASP202415/ }).textContent()) ?? '';
	const rezy = [...txt.matchAll(/(\d+)×(\d+(?:,\d+)?) mm/g)].map((m) => ({
		ks: Number(m[1]),
		rozmer: Number(m[2]!.replace(',', '.'))
	}));
	if (!rezy.length) throw new Error(`kladkoveRezy: nečakaný nárez riadok „${txt}"`);
	const posuv = rezy.reduce((a, b) => (b.ks > a.ks ? b : a));
	const ine = rezy.filter((r) => r !== posuv);
	return { posuv: posuv.rozmer, sietka: ine.length ? ine[0]!.rozmer : null };
}

/** „969 × 1738 mm" (sieťovina, fmtM) aj „966mm × 1735mm" (sklo, fmtSkloRozmer) → čísla. */
function rozmer(text: string | null): { sirka: number; vyska: number } {
	const m = (text ?? '').match(/(\d+)\s*(?:mm)?\s*×\s*(\d+)/);
	if (!m) throw new Error(`rozmer: nečakaný text „${text}"`);
	return { sirka: Number(m[1]), vyska: Number(m[2]) };
}

test('Štandard +: sieťka je ponúkaná, výber systému sieťky sa objaví AŽ po zapnutí', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.selectOption('#system', 'Štandard +');
	await expect(page.locator('#sietka-on')).toBeVisible();
	await expect(page.locator('#sietka-system')).toHaveCount(0);
	await page.locator('#sietka-on').check();
	await expect(page.locator('#sietka-system')).toBeVisible();

	expect(errs).toEqual([]);
});

test('Štandard + posuv, rovnaký systém sieťky: 4 krídla v náhľade, presná Money delta z Patrikovho nárezáka', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-STD', 'E2E Sietka standard');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	const bez = await odpisRiadky(page);

	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.locator('#sietka-on').check();
	// systém sieťky sa NEMENÍ — ostáva rovnaký ako posuv (predvolené)
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// 4. krídlo v náhľade (3K + sieťka)
	await expect(page.getByTestId('nahlad-sietka')).toBeVisible();
	// karta ukáže systém sieťky = rovnaký ako posuv
	await expect(page.getByTestId('sietka-system')).toHaveText('Štandard +');
	// rozmer sieťoviny (#569: z rámu posuvu — kladkový + R, základné sklo V + H) je zobrazený;
	// presné mm overuje unit tabuľka (sietka-standard-569.test.ts), E2E je relačné (PROD cfg)
	await expect(page.getByTestId('sietka-rozmer')).toHaveText(/^\d+ × \d+ mm$/);

	const so = await odpisRiadky(page);
	expect(so).not.toEqual(bez);
	// šírka prírezov (ZASP202415) ide z 6 na 8 ks — presne Patrikov nárezák
	const sirka = so.find((r) => r.includes('ZASP202415'))!;
	expect(sirka).toBeTruthy();
	expect(sirka).not.toBe(bez.find((r) => r.includes('ZASP202415')));

	expect(errs).toEqual([]);
});

test('Štandard + posuv + STARÝ systém sieťky: krajová/dorazová idú s cudzím kódom, šírka prírezov sieťky DLHŠIA (+K)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-CROSS', 'E2E Sietka cross');
	await page.locator('#sietka-on').check();
	await expect(page.locator('#sietka-system')).toBeVisible();
	await page.locator('#sietka-system').selectOption('Štandard');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await expect(page.getByTestId('sietka-system')).toHaveText('Štandard');

	const odpis = (await odpisRiadky(page)).join(' | ');
	// starý koncový (ZASP00018) a starý doraz (ZASP00021) sa objavia v odpise —
	// kódy, ktoré Štandard + posuv sám o sebe nikdy nemá
	expect(odpis).toContain('ZASP00018');
	expect(odpis).toContain('ZASP00021');
	// nárez šírky prírezov (ZASP202415, zdieľaná z posuvu): starý rám je o K užší než plus,
	// takže 2 ks sieťky sú DLHŠIE než rez posuvu (seed: 942,5+16,5 = 959 vs 943) — relačne
	const kl = await kladkoveRezy(page);
	expect(kl.sietka).not.toBeNull();
	expect(kl.sietka!).toBeGreaterThan(kl.posuv);

	expect(errs).toEqual([]);
});

test('OPAČNÝ smer — STARÝ posuv + Štandard+ systém sieťky: šírka prírezov sieťky KRATŠIA (−K, #569)', async ({
	page
}) => {
	// #569 (Patrik, Odoo úloha 1070): „starý štandard sieťka plus ZASP202415 … má byť o 16mm
	// menšia voči posuvu" — plus rám je o K širší, takže kladkový sieťky je o K KRATŠÍ.
	// (Issue 416 to čítal ako +16,5 aj v tomto smere — chybne.)
	const errs = collectConsole(page);
	await loginAs(page);

	// posuv = STARÝ Štandard, sieťka = Štandard + (opačne než confirmed test vyššie)
	await zaklad(page, 'E2E-SIETKA-REV', 'E2E Sietka reverz', 'Štandard');
	await page.locator('#sietka-on').check();
	await expect(page.locator('#sietka-system')).toBeVisible();
	await page.locator('#sietka-system').selectOption('Štandard +');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	await expect(page.getByTestId('sietka-system')).toHaveText('Štandard +');

	const odpis = (await odpisRiadky(page)).join(' | ');
	// plus-systémové kódy (koncový ZASP20244, dorazová ZASP202419) sa objavia ako
	// cudzie riadky — starý Štandard posuv ich sám o sebe nemá
	expect(odpis).toContain('ZASP20244');
	expect(odpis).toContain('ZASP202419');
	// nárez šírky prírezov (ZASP202415): základných 6 ks posuvu + 2 ks sieťky KRATŠIE
	// (seed: round(952,33−16,5) = 936 vs 952) — relačne
	const kl = await kladkoveRezy(page);
	expect(kl.sietka).not.toBeNull();
	expect(kl.sietka!).toBeLessThan(kl.posuv);

	expect(errs).toEqual([]);
});

test('#569: IZO sklo sieťku NEzmenší — sieťovina z rámu posuvu je rovnaká pri základnom aj izolačnom skle', async ({
	page
}) => {
	// Patrik (úloha 1070): „izolačné sklá majú rozširovací profil ale do sieťky nejde a preto
	// ak sieťku odvíja od skla … je automaticky malá". Sieťka sa odvíja od rámu → IZO sklo
	// (menšie) na ňu nemá vplyv. Relačne z DOM, žiadne seed mm.
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-IZO', 'E2E Sietka IZO', 'Štandard');
	await page.selectOption('#sklo', 'Float sklo 4 mm');
	await page.locator('#sietka-on').check();
	await page.locator('#sietka-system').selectOption('Štandard +');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	const skloBasic = rozmer(await page.getByTestId('sklo-rozmer').textContent());
	const sietBasic = rozmer(await page.getByTestId('sietka-rozmer').textContent());
	const klBasic = await kladkoveRezy(page);

	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.selectOption('#sklo', 'Izolačné sklo 4/8/4 číre');
	await expect(page.getByTestId('narezak-hint')).toContainText('IZO');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	const skloIzo = rozmer(await page.getByTestId('sklo-rozmer').textContent());
	const sietIzo = rozmer(await page.getByTestId('sietka-rozmer').textContent());

	// IZO sklo JE menšie (rozširovací profil) …
	expect(skloIzo.sirka).toBeLessThan(skloBasic.sirka);
	expect(skloIzo.vyska).toBeLessThan(skloBasic.vyska);
	// … sieťka NIE (predtým bola o 23 × 20 mm menšia)
	expect(sietIzo).toEqual(sietBasic);
	// a kladkový sieťky (Money) je v oboch rovnaký
	expect(await kladkoveRezy(page)).toEqual(klBasic);

	expect(errs).toEqual([]);
});

test('Slide: sieťka nemá výber systému (len Štandard/Štandard + ho majú)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await page.selectOption('#system', 'Slide');
	await page.selectOption('#styl', '3K');
	await page.locator('#sietka-on').check();
	await expect(page.getByTestId('sietka-box')).toBeVisible();
	await expect(page.locator('#sietka-system')).toHaveCount(0);

	expect(errs).toEqual([]);
});

test('výber systému sieťky prežije „← Späť a upraviť"', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-BACK', 'E2E Sietka spat');
	await page.locator('#sietka-on').check();
	await page.locator('#sietka-system').selectOption('Štandard');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);

	await expect(page.locator('#sietka-on')).toBeChecked();
	await expect(page.locator('#sietka-system')).toHaveValue('Štandard');

	expect(errs).toEqual([]);
});

// #91: 2K posuv nemá voľnú koľaj pre sieťku — appka mala VŽDY vymeniť koľajnicu na
// 3K, ale pre Štandard/Štandard + (delená horná+spodná) to bol tichý no-op, hoci
// hláška tvrdila opak. Overuje SKUTOČNÝ odpis (nie len text upozornenia).
test('Štandard + 2K + sieťka: nárezák aj odpis PRIDÁ 3K koľajnicu (hornú aj spodnú), hláška sedí s realitou (#91)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-STD-2K', 'E2E Sietka standard 2K');
	await page.selectOption('#styl', '2K');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	const bez = await odpisRiadky(page);
	expect(bez.join(' ')).toContain('Koľajnica horná 2K');
	expect(bez.join(' ')).toContain('Koľajnica spodná 2K');

	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.locator('#sietka-on').check();
	// hláška MUSÍ hovoriť o dvoch ODLIŠNÝCH koľajniciach (delená), nie „2 ks + 2 ks"
	await expect(page.getByTestId('sietka-2k-warn')).toContainText('hornú aj spodnú');

	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	await expect(page.getByTestId('sietka-2k-warn-karta')).toContainText('hornú aj spodnú');

	const so = (await odpisRiadky(page)).join(' ');
	expect(so).toContain('Koľajnica horná 3K');
	expect(so).toContain('Koľajnica spodná 3K');
	expect(so).not.toContain('Koľajnica horná 2K');
	expect(so).not.toContain('Koľajnica spodná 2K');

	expect(errs).toEqual([]);
});

// #91 nález 1 (adversariálna revízia PR #122): predošlý test necháva default
// NEizolačné sklo — presne to, prečo diera z nálezu 1 (IZO sklo vôbec
// nespúšťa 3K výmenu) prešla nezistená. Na Štandarde/Štandard + rozhoduje
// o IZO/basic nárezáku ZVOLENÉ SKLO (`sysStylPre`), nie štýl-select — appka
// dostane vnútorne `styl = '2K IZO'`, kým hláška aj nárezák-hint sa riadia
// štýl-selectom ('2K'). Test ide cez REÁLNY formulár (vrátane výberu skla),
// nie priamo cez compute funkcie.
test('Štandard + 2K + IZO sklo + sieťka: nárezák-hint aj hláška sedia, odpis reálne PRIDÁ 3K IZO koľajnicu (#91 nález 1)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-SIETKA-STD-2K-IZO', 'E2E Sietka standard 2K IZO');
	await page.selectOption('#styl', '2K');
	// v44 (#504): 'Izolačné sklo 4.8.4' zmazané (orphan) → surviving v43 IZO
	// variant rovnakej 16mm triedy (jeIzoTrieda ⇒ true, rovnaké odvodené hodnoty).
	await page.selectOption('#sklo', 'Izolačné sklo 4/8/4 číre');
	// nárezák-hint potvrdzuje, že appka interne počíta s '2K IZO', nie holým '2K'
	await expect(page.getByTestId('narezak-hint')).toContainText('Štandard + 2K IZO');

	await page.locator('#sietka-on').check();
	// hláška MUSÍ hovoriť o dvoch ODLIŠNÝCH koľajniciach (delená), rovnako ako bez IZO
	await expect(page.getByTestId('sietka-2k-warn')).toContainText('hornú aj spodnú');

	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	await expect(page.getByTestId('sietka-2k-warn-karta')).toContainText('hornú aj spodnú');

	const so = (await odpisRiadky(page)).join(' ');
	// skutočný odpis MUSÍ ísť na 3K (Money kritické — nález 1 bol presne tento
	// no-op, hláška klamala, kým odpis ostal na 2K)
	expect(so).toContain('Koľajnica horná 3K');
	expect(so).toContain('Koľajnica spodná 3K');
	expect(so).not.toContain('Koľajnica horná 2K');
	expect(so).not.toContain('Koľajnica spodná 2K');

	expect(errs).toEqual([]);
});
