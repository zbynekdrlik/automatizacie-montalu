// #235 slice 2 — E2E: vlastná (nekatalógová) skladba skla „Iné (vlastná skladba)".
//
// Reálny používateľský tok cez prehliadač: v glass selecte zvolím „Iné", odhalí sa výber
// hrúbkovej triedy + textové pole skladby, vyplním „5esg/14/5esg" + triedu 24, spočítam —
// na nárezovom pláne sa zobrazí TEXT skladby (nie sentinel) a cena je „nedostupná" (honest-null).
// Prvý test je ČÍTACÍ (Spočítať iba počíta, nezapisuje — beží aj proti nasadeniu). Druhý test
// ZAPISUJE (Odoslať odpis) → `skipAkLive` ho preskočí proti LIVE nasadeniu (Money-safety).
import { test, expect } from '@playwright/test';
import { collectConsole, loginAs, vyberFarbuKovania, skipAkLive } from './helpers';

const SKLO_INE = 'Iné (vlastná skladba)';

async function zadajVlastnuSkladbu(page: import('@playwright/test').Page) {
	await page.selectOption('#system', 'Štandard +');
	// pred voľbou „Iné" trieda-select NEEXISTUJE
	await expect(page.getByTestId('ine-trieda')).toHaveCount(0);
	await page.selectOption('#sklo', SKLO_INE);
	// po voľbe „Iné" sa odhalí výber triedy + text sa stane povinný
	await expect(page.getByTestId('ine-trieda')).toBeVisible();
	await page.selectOption('#skloTrieda', '24');
	await page.fill('#skloPresne', '5esg/14/5esg');
	await page.fill('#s', '3000');
	await page.fill('#v', '2000');
	await vyberFarbuKovania(page); // no-op pre Štandard + (nemá farebné kovanie)
}

test('„Iné" → text + trieda → Spočítať → vlastná skladba je na pláne, cena nedostupná', async ({
	page
}) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await zadajVlastnuSkladbu(page);

	await page.getByRole('button', { name: /Spočítať nárezový plán/ }).click();

	// na pláne sa v „Typ" zobrazí TEXT vlastnej skladby (nie „Iné (vlastná skladba)")
	await expect(page.getByTestId('sklo-typ')).toHaveText('5esg/14/5esg');
	// honest-null cena skla (variant nie je v cenníku → „cena nedostupná")
	await expect(page.getByText('cena nedostupná').first()).toBeVisible();

	expect(errs).toEqual([]);
});

test('prepnutie späť na katalógové sklo skryje výber triedy (reaktivita)', async ({ page }) => {
	const errs = collectConsole(page);
	await loginAs(page);
	await page.selectOption('#system', 'Štandard +');
	await page.selectOption('#sklo', SKLO_INE);
	await expect(page.getByTestId('ine-trieda')).toBeVisible();
	// späť na katalógové sklo → trieda-select zmizne
	await page.selectOption('#sklo', 'Float sklo 6 mm');
	await expect(page.getByTestId('ine-trieda')).toHaveCount(0);
	expect(errs).toEqual([]);
});

test('„Iné" → Odoslať odpis prejde celým tokom (TEST priečinok)', async ({ page }) => {
	await skipAkLive(page); // zápisový test — NIKDY proti LIVE Money
	const errs = collectConsole(page);
	await loginAs(page);
	await page.fill('#zak', 'E2E-INE-1');
	await page.fill('#op', 'OP1');
	await page.fill('#zakaznik', 'E2E zákazník');
	await zadajVlastnuSkladbu(page);

	await page.getByRole('button', { name: /Spočítať nárezový plán/ }).click();
	await expect(page.getByTestId('sklo-typ')).toHaveText('5esg/14/5esg');

	await page.getByRole('button', { name: /Odoslať odpis/ }).click();
	// hotovo obrazovka — úspešný výsledok + text skladby ostáva na pláne
	await expect(page.getByTestId('vysledok')).toBeVisible();
	await expect(page.getByTestId('sklo-typ')).toHaveText('5esg/14/5esg');

	expect(errs).toEqual([]);
});
