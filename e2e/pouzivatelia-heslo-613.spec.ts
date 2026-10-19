// #613 — interný admin nastaví EXISTUJÚCEMU účtu nové heslo na /pouzivatelia (zabudnuté heslo:
// PROD 19.10. účet `predaj` 4× bad_password, appka dovtedy heslo vedela nastaviť len pri založení).
// Reálny tok cez prehliadač: throwaway B2B účet (zaručené upratanie fixture `e2eUcty`, #583) →
// prihlásený v druhom prehliadači → admin nastaví nové heslo (najprv preklep v potvrdení) → stará
// relácia toho účtu padne na /login → staré heslo neprejde, nové áno. Žiadne heslo natvrdo v repe
// (PROD účet žije počas behu) — prvý test beží aj post-deploy proti PROD (users tabuľka nie je Money).
// Druhá časť #613: zmena hesla je TRVALÝ audit (`user_audit` password_reset) → história účtov na
// /pouzivatelia ukáže presne jeden riadok „<kto> · heslo zmenené · <účet>" (preklep nič nezapíše).
import { randomBytes } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { test, expect, zalozB2bUcet } from './ucty';
import { collectConsole, loginAs, goto, logout, skipAkLive, E2E_USER } from './helpers';

const nahodneHeslo = () => `e2e-${randomBytes(12).toString('base64url')}`;

/** Riadok účtu podľa PRESNEJ bunky mena — podreťazec by pri paralelnom behu chytil cudzí účet. */
function riadokUctu(page: Page, username: string) {
	return page
		.getByTestId('pouzivatelia-tabulka')
		.locator('tbody tr')
		.filter({ has: page.getByRole('cell', { name: username, exact: true }) });
}

/** Vlastný riadok = riadok s odznakom „ja" (bunka mena má aj odznak, presná zhoda mena nesedí). */
function vlastnyRiadok(page: Page) {
	return page.locator('tr', { has: page.locator('.badge', { hasText: /^ja$/ }) });
}

/** Rozbalí „Nastaviť nové heslo" v riadku (ak je zbalené), vyplní heslo + potvrdenie a uloží. */
async function nastavHeslo(riadok: Locator, heslo: string, potvrdenie = heslo) {
	const rozbalenie = riadok.getByTestId('nove-heslo');
	// summary klik PREPÍNA — otvor len zbalené (stav čítaný po hydratácii, goto() ju čaká)
	if ((await rozbalenie.getAttribute('open')) === null)
		await riadok.getByTestId('nove-heslo-toggle').click();
	await expect(rozbalenie).toHaveAttribute('open', '');
	await riadok.getByLabel('Nové heslo', { exact: true }).fill(heslo);
	await riadok.getByLabel('Nové heslo znova', { exact: true }).fill(potvrdenie);
	await riadok.getByRole('button', { name: 'Uložiť heslo' }).click();
}

/**
 * Riadky histórie účtov „heslo zmenené" pre daný účet — účet je na KONCI riadka (pri zmene hesla
 * je detail prázdny), takže cudzí `e2e-…` účet s podobným menom sa nechytí.
 */
