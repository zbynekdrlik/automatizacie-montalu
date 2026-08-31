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
	// rozmer sieťoviny je Štandardova +3/+3 formula (sklo 957×1735 → 960×1738)
	await expect(page.getByTestId('sietka-rozmer')).toHaveText('960 × 1738 mm');

	const so = await odpisRiadky(page);
	expect(so).not.toEqual(bez);
	// šírka prírezov (ZASP202415) ide z 6 na 8 ks — presne Patrikov nárezák
	const sirka = so.find((r) => r.includes('ZASP202415'))!;
	expect(sirka).toBeTruthy();
	expect(sirka).not.toBe(bez.find((r) => r.includes('ZASP202415')));

	expect(errs).toEqual([]);
});

test('Štandard + posuv + STARÝ systém sieťky: krajová/dorazová idú s cudzím kódom, šírka prírezov +16,5mm', async ({
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
	await page.selectOption('#sklo', 'Izolačné sklo 4.8.4');
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
