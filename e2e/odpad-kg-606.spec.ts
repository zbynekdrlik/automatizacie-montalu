// #606 — nárezový plán zasklení: odpad aj v kilogramoch (kg/m z Odoo karty profilu).
// Read-only tok (len „Spočítať nárezový plán"), nič sa neodosiela do Money ani do Odoo — beží aj
// post-deploy proti PROD. Vzor #599 „zdroj cien" (ceny.spec.ts): appka sama zistí, či technický
// účet číta kg/m (`/health` → `kgZdroj`), a UI sa porovná s tým stavom:
//   • `nedostupne` (CI bez Odoo, dnešný PROD 403) → plán BEZ akéhokoľvek kg textu (ako pred #606);
//   • `odoo` (po sprístupnení na odoo-erp 9076) → pri každom profile „· X kg" alebo „· kg/m chýba"
//     a v „Odpad spolu" „· X kg z Y kg (Z % hmotnosti)" — aj v tlači. Relačne (kg/m sa v Odoo mení).
// Vetvu „kg zobrazené" deterministicky kryje SSR render `tests/rozpis-rezov-kg-606.test.ts`
// a `tests/clip-odpad-kg-606.test.ts` (fixtúra kg/m) — CI Odoo nemá (`odoo-katalog.md`).
// To isté platí pre CLIP pílový plán („Rozpis rezov na tyče — pre pílu", len „Spočítať rozpis").
import { test, expect, type Page } from '@playwright/test';
import {
	collectConsole,
	goto,
	loginAs,
	vyberFarbuKovania,
	vyberSklo,
	waitHydrated
} from './helpers';

/** `/health` cez Node `fetch` (nie `page.request` — stale keepAlive socket cez tunel, testing.md). */
async function kgZdroj(): Promise<string> {
	const baseUrl = process.env.BASE_URL || 'http://localhost:4173';
	const h = (await (await fetch(`${baseUrl}/health`)).json()) as { kgZdroj?: string };
	return String(h.kgZdroj);
}

// Robust 2K 2509×1930 — 3 profily (ZASP00014/ZASP00002/ZASP00010), ako ceny.spec.ts
async function spocitaj(page: Page) {
	await goto(page, '/zasklenia');
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(`E2E-606-${Date.now().toString(36)}`);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Odpad kg');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('2K');
	await page.getByLabel('Šírka (mm) *').fill('2509');
	await page.getByLabel('Výška (mm) *').fill('1930');
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await expect(page.getByTestId('odpad-spolu')).toBeVisible();
}

test('#606: odpad v kg v nárezovom pláne zodpovedá /health kgZdroj (bez Odoo žiadny kg text)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	const zdroj = await kgZdroj();
	expect(['odoo', 'nedostupne']).toContain(zdroj);
	if (!process.env.BASE_URL) expect(zdroj).toBe('nedostupne'); // CI preview nemá Odoo
	await loginAs(page);
	await spocitaj(page);

	const profily = await page.locator('.rozpis .profil').count();
	expect(profily).toBeGreaterThan(1);
	const kgProfilov = page.getByTestId('odpad-kg');
	const spoluKg = page.getByTestId('odpad-spolu-kg');

	if (zdroj === 'nedostupne') {
		// presne ako pred #606: mm a % podľa dĺžky, žiadne kg ani „kg/m chýba"
		await expect(kgProfilov).toHaveCount(0);
		await expect(spoluKg).toHaveCount(0);
		await expect(page.getByTestId('odpad-spolu')).toHaveText(
			/^Odpad spolu \(naprieč \d+ profilmi\): [\d,]+ mm \([\d,]+ %\)$/
		);
		await expect(page.locator('.rozpis')).not.toContainText(' kg');
		await expect(page.locator('.rozpis .stat').first()).toHaveText(
			/odpad [\d,]+ mm \([\d,]+ %\) · rez (45°|rovný)$/
		);
	} else {
		// kanál živý: buď žiadna karta kg/m nemá (nič), alebo KAŽDÝ profil nesie kg / „kg/m chýba"
		const n = await kgProfilov.count();
		expect([0, profily]).toContain(n);
		if (n > 0) {
			for (const t of await kgProfilov.allTextContents())
				expect(t).toMatch(/^\s*· (\d+(,\d+)? kg|kg\/m chýba)$/);
			await expect(spoluKg).toHaveText(/^\s*· [\d,]+ kg z [\d,]+ kg \([\d,]+ % hmotnosti\)$/);
			// tlač (nárezový plán pre dielňu) nesie kg tiež
			await page.emulateMedia({ media: 'print' });
			await expect(spoluKg).toBeVisible();
			await expect(kgProfilov.first()).toBeVisible();
			await page.emulateMedia({ media: 'screen' });
		}
	}
	expect(consoleMsgs).toEqual([]);
});

test('#606: CLIP pílový plán — kg zodpovedajú /health kgZdroj (bez Odoo žiadny kg text)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	const zdroj = await kgZdroj();
	if (!process.env.BASE_URL) expect(zdroj).toBe('nedostupne'); // CI preview nemá Odoo
	await loginAs(page);
	await goto(page, '/clip');
	await page.locator('#zak').fill(`E2E-606-CLIP-${Date.now().toString(36)}`);
	await page.locator('#op').fill('OP1');
	await page.locator('#zakaznik').fill('E2E Odpad kg');
	// izo 3 výplne 3000×1200 — 3 profily (rám, priečka, zasklievací) v pílovom pláne
	await vyberSklo(page.getByTestId('typ'), 'izo');
	await page.getByTestId('variant').selectOption('3');
	await page.locator('#sirka').fill('3000');
	await page.locator('#vyska').fill('1200');
	await page.getByRole('button', { name: 'Spočítať rozpis' }).click();
	await waitHydrated(page);

	const rozpis = page.getByTestId('clip-rozpis-rezov');
	await expect(rozpis).toBeVisible();
	await expect(page.getByTestId('odpad-spolu')).toBeVisible();
	const profily = await rozpis.locator('.profil').count();
	expect(profily).toBe(3);
	const kgProfilov = rozpis.getByTestId('odpad-kg');

	if (zdroj !== 'odoo') {
		await expect(kgProfilov).toHaveCount(0);
		await expect(rozpis.getByTestId('odpad-spolu-kg')).toHaveCount(0);
		await expect(rozpis.locator('.rozpis')).not.toContainText(' kg');
		await expect(rozpis.locator('.stat').first()).toHaveText(
			/odpad [\d,]+ mm \([\d,]+ %\) · rez rovný$/
		);
	} else {
		const n = await kgProfilov.count();
		expect([0, profily]).toContain(n);
		for (const t of await kgProfilov.allTextContents())
			expect(t).toMatch(/^\s*· (\d+(,\d+)? kg|kg\/m chýba)$/);
		if (n > 0)
			await expect(rozpis.getByTestId('odpad-spolu-kg')).toHaveText(
				/^\s*· [\d,]+ kg z [\d,]+ kg \([\d,]+ % hmotnosti\)$/
			);
	}
	expect(consoleMsgs).toEqual([]);
});