function zmenyHesla(page: Page, ucet: string) {
	expect(ucet).toMatch(/^[a-z0-9-]+$/); // meno bez regex znakov — vkladá sa do RegExp nižšie
	return page
		.getByTestId('pouzivatelia-historia')
		.getByTestId('historia-riadok')
		.filter({ hasText: new RegExp(` · heslo zmenené · ${ucet}\\s*$`) });
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
	const noveHeslo = nahodneHeslo();

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
		await nastavHeslo(riadokUctu(page, ucet), noveHeslo, noveHeslo + 'x');
		await expect(riadokUctu(page, ucet).getByTestId('nove-heslo-stav')).toContainText('nezhodujú');
		// preklep nič nezmenil → v histórii účtov ešte žiadna zmena hesla tohto účtu
		await expect(zmenyHesla(page, ucet)).toHaveCount(0);

		// 4. admin: zhodné heslo → potvrdenie pri riadku, rozbalenie sa zavrie
		await nastavHeslo(riadokUctu(page, ucet), noveHeslo);
		const stav = riadokUctu(page, ucet).getByTestId('nove-heslo-stav');
		await expect(stav).toContainText('je nastavené');
		await expect(stav).toContainText(ucet);
		await expect(riadokUctu(page, ucet).getByTestId('nove-heslo')).not.toHaveAttribute('open');
		// trvalý audit: história účtov ukáže PRESNE jednu zmenu hesla tohto účtu, od admina, bez hesla
		await expect(zmenyHesla(page, ucet)).toHaveCount(1);
		await expect(zmenyHesla(page, ucet)).toContainText(` · ${E2E_USER} · heslo zmenené · ${ucet}`);
		await expect(page.getByTestId('pouzivatelia-historia')).not.toContainText(noveHeslo);

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

test('vlastný účet: potvrdenie — Zrušiť nič nezmení, OK nastaví heslo a odhlási', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	// interný účet UI nezmaže priamo (len cez rolu B2B → Zmazať) — na LIVE cieli by mohol ostať,
	// preto len proti lokálnemu preview; upratanie vo `finally` beží aj pri páde (#571 vzor)
	await skipAkLive(page);
	const dialogy: string[] = [];
	let odpoved: 'dismiss' | 'accept' = 'dismiss';
	page.on('dialog', (d) => {
		dialogy.push(d.message());
		void (odpoved === 'accept' ? d.accept() : d.dismiss());
	});
	// každé odoslanie „noveHeslo" — Zrušiť v potvrdení NESMIE poslať nič (overené na konci, keď sú
	// všetky požiadavky isto vydané; okamžitá kontrola po Zrušiť by prehrala preteky s fetchom)
	const postyNoveHeslo: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && r.url().includes('/noveHeslo')) postyNoveHeslo.push(r.url());
	});
	const ucet = `e2e-self-${Date.now().toString(36)}`;
	const stareHeslo = nahodneHeslo();
	const noveHeslo = nahodneHeslo();

	await loginAs(page);
	await goto(page, '/pouzivatelia');
	await page.getByLabel('Prihlasovacie meno').fill(ucet);
	await page.getByLabel('Heslo (min. 6 znakov)').fill(stareHeslo);
	await page.getByLabel('Rola').selectOption('internal');
	try {
		await page.getByRole('button', { name: 'Pridať účet' }).click();
		await expect(page.getByTestId('pouzivatelia-ok')).toContainText('Interný');

		// 1. nový interný účet si sám otvorí /pouzivatelia a chce nové heslo — Zrušiť v potvrdení
		await logout(page);
		await loginAs(page, ucet, stareHeslo);
		await goto(page, '/pouzivatelia');
		await nastavHeslo(vlastnyRiadok(page), noveHeslo);
		await expect.poll(() => dialogy.length).toBe(1);
		expect(dialogy[0]).toContain('VLASTNÉMU');
		await expect(page).toHaveURL(/\/pouzivatelia/); // zrušené = žiadne odoslanie, ostáva prihlásený
		await expect(vlastnyRiadok(page).getByTestId('nove-heslo-stav')).toHaveCount(0);

		// 2. OK v potvrdení → heslo nastavené, všetky relácie (aj táto) zrušené → /login
		odpoved = 'accept';
		await vlastnyRiadok(page).getByRole('button', { name: 'Uložiť heslo' }).click();
		await expect(page).toHaveURL(/\/login/);
		expect(dialogy).toHaveLength(2);

		// 3. staré heslo neprejde, nové prejde
		await skusPrihlasit(page, ucet, stareHeslo);
		await expect(page.getByTestId('login-error')).toContainText('Nesprávne meno alebo heslo');
		await loginAs(page, ucet, noveHeslo);
		// odoslanie bolo PRESNE jedno (to po OK) — Zrušiť nič neposlalo
		expect(postyNoveHeslo).toHaveLength(1);
		// trvalý audit: jedna zmena hesla, ktorú si účet urobil SÁM (Zrušiť nič nezapísalo)
		await goto(page, '/pouzivatelia');
		await expect(zmenyHesla(page, ucet)).toHaveCount(1);
		await expect(zmenyHesla(page, ucet)).toContainText(` · ${ucet} · heslo zmenené · ${ucet}`);
	} finally {
		// upratanie aj pri páde: interný → B2B → Zmazať
		await page.context().clearCookies();
		await loginAs(page);
		await goto(page, '/pouzivatelia');
		const riadok = riadokUctu(page, ucet);
		if ((await riadok.count()) > 0) {
			odpoved = 'accept'; // confirm() pri zmene roly aj pri Zmazať
			await riadok.locator('select[name="role"]').selectOption('b2b');
			await riadok.getByRole('button', { name: 'Zmeniť' }).click();
			await expect(page.getByTestId('pouzivatelia-ok')).toContainText('B2B');
			await riadok.getByRole('button', { name: 'Zmazať' }).click();
			await expect(page.getByTestId('pouzivatelia-ok')).toContainText('zmazaný');
		}
	}

	expect(consoleMsgs).toEqual([]);
});
