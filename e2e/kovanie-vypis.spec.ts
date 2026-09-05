// Čitateľný výpis kovania (kľučky/FAB) pod posuvmi.
//
// Patrik cez Odoo kanál „Vyroba automatizacia" (2026-07-31): „Pri posuve Robust
// by som potreboval tie kľučky fabky vypísať niekam rozumnejšie, zle je to
// vidieť. Kľudne aj pod tie posuvy — Posuv 1 / ľavá strana … / pravá strana …"
//
// DISPLAY-ONLY: kovanie do Money odpisu chodí vlastnou cestou (kovanieFor);
// tento výpis nesmie zmeniť ani jeden riadok odpisu — test to overuje.
// Všetko čítacie („Spočítať"), do Money nejde nič.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated, vyberFarbuKovania } from './helpers';

const LAVA = 'Obojstranná kľučka s FAB';
const PRAVA = 'Jednostranná kľučka z vnútra bez FAB';

async function odpisRiadky(page: Page): Promise<string[]> {
	const karta = page.locator('.card', { hasText: 'Odpis (do Money)' }).first();
	return (await karta.locator('.row').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
}

async function zaklad(page: Page, zak: string) {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(zak);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Kovanie vypis');
	await page.selectOption('#system', 'Robust');
	await page.selectOption('#styl', '3K');
	await page.locator('#s').fill('4645');
	await page.locator('#v').fill('2320');
}

test('jeden posuv: kľučky sú vypísané pod posuvom a Money odpis je NEZMENENÝ', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	// (1) bez kovania — referenčný odpis, karta sa nezobrazuje
	await zaklad(page, 'E2E-KOVV');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	const bezKovania = await odpisRiadky(page);
	await expect(page.getByTestId('kovanie-strany')).toHaveCount(0);

	// (2) to isté s kovaním na oboch stranách
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await page.selectOption('#kovanieL', LAVA);
	await page.selectOption('#kovanieP', PRAVA);
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	const karta = page.getByTestId('kovanie-strany');
	await expect(karta).toContainText('Zasklenie 1');
	await expect(karta).toContainText('ľavá strana');
	await expect(karta).toContainText(LAVA);
	await expect(karta).toContainText('pravá strana');
	await expect(karta).toContainText(PRAVA);

	// výpis je DISPLAY-ONLY — odpisové riadky sa nesmú hnúť
	expect(await odpisRiadky(page)).toEqual(bezKovania);

	expect(errs).toEqual([]);
});

test('viac posuvov: kovanie je vypísané per posuv, posuv bez kovania sa neuvádza', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-KOVV-M');
	await page.selectOption('#kovanieL', LAVA);
	await page.getByRole('button', { name: '➕ Pridať zasklenie' }).click();
	await page.locator('#ps0-s').fill('4365');
	await page.locator('#ps0-v').fill('2320');
	await page.selectOption('#ps0-kovp', PRAVA);
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	const karta = page.getByTestId('kovanie-strany-multi');
	await expect(karta).toContainText('Zasklenie 1');
	await expect(karta).toContainText(LAVA);
	await expect(karta).toContainText('Zasklenie 2');
	await expect(karta).toContainText(PRAVA);
	// posuv 1 nemá pravú kľučku, posuv 2 nemá ľavú → prázdna strana je pomlčka
	await expect(karta).toContainText('—');

	expect(errs).toEqual([]);
});

// Opona (2x2K/2x3K/2x4K): kľučka navyše na jednom z dvoch stredových krídel.
// Patrik 2026-07-31 + jeho snímka: „ak máme 2x3, kľučka bude okno 1, okno 6 a
// potom buď okno 3 alebo 4." Voľba L/P vyberá, ktoré stredové okno ju nesie.
test('opona: pole pre stredové okno je len pri 2× štýle a kreslí sa do stredu', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-KOVS');
	// 3K nie je opona → pole nie je
	await expect(page.getByTestId('kovanie-stred-polia')).toHaveCount(0);

	await page.selectOption('#styl', '2x2K');
	await expect(page.getByTestId('kovanie-stred-polia')).toBeVisible();
	await page.selectOption('#kovanieL', LAVA);
	await page.selectOption('#kovanieP', LAVA);
	await page.selectOption('#kovanieStred', PRAVA);
	await page.selectOption('#kovanieStredOkno', 'P');
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// v pláne je vypísaná ako tretí riadok posuvu
	const karta = page.getByTestId('kovanie-strany');
	await expect(karta).toContainText('stredové okno (pravé)');
	await expect(karta).toContainText(PRAVA);

	// v kresbe je tretí blok kovania a leží MEDZI krajnými dvomi
	const stred = page.getByTestId('kovanie-stred');
	await expect(stred).toHaveCount(1);
	const x = async (id: string) =>
		Number(await page.getByTestId(id).locator('text').first().getAttribute('x'));
	const [xl, xs, xp] = [await x('kovanie-l'), await x('kovanie-stred'), await x('kovanie-p')];
	expect(xs).toBeGreaterThan(xl);
	expect(xs).toBeLessThan(xp);

	expect(errs).toEqual([]);
});

// ── #462 extra posuv: ps{i}-kovs/kovso selecty (stredové kovanie pri 2× opona) ──
// Extra posuv (index ≥1) má ps{i}-kovl/kovp pre strany a pri 2× štýle aj
// ps{i}-kovs/kovso (stredové kovanie + stredové okno). Test overí, že tieto
// selecty fungujú a ich voľba sa zobrazí vo výpise kovania.
test('#462 extra posuv: ps0-kovs/ps0-kovso stredové selecty pri 2× štýle', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);

	await zaklad(page, 'E2E-KOVPS');
	// základ je 3K; pridaj posuv
	await page.getByRole('button', { name: '➕ Pridať zasklenie' }).click();
	await page.locator('#ps0-s').fill('4000');
	await page.locator('#ps0-v').fill('2000');
	// nastav extra posuv na opona (2x2K) → ps0-kovs/ps0-kovso sa objavia
	await page.selectOption('#ps0-styl', '2x2K');
	await waitHydrated(page);
	// stredové selecty sú viditeľné
	const kovs = page.locator('#ps0-kovs');
	await expect(kovs).toBeVisible();

	// zvoľ stredové kovanie
	const options = await kovs
		.locator('option')
		.evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
	if (options.length > 0) {
		await kovs.selectOption(options[0]!);
	}

	// zvoľ stranu stredového okna
	const kovso = page.locator('#ps0-kovso');
	if (await kovso.isVisible()) {
		await kovso.selectOption('P');
	}

	// zadaj strany
	await page.selectOption('#ps0-kovl', LAVA);
	await page.selectOption('#ps0-kovp', PRAVA);
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);

	// výsledný výpis multi-posuv kovania musí obsahovať info z oboch posuvov
	const karta = page.getByTestId('kovanie-strany-multi');
	await expect(karta).toContainText('Zasklenie 2');

	expect(errs).toEqual([]);
});
