// #613 — interný admin nastaví EXISTUJÚCEMU účtu nové heslo na /pouzivatelia (zabudnuté heslo:
// PROD 19.10. účet `predaj` 4× bad_password, appka dovtedy heslo vedela nastaviť len pri založení).
// Reálny tok cez prehliadač: throwaway B2B účet (zaručené upratanie fixture `e2eUcty`, #583) →
// prihlásený v druhom prehliadači → admin nastaví nové heslo (najprv preklep v potvrdení) → stará
// relácia toho účtu padne na /login → staré heslo neprejde, nové áno. Žiadne heslo natvrdo v repe
// (PROD účet žije počas behu) — beží aj post-deploy proti PROD (users tabuľka nie je Money).
import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, zalozB2bUcet } from './ucty';
import { collectConsole, loginAs, goto, logout } from './helpers';

/** Riadok účtu podľa PRESNEJ bunky mena — podreťazec by pri paralelnom behu chytil cudzí účet. */
function riadokUctu(page: Page, username: string) {
	return page
		.getByTestId('pouzivatelia-tabulka')
		.locator('tbody tr')
		.filter({ has: page.getByRole('cell', { name: username, exact: true }) });
}

/** Rozbalí „Nastaviť nové heslo" pri účte (ak je zbalené), vyplní heslo + potvrdenie a uloží. */
async function nastavHeslo(page: Page, username: string, heslo: string, potvrdenie = heslo) {
	const riadok = riadokUctu(page, username);
	const rozbalenie = riadok.getByTestId('nove-heslo');
	// summary klik PREPÍNA — otvor len zbalené (stav čítaný po hydratácii, goto() ju čaká)
	if ((await rozbalenie.getAttribute('open')) === null)
		await riadok.getByTestId('nove-heslo-toggle').click();
	await expect(rozbalenie).toHaveAttribute('open', '');
	await riadok.getByLabel('Nové heslo', { exact: true }).fill(heslo);
	await riadok.getByLabel('Nové heslo znova', { exact: true }).fill(potvrdenie);
	await riadok.getByRole('button', { name: 'Uložiť heslo' }).click();
}

/** Pokus o prihlásenie bez očakávania úspechu (loginAs by na zlom hesle čakal /zasklenia). */
async function skusPrihlasit(page: Page, username: string, heslo: string) {
	await goto(page, '/login');
	await page.getByLabel('Meno').fill(username);
	await page.getByLabel('Heslo').fill(heslo);
	await page.getByRole('button', { name: 'Prihlásiť' }).click();
}

test('admin nastaví účtu nové heslo — stará relácia padne, staré heslo neprejde, nové áno', async ({
	page,
	browser,
	e2eUcty
}, testInfo) => {
	const consoleMsgs = collectConsole(page);
	const ucet = `e2e-heslo-${Date.now().toString(36)}`;
	const noveHeslo = `e2e-${randomBytes(12).toString('base64url')}`;

	// 1. admin založí throwaway B2B účet (fixture ho zmaže aj pri páde testu)
	await loginAs(page);
	const stareHeslo = await zalozB2bUcet(page, e2eUcty, ucet);

	// 2. používateľ toho účtu je prihlásený v INOM prehliadači (staré heslo) — relácia, ktorú
	//    nové heslo musí zrušiť
	const ciel = testInfo.project.use;
	const inyKontext = await browser.newContext({
		baseURL: ciel.baseURL,
		extraHTTPHeaders: ciel.extraHTTPHeaders,
		ignoreHTTPSErrors: ciel.ignoreHTTPSErrors
	});
	try {
		const inaStranka = await inyKontext.newPage();
		await loginAs(inaStranka, ucet, stareHeslo);

		// 3. admin: preklep v potvrdení → chyba pri riadku účtu, nič sa nezmení
		await goto(page, '/pouzivatelia');
		await nastavHeslo(page, ucet, noveHeslo, noveHeslo + 'x');
		await expect(riadokUctu(page, ucet).getByTestId('nove-heslo-stav')).toContainText('nezhodujú');

		// 4. admin: zhodné heslo → potvrdenie pri riadku, rozbalenie sa zavrie
		await nastavHeslo(page, ucet, noveHeslo);
		const stav = riadokUctu(page, ucet).getByTestId('nove-heslo-stav');
		await expect(stav).toContainText('je nastavené');
		await expect(stav).toContainText(ucet);
		await expect(riadokUctu(page, ucet).getByTestId('nove-heslo')).not.toHaveAttribute('open');

		// 5. stará relácia v druhom prehliadači je zrušená → ďalšia navigácia skončí na /login
		await goto(inaStranka, '/zasklenia');
		await expect(inaStranka).toHaveURL(/\/login/);
	} finally {
		await inyKontext.close();
	}

	// 6. staré heslo neprejde, nové prejde
	await logout(page);
	await skusPrihlasit(page, ucet, stareHeslo);
	await expect(page.getByTestId('login-error')).toContainText('Nesprávne meno alebo heslo');
	await expect(page).toHaveURL(/\/login/);
	await loginAs(page, ucet, noveHeslo);
	await logout(page);

	expect(consoleMsgs).toEqual([]);
});
