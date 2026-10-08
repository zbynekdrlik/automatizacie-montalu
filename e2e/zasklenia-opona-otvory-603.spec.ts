// #603 (Odoo úloha 1370 „Delux opona"): pri otváraní OPONA má Deluxe zámkový otvor ⌀46 aj na
// DVOCH STREDOVÝCH sklách, kde sa polovice opony stretávajú — 2×3K = 4 tabule s otvorom + 2 bez.
// Výkres (prerušované kruhy) aj karta „Sklo (mm)" idú z JEDNÉHO pravidla (`otvoryVSkle`); stredové
// otvory ležia pri STRETÁVACEJ hrane. READ-ONLY (len výpočet nárezáku, nič sa nezapisuje — ani
// Money, ani objednávka skla) → bezpečné aj proti LIVE nasadeniu.
import { test, expect } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	vyberFarbuKovania,
	vyberSklo
} from './helpers';

const RUN = `E2E-OPN-${Date.now().toString(36).slice(-5)}`;

test('Deluxe 2×3K opona: 4 tabule s otvorom ⌀46 (aj obe stredové) + 2 bez — výkres = karta', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-2X3K`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Opona otvory');
	await page.getByLabel('Systém').selectOption('Deluxe');
	await page.getByLabel('Štýl').selectOption('2x3K');
	// 2× štýl je vždy opona (otváranie od stredu)
	await expect(page.locator('#otvaranie')).toHaveValue('Opona');
	await page.getByLabel('Šírka (mm) *').fill('6000');
	await page.getByLabel('Výška (mm) *').fill('2000');
	await vyberSklo(page.getByLabel('Sklo (základ — určuje vzorec)'), 'Float kalené 10 mm');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	// karta „Sklo (mm)": 6 tabúľ, z toho 4 s otvorom (krajné + obe stredové), 2 bez
	const skloKarta = page.locator('.card', { has: page.getByTestId('sklo-rozmer') });
	await expect(skloKarta.locator('div:has(> span:text-is("Počet")) > b')).toHaveText('6 ks');
	await expect(skloKarta.getByTestId('sklo-otvory')).toHaveText(
		'z toho s otvorom ⌀46: 4 ks · bez otvoru: 2 ks'
	);

	// výkres: 4 zámkové otvory (prerušované kruhy) = TO ISTÉ pravidlo ako karta
	const kruhy = page.getByTestId('nahlad-2d').locator('circle[stroke-dasharray]');
	await expect(kruhy).toHaveCount(4);
	const x = (
		await kruhy.evaluateAll((els) => els.map((e) => Number(e.getAttribute('cx'))))
	).sort((a, b) => a - b);
	const [x0, x1, x2, x3] = x as [number, number, number, number];
	// opona je zrkadlová okolo stredu a stredové otvory ležia TESNE pri stretávacej hrane
	// (bližšie než pol poľa) — pri otvore na zlej strane by boli od seba celé pole
	expect(Math.abs(x0 + x3 - (x1 + x2))).toBeLessThan(1);
	expect(x2 - x1).toBeLessThan((x3 - x0) / 12);

	expect(consoleMsgs).toEqual([]);
});
