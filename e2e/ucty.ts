// #583: ZARUČENÉ upratanie throwaway účtov, ktoré E2E zakladá na cieli (lokálny preview AJ PROD
// post-deploy cez BASE_URL). Predtým každý test mazal účet až na svojom konci → akékoľvek zlyhanie po
// vytvorení nechalo na PROD B2B účet s heslom natvrdo vo verejnom repe (e2e-b2b-mul90ik9, 0.25.50).
//
// Mechanizmus:
// - fixture `e2eUcty` — test účet ZAREGISTRUJE PRED odoslaním „Pridať účet"; teardown fixture beží VŽDY
//   (aj po páde / timeoute testu) a zmaže zaregistrované účty cez /pouzivatelia v SAMOSTATNOM admin
//   kontexte (stav testovej stránky — prihlásený B2B, otvorený náhľad, zaseknutý dialóg — nehrá rolu).
// - `zmazE2eUcty` — spoločné jadro, volá ho aj globalSetup sweep (zvyšky `e2e-` z minulých behov).
// Maže sa LEN cez sankcionovaný UI tok (tlačidlo „Zmazať" na /pouzivatelia), LEN B2B účty (interný
// UI nezmaže) a LEN mená s prefixom `e2e-` — nikdy E2E admin samotný.
import {
	test as base,
	expect,
	type Browser,
	type BrowserContextOptions,
	type Page
} from '@playwright/test';
import { E2E_USER, goto, loginAs } from './helpers';

export const E2E_UCET_PREFIX = 'e2e-';

type Ciel = Pick<BrowserContextOptions, 'baseURL' | 'extraHTTPHeaders' | 'ignoreHTTPSErrors'>;

/** Mená účtov v tabuľke /pouzivatelia (prvý stĺpec bez odznaku „ja") + či je riadok B2B. */
async function nacitajUcty(page: Page): Promise<{ username: string; b2b: boolean }[]> {
	return page.getByTestId('pouzivatelia-tabulka').evaluate((t) =>
		Array.from(t.querySelectorAll('tbody tr')).map((tr) => {
			const td = tr.querySelectorAll('td');
			const menoTd = td[0]!.cloneNode(true) as HTMLElement;
			menoTd.querySelector('.badge')?.remove();
			return {
				username: (menoTd.textContent ?? '').trim(),
				// „Zmazať" sa renderuje LEN pre B2B riadok (interný účet UI nezmaže)
				b2b: !!td[3]?.querySelector('button')
			};
		})
	);
}

/**
 * Prihlási E2E admina v NOVOM kontexte a zmaže B2B účty, ktoré vyberie `vyber` (vždy len prefix
 * `e2e-`, nikdy E2E admin). Vracia zoznam zmazaných mien. Chyba pri mazaní padne HLASNO — upratanie,
 * ktoré ticho zlyhá, je presne to, čo nechalo účet na PROD.
 */
export async function zmazE2eUcty(
	browser: Browser,
	ciel: Ciel,
	vyber: (username: string) => boolean
): Promise<string[]> {
	const context = await browser.newContext({
		baseURL: ciel.baseURL,
		extraHTTPHeaders: ciel.extraHTTPHeaders,
		ignoreHTTPSErrors: ciel.ignoreHTTPSErrors
	});
	const zmazane: string[] = [];
	try {
		const page = await context.newPage();
		page.on('dialog', (d) => d.accept()); // confirm() pri Zmazať
		await loginAs(page);
		await page.goto('/pouzivatelia');
		const ciele = (await nacitajUcty(page)).filter(
			(u) =>
				u.b2b &&
				u.username.startsWith(E2E_UCET_PREFIX) &&
				u.username !== E2E_USER &&
				vyber(u.username)
		);
		for (const { username } of ciele) {
			const row = page
				.getByTestId('pouzivatelia-tabulka')
				.locator('tbody tr')
				.filter({ has: page.getByRole('cell', { name: username, exact: true }) });
			await row.getByRole('button', { name: 'Zmazať' }).click();
			await expect(page.getByTestId('pouzivatelia-ok')).toContainText('zmazaný');
			await expect(
				page.getByRole('cell', { name: username, exact: true }),
				`účet ${username} po Zmazať stále existuje`
			).toHaveCount(0);
			zmazane.push(username);
		}
	} finally {
		await context.close();
	}
	return zmazane;
}

export type E2eUcty = {
	/** Zaregistruj účet na zaručené zmazanie — volaj PRED „Pridať účet" (zmazanie neexistujúceho = no-op). */
	zaregistruj(username: string): void;
};

export const test = base.extend<{ e2eUcty: E2eUcty }>({
	e2eUcty: async ({ browser }, use, testInfo) => {
		const ucty = new Set<string>();
		await use({
			zaregistruj(username) {
				if (!username.startsWith(E2E_UCET_PREFIX) || username === E2E_USER)
					throw new Error(`E2E účet musí mať prefix „${E2E_UCET_PREFIX}": ${username}`);
				ucty.add(username);
			}
		});
		// teardown — beží aj po páde/timeoute testu
		if (ucty.size) await zmazE2eUcty(browser, testInfo.project.use, (u) => ucty.has(u));
	}
});

export { expect };

/**
 * Založí throwaway B2B účet cez /pouzivatelia (stránka už musí byť prihlásená ako interný) a
 * PREDTÝM ho zaregistruje na zaručené zmazanie.
 */
export async function zalozB2bUcet(
	page: Page,
	e2eUcty: E2eUcty,
	username: string,
	password: string
) {
	e2eUcty.zaregistruj(username);
	await goto(page, '/pouzivatelia');
	await page.getByLabel('Prihlasovacie meno').fill(username);
	await page.getByLabel('Heslo (min. 6 znakov)').fill(password);
	await page.getByRole('button', { name: 'Pridať účet' }).click(); // rola defaultne B2B
	await expect(page.getByTestId('pouzivatelia-ok')).toContainText('vytvorený');
}
