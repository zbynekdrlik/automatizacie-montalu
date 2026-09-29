// #573 — meeting výroba 25.9.: nárezák ponúka per systém LEN povolené sklá (allow-list
// `POVOLENE_SKLA`, ROZHODNUTÉ 27.9. na tickete) a „Sklo (základ)" nemá príponu
// „· cenník: viac typov (N)". Read-only tok — len čítanie ponuky z DOM, nič sa neodosiela.
// Relačné: ponuku čítame z `<option>` (holý názov cez `bareSkloLabel`, PROD nesie Odoo sufix
// „· cenník: <name>" pri jednoznačnej zhode), porovnávame s tabuľkou, nie s mm literálmi.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, bareSkloLabel, LOKALNE_SKLA } from './helpers';

const SKLO = 'Sklo (základ — určuje vzorec)';
const INE = 'Iné (vlastná skladba)';

async function ponuka(page: Page, system: string, styl: string): Promise<string[]> {
	await page.getByLabel('Systém').selectOption(system);
	await page.getByLabel('Štýl').selectOption(styl);
	const texty = await page.getByLabel(SKLO).locator(LOKALNE_SKLA).allTextContents();
	// žiadna voľba nenesie príponu „viac typov" (Palo 25.9. [04:19]) — zahryzne len proti
	// nasadeniu s Odoo obohatením (post-deploy); v CI preview bez Odoo je popis vždy prázdny
	// a správanie kryje unit `tests/glass-match.test.ts`
	for (const t of texty) expect(t).not.toContain('viac typov');
	return texty.map(bareSkloLabel).filter((t) => t !== INE);
}

test('Robust ponúka LEN skladby 4/16/4 číre a mliečne (#573)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	const skla = await ponuka(page, 'Robust', '3K');
	expect([...skla].sort()).toEqual(
		['Izolačné sklo 4/16/4 číre', 'Izolačné sklo 4/16/4 mliečne'].sort()
	);
	await expect(page.getByLabel(SKLO)).toHaveValue('Izolačné sklo 4/16/4 číre');
	expect(consoleMsgs).toEqual([]);
});

test('Štandard plus 3K ponúka 4 mm Float aj kalené (#579), nie 10 mm; predvolené je 6 mm (#573)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	const skla = await ponuka(page, 'Štandard +', '3K');
	// #579 (Patrik 28.9.): 4 mm sklo pri Štandardoch áno — výnimka, predvolené ostáva 6 mm
	expect(skla.filter((s) => /\b4 mm\b/.test(s))).toEqual(['Float sklo 4 mm', 'ESG kalené 4 mm']);
	expect(skla.filter((s) => /10 mm/.test(s))).toEqual([]);
	expect(skla).toContain('Float sklo 6 mm');
	expect(skla).toContain('3.3.1');
	expect(skla.some((s) => /^Izolačné sklo 4\/16\/4/.test(s))).toBe(true);
	await expect(page.getByLabel(SKLO)).toHaveValue('Float sklo 6 mm');
	expect(consoleMsgs).toEqual([]);
});

test('Deluxe 6 mm a 10 mm (predvolené 10 mm); starý Štandard bez zmeny (#573)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	const deluxe = await ponuka(page, 'Deluxe', '3K');
	expect(deluxe).toEqual(['Float kalené 6 mm', 'Float kalené 10 mm']);
	await expect(page.getByLabel(SKLO)).toHaveValue('Float kalené 10 mm');

	const stary = await ponuka(page, 'Štandard', '3K');
	expect(stary).toContain('Float sklo 6 mm');
	expect(stary).toContain('3.3.1');
	// starý Štandard je „bez zmeny" — ponúka ďalej aj to, čo Štandard plus už nie
	expect(stary).toContain('Float sklo 4 mm');
	expect(consoleMsgs).toEqual([]);
});

test('vlastná skladba na Robuste ponúka len triedu 24 mm (#573)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await ponuka(page, 'Robust', '3K');
	await page.getByLabel(SKLO).selectOption(INE);
	const triedy = (await page.locator('#skloTrieda option').allTextContents())
		.map((t) => t.trim())
		.filter((t) => /\d/.test(t));
	expect(triedy).toHaveLength(1);
	expect(triedy[0]).toMatch(/24/);
	expect(consoleMsgs).toEqual([]);
});
