// #579 — nárezák zasklení ponúka v „Sklo (základ)" aj Odoo typy skla podľa HRÚBKY systému (Robust
// 24 mm → všetky 24 mm sklá z Odoo). Odoo voľba sa počíta lokálnym výpočtovým sklom (Robust = 4/16/4
// číre) — výpočet musí byť IDENTICKÝ, na pláne je Odoo názov a formulár nesie `skloOdoo`.
// Read-only tok (len „Spočítať" + „Späť a upraviť"), nič sa neodosiela do Money ani do objednávky.
//
// Dve vetvy podľa prostredia (obe niečo reálne overujú, žiadny skip):
//   • CI preview BEZ Odoo → lokálny fallback: ponuka = povolené lokálne sklá, žiadne skupiny,
//     žiadne pole `skloOdoo`, plán nesie lokálne sklo;
//   • post-deploy PROD S Odoo → Odoo voľby sú v skupinách „Odoo — …", zvolený typ ide do
//     `skloOdoo`, plán ukazuje jeho názov, výpočet = 4/16/4 číre, „Späť a upraviť" voľbu zachová.
// Relačné (žiadne mm literály ani konkrétne Odoo názvy — katalóg sa v Odoo mení).
import { test, expect, type Page } from '@playwright/test';
import {
	collectConsole,
	goto,
	loginAs,
	waitHydrated,
	vyberFarbuKovania,
	bareSkloLabel,
	LOKALNE_SKLA
} from './helpers';

const SKLO = 'Sklo (základ — určuje vzorec)';
const INE = 'Iné (vlastná skladba)';
const CIRE = 'Izolačné sklo 4/16/4 číre';
const RUN = `E2E-579-${Date.now().toString(36).slice(-5)}`;

async function zadanie(page: Page) {
	await page.getByLabel('Číslo objednávky (ZAK) *').fill(RUN);
	await page.getByLabel('OP/OPDL číslo *').fill('01');
	await page.getByLabel('Zákazník *').fill('E2E Odoo sklo');
	await page.getByLabel('Systém').selectOption('Robust');
	await page.getByLabel('Štýl').selectOption('3K');
	await page.getByLabel('Šírka (mm) *').fill('3000');
	await page.getByLabel('Výška (mm) *').fill('2200');
}

async function spocitaj(page: Page) {
	await vyberFarbuKovania(page);
	await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
	await waitHydrated(page);
	await expect(page.getByTestId('sklo-typ')).toBeVisible();
}

/** Čísla, ktoré nesie výpočet (rozmer skla + Money odpis) — musia sedieť pre Odoo aj lokálne sklo. */
async function vypocet(page: Page) {
	return {
		sirka: await page.getByTestId('sklo-sirka').textContent(),
		vyska: await page.getByTestId('sklo-vyska').textContent(),
		odpis: (await page.locator('.card', { hasText: 'Odpis (do Money)' }).first().innerText())
			.replace(/\s+/g, ' ')
			.trim()
	};
}

test('Robust „Sklo (základ)": Odoo typy podľa hrúbky (ak je Odoo), výpočet ako 4/16/4 číre (#579)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/zasklenia');
	await zadanie(page);

	const sel = page.getByLabel(SKLO);
	// lokálne povolené sklá Robustu sú v ponuke v OBOCH prostrediach (allow-list #573)
	const lokalne = (await sel.locator(LOKALNE_SKLA).allTextContents())
		.map(bareSkloLabel)
		.filter((t) => t !== INE);
	expect([...lokalne].sort()).toEqual([CIRE, 'Izolačné sklo 4/16/4 mliečne'].sort());
	await expect(sel).toHaveValue(CIRE);

	const odoo = await sel.locator('option[value^="odoo:"]').evaluateAll((els) =>
		els.map((e) => ({
			value: (e as HTMLOptionElement).value,
			text: (e.textContent ?? '').trim(),
			skupina: (e.parentElement as HTMLOptGroupElement | null)?.label ?? ''
		}))
	);

	if (odoo.length === 0) {
		// CI bez Odoo: lokálny fallback — žiadne skupiny, žiadny Odoo typ vo formulári
		await expect(sel.locator('optgroup')).toHaveCount(0);
		await expect(page.locator('input[name="skloOdoo"]')).toHaveCount(0);
		await spocitaj(page);
		await expect(page.getByTestId('sklo-typ')).toHaveText(CIRE);
		expect(errs).toEqual([]);
		return;
	}

	// PROD s Odoo: každá Odoo voľba je v skupine „Odoo — …", hodnoty unikátne
	for (const o of odoo) expect(o.skupina).toMatch(/^Odoo — /);
	expect(new Set(odoo.map((o) => o.value)).size).toBe(odoo.length);

	// referenčný výpočet s lokálnym 4/16/4 číre
	await spocitaj(page);
	const ref = await vypocet(page);
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);

	// zvolený Odoo typ → formulár nesie jeho hodnotu, výpočet identický, plán ukazuje Odoo názov
	const zvoleny = odoo[odoo.length - 1]!;
	await sel.selectOption(zvoleny.value);
	await expect(page.locator('input[name="skloOdoo"]')).toHaveValue(
		zvoleny.value.slice('odoo:'.length)
	);
	await expect(page.locator('input[name="sklo"]')).toHaveValue(CIRE);
	await spocitaj(page);
	await expect(page.getByTestId('sklo-typ')).toHaveText(zvoleny.text.split(' · ')[0]!);
	expect(await vypocet(page)).toEqual(ref);

	// „Späť a upraviť" zachová zvolený Odoo typ
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);
	await expect(sel).toHaveValue(zvoleny.value);

	expect(errs).toEqual([]);
});
