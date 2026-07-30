// Rezy profilov v zozname materiálu — šéf 2026-07-30: „píše, že iba koľajnice
// majú obrázky, aj to tuším len spodné." Platilo to pre Štandard a Štandard +:
// rezy z Money existovali, ale nikdy sa nestiahli. Tento test ide cez REÁLNY
// prehliadač a žiada, aby KAŽDÝ riadok materiálu mal načítaný obrázok (nie len
// prítomný `<img>` — kontroluje sa `naturalWidth`, takže rozbitý súbor padne).
//
// Všetko ČÍTACIE („Spočítať"), do Money nejde nič.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated } from './helpers';

/** riadky karty „Zoznam materiálu — profily": kód + či sa obrázok naozaj načítal */
async function materialRiadky(page: Page) {
	const karta = page.locator('.card', { hasText: 'Zoznam materiálu' }).first();
	await expect(karta).toBeVisible();
	return karta.locator('tbody tr').evaluateAll((rows) =>
		rows.map((r) => {
			const tds = [...r.querySelectorAll('td')].map((t) => (t.textContent ?? '').trim());
			const img = r.querySelector('img') as HTMLImageElement | null;
			return { kod: tds[2] ?? '', nazov: tds[1] ?? '', nacitany: !!img && img.naturalWidth > 0 };
		})
	);
}

const PRIPADY = [
	{ system: 'Štandard', styl: '2K' },
	{ system: 'Štandard +', styl: '3K' },
	{ system: 'Robust', styl: '2K' }
];

for (const { system, styl } of PRIPADY) {
	test(`${system} ${styl}: každý profil v zozname materiálu má rez`, async ({ page }) => {
		const errs = collectConsole(page);
		await loginAs(page);

		await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-OBR');
		await page.getByLabel('OP/OPDL číslo *').fill('01');
		await page.getByLabel('Zákazník *').fill('E2E Obrazky');
		await page.getByLabel('Systém').selectOption(system);
		await page.getByLabel('Štýl').selectOption(styl);
		await page.locator('#s').fill('2509');
		await page.locator('#v').fill('1930');
		await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
		await waitHydrated(page);

		const riadky = await materialRiadky(page);
		expect(riadky.length).toBeGreaterThan(2);
		const bez = riadky.filter((r) => !r.nacitany).map((r) => `${r.kod} ${r.nazov}`);
		expect(bez, `bez rezu: ${bez.join(' | ')}`).toEqual([]);

		expect(errs).toEqual([]);
	});
}
