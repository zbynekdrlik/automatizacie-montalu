// #573 — meeting výroba 25.9.: nárezák ponúka per systém LEN povolené sklá (allow-list
// `POVOLENE_SKLA`, ROZHODNUTÉ 27.9. na tickete) a „Sklo (základ)" nemá príponu
// „· cenník: viac typov (N)". Read-only tok — len čítanie ponuky z DOM, nič sa neodosiela.
// Relačné (#594): ponuku čítame ako VÝPOČTOVÉ sklá volieb (`data-vypocet`) — v CI bez Odoo sú to
// lokálne sklá (presne allow-list), na PROD s Odoo LEN Odoo typy, ktorých výpočtové sklo musí byť
// v allow-liste (podmnožina — lokálne sklo bez Odoo typu sa pri Odoo neponúka, #594).
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, ponukaSkla, overPonukuSkla, expectSklo } from './helpers';

const SKLO = 'Sklo (základ — určuje vzorec)';
const INE = 'Iné (vlastná skladba)';

async function ponuka(page: Page, system: string, styl: string) {
	await page.getByLabel('Systém').selectOption(system);
	await page.getByLabel('Štýl').selectOption(styl);
	const sel = page.getByLabel(SKLO);
	// žiadna voľba nenesie príponu „viac typov" (Palo 25.9. [04:19])
	for (const t of await sel.locator('option').allTextContents())
		expect(t).not.toContain('viac typov');
	return ponukaSkla(sel);
}

test('Robust ponúka LEN skladby 4/16/4 číre a mliečne (#573)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	const p = await ponuka(page, 'Robust', '3K');
	overPonukuSkla(p, ['Izolačné sklo 4/16/4 číre', 'Izolačné sklo 4/16/4 mliečne']);
	// predvolené sklo = 4/16/4 číre (#594: na PROD Odoo voľba počítaná týmto sklom)
	await expectSklo(page.getByLabel(SKLO), 'Izolačné sklo 4/16/4 číre');
	expect(consoleMsgs).toEqual([]);
});

test('Štandard plus 3K ponúka 4 mm Float aj kalené (#579), nie 10 mm; predvolené je 6 mm (#573)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	const p = await ponuka(page, 'Štandard +', '3K');
	const povolene = [
		'Float sklo 4 mm',
		'ESG kalené 4 mm',
		'Float sklo 6 mm',
		'ESG kalené 6 mm',
		'3.3.1',
		'3.3.1 mliečne',
		'Izolačné sklo 4/8/4 číre',
		'Izolačné sklo 4/8/4 mliečne',
		'Izolačné sklo 4/8/4 stopsol',
		'Izolačné sklo 4/16/4 číre',
		'Izolačné sklo 4/16/4 mliečne',
		'Izolačné sklo 4/16/4 stopsol'
	];
	overPonukuSkla(p, povolene);
	// #579 (Patrik 28.9.): 4 mm sklo pri Štandardoch áno — výnimka, predvolené ostáva 6 mm
	expect(p.vypocty.filter((s) => /\b4 mm\b/.test(s)).sort()).toEqual([
		'ESG kalené 4 mm',
		'Float sklo 4 mm'
	]);
	expect(p.vypocty.filter((s) => /10 mm/.test(s))).toEqual([]);
	// IZO triedy 16 (4/8/4 = Odoo 16 mm izolačné) je v ponuke vždy — CI aj PROD. 24 mm izolačné
	// (4/16/4) sa NEtvrdí: na PROD ho výroba pri Štandardoch odobrala (Odoo úloha 1218, 29.9.), CI
	// lokálny allow-list ho ešte má — ponuka hrúbok je živá cfg, spec ju nesmie zamrznúť.
	expect(p.vypocty.some((s) => /^Izolačné sklo 4\/8\/4/.test(s))).toBe(true);
	await expectSklo(page.getByLabel(SKLO), 'Float sklo 6 mm');
	expect(consoleMsgs).toEqual([]);
});

test('Deluxe 6 mm a 10 mm (predvolené 10 mm); starý Štandard bez zmeny (#573)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	const deluxe = await ponuka(page, 'Deluxe', '3K');
	expect([...deluxe.vypocty].sort()).toEqual(['Float kalené 10 mm', 'Float kalené 6 mm']);
	await expectSklo(page.getByLabel(SKLO), 'Float kalené 10 mm');

	const stary = await ponuka(page, 'Štandard', '3K');
	expect(stary.vypocty).toContain('Float sklo 6 mm');
	// starý Štandard je „bez zmeny" — ponúka ďalej aj to, čo Štandard plus už nie (4 mm Float)
	expect(stary.vypocty).toContain('Float sklo 4 mm');
	// 3.3.1 je lokálne sklo — pri Odoo ponuke je len keď ho počíta niektorý Odoo typ (#594)
	if (!stary.odoo) expect(stary.vypocty).toContain('3.3.1');
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
