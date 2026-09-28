// #579 časť 2 (Odoo úloha 1180 po stretnutí 28.9.: „Povolené hrúbky pri systéme si nastaví
// výroba") — editor vzorcov `/zasklenia/nastavenia` má kartu „Povolené hrúbky skla z Odoo".
// Výroba zadá LEN hrúbku + druh; výpočtové sklo appka odvodí sama a neplatnú kombináciu odmietne.
// Zmena sa prejaví v ponuke „Sklo (základ)" nárezáka bez releasu.
//
// Dve vetvy podľa prostredia v zápisovom teste (obe niečo reálne overujú, žiadny skip):
//   • CI preview BEZ Odoo → ponuka je lokálny fallback: pridaná hrúbka ju NEZMENÍ (Odoo voľby
//     nie sú), overí sa editor + audit + návrat;
//   • s Odoo (lokálne cez mock JSON-2) → po pridaní hrúbky pribudnú Odoo voľby, po odobratí zmiznú.
// Zápisový test beží len mimo LIVE (`skipAkLive`) a hrúbku vždy vráti (finally). Relačné — žiadne
// konkrétne Odoo názvy (katalóg sa v Odoo mení).
import { test, expect, type Page } from '@playwright/test';
import { collectConsole, goto, loginAs, skipAkLive, LOKALNE_SKLA } from './helpers';

const SKLO = 'Sklo (základ — určuje vzorec)';

async function editorSystemu(page: Page, system: string) {
	await goto(page, '/zasklenia/nastavenia');
	if ((await page.locator('#system').inputValue()) !== system) {
		await Promise.all([page.waitForURL(/sysStyl=/), page.selectOption('#system', system)]);
		await goto(page, page.url().replace(/^https?:\/\/[^/]+/, ''));
	}
	await expect(page.getByTestId('hrubky-skla')).toBeVisible();
}

/** Ponuka „Sklo (základ)" nárezáka pre systém: lokálne sklá + počet Odoo volieb. */
async function ponuka(page: Page, system: string) {
	await goto(page, '/zasklenia');
	await page.getByLabel('Systém').selectOption(system);
	const sel = page.getByLabel(SKLO);
	return {
		lokalne: (await sel.locator(LOKALNE_SKLA).allTextContents()).map((t) => t.trim()).sort(),
		odoo: await sel.locator('option[value^="odoo:"]').count()
	};
}

test('editor: karta povolených hrúbok ukáže odvodené výpočtové sklo (#579)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await editorSystemu(page, 'Robust');
	const karta = page.getByTestId('hrubky-skla');
	await expect(karta).toContainText('Povolené hrúbky skla z Odoo');
	// každá povolená hrúbka má výpočtové sklo (nikdy sa nezadáva — odvodené)
	for (const t of await karta.locator('form.row span').allTextContents())
		expect(t).toMatch(/\d+ mm · .+ · počíta sa ako /);
	await expect(page.locator('#hrubka-mm')).toBeVisible();
	await expect(page.locator('#hrubka-druh option')).toHaveCount(3);
	expect(errs).toEqual([]);
});

test('editor: Slide + 24 mm izolačné → ponuka nárezáka bez releasu, audit, neplatná kombinácia odmietnutá, návrat (#579)', async ({
	page
}) => {
	const errs = collectConsole(page);
	await skipAkLive(page);
	await loginAs(page);

	const pred = await ponuka(page, 'Slide');
	await editorSystemu(page, 'Slide');
	await expect(page.getByTestId('hrubka-24')).toHaveCount(0);

	try {
		await page.locator('#hrubka-mm').fill('24');
		await page.locator('#hrubka-druh').selectOption('izolacne');
		await page.getByTestId('pridat-hrubku').click();
		await expect(page.getByTestId('hrubka-ok')).toContainText('24 mm');
		await expect(page.getByTestId('hrubka-24')).toContainText(
			'počíta sa ako Izolačné sklo 4/16/4 číre'
		);
		// audit — história zmien nesie zápis
		await expect(
			page.getByText(/Povolená hrúbka skla 24 mm \(izolačné\): nie → áno/).first()
		).toBeVisible();

		const po = await ponuka(page, 'Slide');
		// lokálne sklá appky sa nemenia (výpočtový katalóg je nedotknutý)
		expect(po.lokalne).toEqual(pred.lokalne);
		if (pred.odoo > 0 || po.odoo > 0) expect(po.odoo).toBeGreaterThan(pred.odoo);
		else expect(po.odoo).toBe(0); // CI bez Odoo: lokálny fallback

		// neplatná kombinácia — Robust nemá výpočtové sklo 16 mm izolačné
		await editorSystemu(page, 'Robust');
		await page.locator('#hrubka-mm').fill('16');
		await page.locator('#hrubka-druh').selectOption('izolacne');
		await page.getByTestId('pridat-hrubku').click();
		await expect(page.getByTestId('hrubka-chyba')).toContainText('výpočtové sklo');
		await expect(page.getByTestId('hrubka-16')).toHaveCount(0);
	} finally {
		await editorSystemu(page, 'Slide');
		if ((await page.getByTestId('odobrat-hrubku-24').count()) > 0) {
			await page.getByTestId('odobrat-hrubku-24').click();
			await expect(page.getByTestId('hrubka-ok')).toContainText('odobratá');
		}
	}
	await expect(page.getByTestId('hrubka-24')).toHaveCount(0);
	const spat = await ponuka(page, 'Slide');
	expect(spat).toEqual(pred);
	expect(errs).toEqual([]);
});
