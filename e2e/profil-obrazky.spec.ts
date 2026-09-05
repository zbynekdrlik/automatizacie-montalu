// Rezy profilov v zozname materiálu — šéf 2026-07-30: „píše, že iba koľajnice
// majú obrázky, aj to tuším len spodné." Platilo to pre Štandard a Štandard +:
// rezy z Money existovali, ale nikdy sa nestiahli. Tento test ide cez REÁLNY
// prehliadač a žiada, aby KAŽDÝ riadok materiálu mal načítaný obrázok (nie len
// prítomný `<img>` — kontroluje sa `naturalWidth`, takže rozbitý súbor padne).
//
// Všetko ČÍTACIE („Spočítať"), do Money nejde nič.
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, loginAs, waitHydrated, vyberFarbuKovania } from './helpers';

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

/** riadky bez načítaného rezu (prázdne pole = všetko OK) — na opakovaný poll */
async function bezRezu(page: Page) {
	const riadky = await materialRiadky(page);
	return riadky.filter((r) => !r.nacitany).map((r) => `${r.kod} ${r.nazov}`);
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
		await vyberFarbuKovania(page);
		await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
		await waitHydrated(page);

		const riadky = await materialRiadky(page);
		expect(riadky.length).toBeGreaterThan(2);
		// Obrázky sa dopĺňajú asynchrónne (fetch) — najmä cez pomalý SSH tunel k prod
		// vieme byť tesne po hydratácii ešte pred ich doťahaním (#466). Ohraničený poll
		// namiesto jednorazového čítania: re-čítame DOM, kým každý riadok nemá
		// naozaj načítaný obrázok (naturalWidth > 0), alebo kým nevyprší timeout —
		// rozbitý/chýbajúci obrázok naďalej padne (naturalWidth ostane 0 navždy).
		await expect.poll(() => bezRezu(page), { timeout: 20_000, message: 'bez rezu' }).toEqual([]);

		expect(errs).toEqual([]);
	});
}

// #464: ProfilObrazok lightbox — thumb klik otvorí, backdrop + ✕ zavrie
test('ProfilObrazok lightbox: otvorenie a zatvorenie (backdrop + ✕)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);

	await page.getByLabel('Číslo objednávky (ZAK) *').fill('E2E-LB');
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Lightbox');
	await page.getByLabel('Systém').selectOption('Štandard');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.locator('#s').fill('2509');
	await page.locator('#v').fill('1930');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);

	// thumb je viditeľný (aria-label na ProfilObrazok)
	const thumb = page.locator('button.thumb').first();
	await expect(thumb).toBeVisible();

	// klik otvorí lightbox
	await thumb.click();
	const lightbox = page.locator('.lightbox');
	await expect(lightbox).toBeVisible();
	await expect(page.locator('.lb-card')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Zavrieť' })).toBeVisible();

	// ✕ zatvorí lightbox
	await page.getByRole('button', { name: 'Zavrieť' }).click();
	await expect(lightbox).toHaveCount(0);

	// znova otvorenie + backdrop klik zatvorí
	await thumb.click();
	await expect(lightbox).toBeVisible();
	await lightbox.click({ position: { x: 5, y: 5 } }); // backdrop, nie lb-card
	await expect(lightbox).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});
