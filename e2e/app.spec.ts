// E2E cez reálny prehliadač: login, celý zasklenia tok (náhľad → odoslanie →
// duplikát), editor vzorcov (zmena + návrat), verzia v pätičke. Každý test
// vyžaduje NULA console errors/warnings (browser-console-zero-errors).
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs } from './helpers';

// unikátna ZAK pre každý beh — dedup je perzistentný
const RUN = `E2E-${Date.now().toString(36).toUpperCase()}`;

test('login: zlé heslo zobrazí chybu, správne prihlási; verzia v pätičke', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await page.goto('/login');
	await page.getByLabel('Meno').fill('e2e');
	await page.getByLabel('Heslo').fill('zle-heslo');
	await page.getByRole('button', { name: 'Prihlásiť' }).click();
	await expect(page.getByTestId('login-error')).toContainText('Nesprávne');

	await loginAs(page);
	await expect(page.getByTestId('version')).toHaveText(/^v.+/);
	await expect(page.getByTestId('mode')).toBeVisible();
	expect(consoleMsgs).toEqual([]);
});

test('neprihlásený je presmerovaný na login', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await page.goto('/zasklenia');
	await expect(page).toHaveURL(/\/login/);
	expect(consoleMsgs).toEqual([]);
});

/** TVRDÁ POISTKA: zápisové testy sa NIKDY nespúšťajú proti LIVE nasadeniu —
 * testovací odpis nesmie skončiť v ostrom Money importe. */
async function skipAkLive(page: import('@playwright/test').Page) {
	const res = await page.request.get('/health');
	const { live } = (await res.json()) as { live: boolean };
	test.skip(live === true, 'LIVE nasadenie (MONEY_LIVE=1) — zápisové E2E preskočené');
}

test('zasklenia: náhľad → odoslanie → duplikát', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	// 1. formulár → náhľad (bez zápisu)
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(RUN);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Test');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();

	// overené hodnoty z 1:1 testov: sklo 1128,5 × 1725, odpis 15/15/7,5
	await expect(page.getByTestId('sklo-sirka')).toHaveText('1128,5');
	await expect(page.getByTestId('sklo-vyska')).toHaveText('1725');
	await expect(page.getByTestId('nahlad-2d')).toBeVisible();
	await expect(page.getByText('ZASP00014 · Koľajnica 2K Surový 7500 mm')).toBeVisible();
	await expect(page.locator('.row', { hasText: 'ZASP00014' })).toContainText('15 m');

	// 2. odoslanie (TEST režim)
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	await expect(page.getByTestId('vysledok')).toContainText(RUN);
	await expect(page.getByTestId('vysledok')).toContainText('OP01');
	await expect(page.getByRole('button', { name: /Tlačiť/ })).toBeVisible();

	// 3. nový plán → rovnaká ZAK+OP → duplikát, nič sa nezapíše
	await page.getByRole('link', { name: /Nový nárezový plán/ }).click();
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(RUN);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Test');
	await page.getByLabel('Šírka (mm) *').fill('2000');
	await page.getByLabel('Výška (mm) *').fill('1800');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('duplikat')).toContainText('už bola odoslaná');
	await page.getByRole('link', { name: /Späť na formulár/ }).click();
	await expect(page.getByLabel('Číslo objednávky (ZAK) *')).toHaveValue('');

	// 4. iná OP tej istej ZAK prejde
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(RUN);
	await page.getByLabel('OP/OPDL číslo *').fill('02');
	await page.getByLabel('Zákazník *').fill('E2E Test');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await page.getByTestId('odoslat').click();
	await expect(page.getByTestId('vysledok')).toContainText('OP02');

	// 5. história odpisov obsahuje oba záznamy
	await page.getByRole('link', { name: 'História', exact: true }).click();
	await expect(page.getByTestId('odpisy-tabulka')).toContainText(RUN);
	expect(consoleMsgs).toEqual([]);
});

test('validácia: nezmyselné rozmery sa odmietnu', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-VAL`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Test');
	const sirka = page.getByLabel('Šírka (mm) *');
	await sirka.fill('50');
	await page.getByLabel('Výška (mm) *').fill('1800');
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	// HTML5 min=300 zastaví odoslanie (server má rovnakú kontrolu)
	const invalid = await sirka.evaluate((el) => !(el as HTMLInputElement).checkValidity());
	expect(invalid).toBe(true);
	expect(consoleMsgs).toEqual([]);
});

test('editor vzorcov: uloženie bez zmeny → zmena → overenie vo výpočte → návrat', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);
	await page.goto('/zasklenia/nastavenia?sysStyl=Robust%7C2K');

	const sklo = page.getByLabel('Sklo — konečné zmenšenie (mm)');
	const povodna = await sklo.inputValue();

	// 1. uloženie bez zmeny — nič sa nemení
	await page.getByTestId('ulozit-vzorce').click();
	await expect(page.getByTestId('nastavenia-ulozene')).toContainText('Žiadna hodnota sa nezmenila');

	try {
		// 2. zmena skloOffset o +5 → uloží sa, preview ukáže starú → novú
		await page.getByRole('link', { name: /Upraviť ďalší štýl/ }).click();
		await sklo.fill(String(Number(povodna) + 5));
		await page.getByTestId('ulozit-vzorce').click();
		await expect(page.getByTestId('nastavenia-ulozene')).toBeVisible();
		await expect(page.getByText(`${povodna} → ${Number(povodna) + 5}`)).toBeVisible();

		// 3. hlavný formulár počíta s novou hodnotou (sklo užšie o 5)
		await page.goto('/zasklenia');
		await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-CFG`);
		await page.getByLabel('OP/OPDL číslo *').fill('01');
		await page.getByLabel('Zákazník *').fill('E2E Test');
		await page.getByLabel('Šírka (mm) *').fill('2509');
		await page.getByLabel('Výška (mm) *').fill('1930');
		await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
		await expect(page.getByTestId('sklo-sirka')).toHaveText('1123,5');
	} finally {
		// návrat na pôvodnú hodnotu VŽDY — aj po páde testu nesmie ostať
		// zmenená konfigurácia (best effort, bez assertov)
		await page.goto('/zasklenia/nastavenia?sysStyl=Robust%7C2K');
		await sklo.fill(povodna);
		await page.getByTestId('ulozit-vzorce').click();
		await page.getByTestId('nastavenia-ulozene').waitFor();
	}

	// 4. história zmien obsahuje návrat
	await page.goto('/zasklenia/nastavenia?sysStyl=Robust%7C2K');
	await expect(page.getByText('História zmien')).toBeVisible();
	await expect(
		page.getByText(`Sklo — konečné zmenšenie: ${Number(povodna) + 5} → ${povodna}`).first()
	).toBeVisible();

	// 5. preklep mimo rozsahu sa odmietne (HTML5 max=500)
	const invalid = await sklo.evaluate((el) => {
		(el as HTMLInputElement).value = '5000';
		return !(el as HTMLInputElement).checkValidity();
	});
	expect(invalid).toBe(true);
	expect(consoleMsgs).toEqual([]);
});
