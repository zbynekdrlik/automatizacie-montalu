// #579 + #594 — nárezák zasklení ponúka v „Sklo (základ)" Odoo typy skla podľa HRÚBKY systému
// (Robust 24 mm → všetky 24 mm sklá z Odoo). #594 (Odoo úloha 1218): pri dostupnom Odoo LEN Odoo
// typy — žiadne lokálne „Sklá appky"; predvolené sklo = Odoo voľba počítaná lokálnym 4/16/4 číre.
// Odoo voľba sa počíta lokálnym výpočtovým sklom — výpočet musí byť IDENTICKÝ, na pláne je Odoo
// názov a formulár nesie `skloOdoo`. Read-only tok (len „Spočítať" + „Späť a upraviť"), nič sa
// neodosiela do Money ani do objednávky.
//
// Dve vetvy podľa prostredia (obe niečo reálne overujú, žiadny skip):
//   • CI preview BEZ Odoo → lokálny fallback: ponuka = povolené lokálne sklá, žiadne skupiny,
//     žiadne pole `skloOdoo`, plán nesie lokálne sklo;
//   • post-deploy PROD S Odoo → LEN Odoo voľby v skupinách „Odoo — …", predvolená je Odoo voľba
//     (formulár nesie jej `skloOdoo`, výpočtové `sklo` = 4/16/4 číre), plán ukazuje jej názov,
//     iný Odoo typ s tým istým výpočtovým sklom dá identický výpočet, „Späť a upraviť" voľbu zachová.
// Relačné (žiadne mm literály ani konkrétne Odoo názvy — katalóg sa v Odoo mení).
import { test, expect, type Page } from '@playwright/test';
import {
	collectConsole,
	goto,
	loginAs,
	waitHydrated,
	vyberFarbuKovania,
	ponukaSkla,
	overPonukuSkla,
	vypocetSkla
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

/** Čísla, ktoré nesie výpočet (rozmer skla + Money odpis) — musia sedieť pre každú voľbu. */
async function vypocet(page: Page) {
	return {
		sirka: await page.getByTestId('sklo-sirka').textContent(),
		vyska: await page.getByTestId('sklo-vyska').textContent(),
		odpis: (await page.locator('.card', { hasText: 'Odpis (do Money)' }).first().innerText())
			.replace(/\s+/g, ' ')
			.trim()
	};
}

test('Robust „Sklo (základ)": pri Odoo LEN Odoo typy podľa hrúbky, predvolené počítané ako 4/16/4 číre (#579 #594)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await goto(page, '/zasklenia');
	await zadanie(page);

	const sel = page.getByLabel(SKLO);
	const p = await ponukaSkla(sel);
	// allow-list #573: CI presne obe skladby, PROD podmnožina (Odoo typy s ich výpočtom)
	overPonukuSkla(p, [CIRE, 'Izolačné sklo 4/16/4 mliečne']);
	expect(await vypocetSkla(sel)).toBe(CIRE);

	const volby = await sel.locator('option').evaluateAll((els) =>
		els.map((e) => ({
			value: (e as HTMLOptionElement).value,
			text: (e.textContent ?? '').trim(),
			vypocet: (e as HTMLOptionElement).dataset.vypocet ?? '',
			skupina: (e.parentElement as HTMLOptGroupElement | null)?.label ?? ''
		}))
	);
	const odoo = volby.filter((o) => o.value.startsWith('odoo:'));

	if (!p.odoo) {
		// CI bez Odoo: lokálny fallback — žiadne skupiny, žiadny Odoo typ vo formulári
		await expect(sel).toHaveValue(CIRE);
		await expect(sel.locator('optgroup')).toHaveCount(0);
		await expect(page.locator('input[name="skloOdoo"]')).toHaveCount(0);
		await spocitaj(page);
		await expect(page.getByTestId('sklo-typ')).toHaveText(CIRE);
		expect(errs).toEqual([]);
		return;
	}

	// PROD s Odoo (#594): okrem „Iné" LEN Odoo voľby, každá v skupine „Odoo — …", hodnoty unikátne
	expect(volby.filter((o) => o.value !== INE && !o.value.startsWith('odoo:'))).toEqual([]);
	for (const o of odoo) expect(o.skupina).toMatch(/^Odoo — /);
	expect(new Set(odoo.map((o) => o.value)).size).toBe(odoo.length);

	// predvolená voľba = Odoo typ počítaný 4/16/4 číre, PRESNÝ náprotivok (nikdy stopsol / iný
	// odtieň, ktorý sa len počíta rovnako — pasca chytená proti PROD katalógu); formulár nesie jej typ
	const hodnota = await sel.inputValue();
	const predvolena = odoo.find((o) => o.value === hodnota)!;
	expect(predvolena.vypocet).toBe(CIRE);
	expect(predvolena.text).not.toMatch(/stopsol|mlie|bronz|šed/i);
	await expect(page.locator('input[name="skloOdoo"]')).toHaveValue(
		predvolena.value.slice('odoo:'.length)
	);
	await expect(page.locator('input[name="sklo"]')).toHaveValue(CIRE);
	await spocitaj(page);
	await expect(page.getByTestId('sklo-typ')).toHaveText(predvolena.text.split(' · ')[0]!);
	const ref = await vypocet(page);
	await page.getByRole('button', { name: '← Späť a upraviť' }).click();
	await waitHydrated(page);

	// iný Odoo typ s tým istým výpočtovým sklom → identický výpočet, plán ukazuje jeho názov
	const zvoleny = odoo.filter((o) => o.vypocet === CIRE).at(-1)!;
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
