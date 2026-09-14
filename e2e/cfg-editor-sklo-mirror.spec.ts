// #504 [round 4] E2E: skrytý mirror rámový→sklo v editore vzorcov (`/zasklenia/nastavenia`)
// korumpoval NEZÁVISLÉ sklo offsety pri uložení štýlu so zmenou LEN Kladkového/Rozširujúceho
// (opona IZO sklo výška = V−135 ticho prepísaná na rámový V −33 → nárezák render 2067 miesto
// 1965; prod korupcia 14.9., cfg_rez 419/409/399/377). Toto je WRITE test (ukladá vzorce do
// cfg) → `skipAkLive` (nikdy proti LIVE). Reálny spúšťač je zmena NErámového poľa, ako to
// spravil Patrik — „uloženie bez zmeny" by NEreprodukovalo (saveCfgChanges pri prázdnych
// zmenách skončí skôr, transakcia/mirror sa vôbec nespustí). Kladkový sa na konci vráti na
// pôvodnú hodnotu (net-zero na cfg). Nula console errors/warnings.
import { test, expect } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	skipAkLive,
	vyberFarbuKovania
} from './helpers';

const RUN = `E2E-SKLOMIR-${Date.now().toString(36).toUpperCase()}`;
const SYS_STYL = 'Štandard +|2x4K IZO';

async function otvorEditorStylu(page: import('@playwright/test').Page) {
	await goto(page, '/zasklenia/nastavenia');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption(SYS_STYL);
	await waitHydrated(page);
	await expect(page.getByTestId('editor-nadpis')).toContainText('2x4K IZO');
}

test('editor: uloženie opona IZO (zmena Kladkového) NEprepíše nezávislú sklo výšku (#504)', async ({
	page
}) => {
	await skipAkLive(page);
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	// --- 1. editor: zmeň LEN Kladkový offset (rámový V ostáva) a ulož — presne Patrikov krok ---
	await otvorEditorStylu(page);
	const kladk = page.getByLabel(/Kladkový profil.*odsadenie/);
	const orig = await kladk.inputValue();
	await kladk.fill(String(Number(orig) - 1)); // reálna zmena → save prebehne (inak early-return)
	await page.getByTestId('ulozit-vzorce').click();
	await expect(page.getByTestId('nastavenia-ulozene')).toBeVisible();

	// --- 2. nárezák: sklo výška MUSÍ ostať 1965 (V=2100 − 135); bug ju prepísal na 2067 (−33) ---
	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(RUN);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Sklo Mirror');
	await page.getByLabel('Systém').selectOption('Štandard +');
	await page.getByLabel('Štýl').selectOption('2x4K');
	await page.getByLabel('Šírka (mm) *').fill('5000');
	await page.getByLabel('Výška (mm) *').fill('2100');
	await page.getByLabel('Sklo (základ — určuje vzorec)').selectOption('Izolačné sklo 4/16/4 číre');
	await vyberFarbuKovania(page); // Štandard+ nemá farbu kovania → no-op
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await expect(page.getByTestId('nahlad-2d')).toBeVisible();
	await expect(
		page.getByTestId('sklo-vyska'),
		'sklo výška opona IZO sa nesmie zrkadliť z rámového'
	).toHaveText('1965');

	// --- 3. cleanup: vráť Kladkový na pôvodnú hodnotu (net-zero na cfg) ---
	await otvorEditorStylu(page);
	await page.getByLabel(/Kladkový profil.*odsadenie/).fill(orig);
	await page.getByTestId('ulozit-vzorce').click();
	await expect(page.getByTestId('nastavenia-ulozene')).toBeVisible();

	expect(consoleMsgs).toEqual([]);
});
