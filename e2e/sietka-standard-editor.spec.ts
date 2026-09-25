// #569: konštanty modelu sieťky Štandard (K/R/H) sú editovateľné v editore vzorcov
// (`/zasklenia/nastavenia`, sekcia „Sieťka Štandard") — Patrik (Odoo úloha 1070): „neviem toto
// nikde upraviť". Sekcia je LEN pri Štandard-rodine. Zápisový test (zmena H → sieťovina na
// nárezáku o toľko vyššia → vrátenie) beží len mimo LIVE (`skipAkLive`). Relačne, bez seed mm.
import { test, expect, type Page } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	skipAkLive,
	vyberFarbuKovania
} from './helpers';

const nastavenia = (sysStyl: string) =>
	`/zasklenia/nastavenia?sysStyl=${encodeURIComponent(sysStyl)}`;

async function vyskaSietoviny(page: Page): Promise<number> {
	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-SIETKA-KRH');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Sietka KRH');
	await page.selectOption('#system', 'Štandard');
	await page.selectOption('#styl', '3K');
	await page.locator('#s').fill('3000');
	await page.locator('#v').fill('1850');
	await page.locator('#sietka-on').check();
	await vyberFarbuKovania(page);
	await page.getByTestId('spocitat').click();
	await waitHydrated(page);
	const txt = (await page.getByTestId('sietka-rozmer').textContent()) ?? '';
	const m = txt.match(/(\d+)\s*×\s*(\d+)/);
	if (!m) throw new Error(`vyskaSietoviny: nečakaný text „${txt}"`);
	return Number(m[2]);
}

async function ulozH(page: Page, h: string) {
	await goto(page, nastavenia('Štandard|3K'));
	await page.locator('#sietka_h').fill(h);
	await page.getByTestId('ulozit-vzorce').click();
	await expect(page.getByTestId('nastavenia-ulozene')).toBeVisible();
}

test('editor vzorcov: sekcia Sieťka Štandard (K/R/H) je pri Štandard-rodine, pri Robust nie', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await goto(page, nastavenia('Štandard +|3K'));
	await expect(page.getByTestId('sietka-standard-sekcia')).toBeVisible();
	for (const k of ['k', 'r', 'h']) {
		const v = await page.locator(`#sietka_${k}`).inputValue();
		expect(Number.isFinite(Number(v)), `sietka_${k}=${v}`).toBe(true);
	}
	// K/R/H sú spoločné pre obe rodiny — starý Štandard ukáže TIE ISTÉ hodnoty
	const kPlus = await page.locator('#sietka_k').inputValue();
	await goto(page, nastavenia('Štandard|3K'));
	await expect(page.locator('#sietka_k')).toHaveValue(kPlus);

	await goto(page, nastavenia('Robust|3K'));
	await expect(page.getByTestId('editor-nadpis')).toBeVisible();
	await expect(page.getByTestId('sietka-standard-sekcia')).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});

test('editor vzorcov: zmena H sa auditne a sieťovina na nárezáku je o toľko vyššia', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	await goto(page, nastavenia('Štandard|3K'));
	const hPred = await page.locator('#sietka_h').inputValue();
	const vyskaPred = await vyskaSietoviny(page);

	const hNove = String(Number(hPred) + 1);
	await ulozH(page, hNove);
	// zmena je v zozname „Zmeny" (= audit záznam cfg_audit, ten istý `zmeny` zoznam)
	await expect(page.getByText(/^Sieťka Štandard — H/)).toBeVisible();
	try {
		expect(await vyskaSietoviny(page)).toBe(vyskaPred + 1);
	} finally {
		await ulozH(page, hPred);
	}
	expect(await vyskaSietoviny(page)).toBe(vyskaPred);

	expect(consoleMsgs).toEqual([]);
});
