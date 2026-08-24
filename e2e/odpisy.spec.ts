// E2E: história odpisov — #294 ledger (obyčajné „Uvoľniť" identický obsah blokuje ako
// poistku, sankcionovaný „⚠️ Povoliť rovnaký" ho povolí), odhlásenie, login deep-link
// (?next=) a predvyplnenie mena. Trieda navigačných/stavových bugov + Money-kritický
// dedup/ledger. Nula console errors všade.
import { test, expect } from '@playwright/test';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	skipAkLive,
	E2E_USER,
	E2E_PASS
} from './helpers';

const RUN = `E2E-${Date.now().toString(36).toUpperCase()}`;

test('odpisy: „Uvoľniť" identický obsah blokuje ledger, „⚠️ Povoliť rovnaký" ho povolí (celý UI tok)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	page.on('dialog', (d) => d.accept()); // confirm() pri „Uvoľniť" aj „⚠️ Povoliť rovnaký"
	await loginAs(page);

	const posli = async () => {
		await goto(page, '/zasklenia');
		await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-REL`);
		await page.getByLabel('OP/OPDL číslo *').fill('01');
		await page.getByLabel('Zákazník *').fill('E2E Uvoľniť');
		await page.getByLabel('Šírka (mm) *').fill('2509');
		await page.getByLabel('Výška (mm) *').fill('1930');
		await page.getByRole('button', { name: 'Spočítať nárezový plán' }).click();
		await page.getByTestId('odoslat').click();
	};

	const rowRel = () => page.locator('tr', { hasText: `${RUN}-REL` }).first();

	// 1. prvé odoslanie prejde (zapíše dedup kľúč v odpis_log + 'import' do #294 ledgeru)
	await posli();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// 2. rovnaká ZAK+OP → duplikát (dedup kľúč odpis_log)
	await posli();
	await expect(page.getByTestId('duplikat')).toContainText('už bola odoslaná');

	// --- VETVA A: sankcionovaný override „⚠️ Povoliť rovnaký" povolí JEDEN identický re-import ---
	// Poradie override-PRV / blok-POTOM je VYNÚTENÉ kódom: aj „Povoliť rovnaký" aj „Uvoľniť"
	// MAŽÚ riadok odpis_log, no override tlačidlo ten riadok POTREBUJE (číta z neho content_hash) —
	// takže override sa musí ukázať KÝM riadok ešte existuje. Zhodné poradie ako kanonický unit
	// test tests/money-ledger.test.ts („Povoliť rovnaký … ONE-SHOT", riadky 117–137).
	await goto(page, '/odpisy');
	await rowRel().locator('button[data-testid^="povolit-reimport-"]').click();
	await expect(page.getByTestId('reimport-povoleny')).toBeVisible();

	// 3. po override sa identický obsah dá poslať znova (ledger: imports == overrides ⇒ neblokuje)
	await posli();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// --- VETVA B: obyčajné „Uvoľniť" identický obsah NEcháva prejsť — ledger ho blokuje ---
	// re-send z bodu 3 vytvoril nový odpis_log riadok → znova je to duplikát
	await posli();
	await expect(page.getByTestId('duplikat')).toContainText('už bola odoslaná');

	// obyčajné „Uvoľniť" zmaže dedup kľúč, ALE override do ledgeru NEpridá
	await goto(page, '/odpisy');
	await rowRel().getByRole('button', { name: 'Uvoľniť' }).click();
	await expect(page.getByTestId('uvolnene')).toBeVisible();

	// 4. identický re-send po obyčajnom „Uvoľniť" je ZABLOKOVANÝ append-only ledgerom (#294) —
	//    poistka proti dvojitému Money importu; jediná cesta späť je „⚠️ Povoliť rovnaký" (vetva A)
	await posli();
	await expect(page.getByTestId('duplikat')).toContainText('už bol raz importovaný do Money');

	expect(consoleMsgs).toEqual([]);
});

test('odhlásenie zmaže session a presmeruje na login', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await page.getByRole('button', { name: 'Odhlásiť' }).click();
	await expect(page).toHaveURL(/\/login/);
	// chránená stránka po odhlásení opäť presmeruje na login
	await goto(page, '/odpisy');
	await expect(page).toHaveURL(/\/login/);
	expect(consoleMsgs).toEqual([]);
});

test('login: deep-link ?next= pristane po prihlásení na PÔVODNEJ ceste', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	// neprihlásený prístup na /odpisy → login s next parametrom
	await goto(page, '/odpisy');
	await expect(page).toHaveURL(/login\?next=%2Fodpisy/);
	await page.getByLabel('Meno').fill(E2E_USER);
	await page.getByLabel('Heslo').fill(E2E_PASS);
	await page.getByRole('button', { name: 'Prihlásiť' }).click();
	// po prihlásení pristane na /odpisy, nie na defaultnom /zasklenia
	await expect(page).toHaveURL(/\/odpisy/);
	await waitHydrated(page);
	expect(consoleMsgs).toEqual([]);
});

test('login: po zlom hesle ostane meno predvyplnené', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await goto(page, '/login');
	await page.getByLabel('Meno').fill('e2e');
	await page.getByLabel('Heslo').fill('zle-heslo');
	await page.getByRole('button', { name: 'Prihlásiť' }).click();
	await expect(page.getByTestId('login-error')).toBeVisible();
	// meno sa NEvynuluje (trieda bugu „späť vynuluje formulár")
	await expect(page.getByLabel('Meno')).toHaveValue('e2e');
	expect(consoleMsgs).toEqual([]);
});
