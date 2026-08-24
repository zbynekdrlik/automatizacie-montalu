// E2E: história odpisov (uvoľnenie dedup kľúča), odhlásenie, login deep-link
// (?next=) a predvyplnenie mena. Trieda navigačných/stavových bugov + Money-
// kritické uvoľnenie. Nula console errors všade.
import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
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

test('odpisy: uvoľnenie dovolí poslať tú istú ZAK+OP znova (celý UI tok)', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	page.on('dialog', (d) => d.accept()); // confirm() pri Uvoľniť
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

	// 1. prvé odoslanie prejde
	await posli();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// 2. rovnaká ZAK+OP → duplikát
	await posli();
	await expect(page.getByTestId('duplikat')).toContainText('už bola odoslaná');

	// 3. história → Uvoľniť ten záznam
	await goto(page, '/odpisy');
	const row = page.locator('tr', { hasText: `${RUN}-REL` }).first();
	await row.getByRole('button', { name: 'Uvoľniť' }).click();
	await expect(page.getByTestId('uvolnene')).toBeVisible();

	// 4. po uvoľnení sa tá istá ZAK+OP dá poslať znova (nie duplikát)
	await posli();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');
	expect(consoleMsgs).toEqual([]);
});

test('odpisy: Money readback badge — ✅ overené aj ⛔ chýba doklad sa vykreslí (#298)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	// seeduje LOKÁLNU zdieľanú e2e DB (WAL → preview server to vidí) — proti nasadenému cieľu (BASE_URL)
	// sa DB priamo zapísať nedá, preto skip (sankcionovaný data-safety guard).
	test.skip(!!process.env.BASE_URL, 'seeduje lokálnu e2e DB — nedá sa proti nasadenému cieľu');
	// MONEY_LIVE=0, takže žiadny súbor do Money — sú to len DB riadky. Fixné vysoké id (nekolidujú
	// s UI-tvorenými riadkami). zak/op sú už normalizované (uppercase, bez medzier).
	const db = new Database('./data/e2e.db');
	try {
		const insOdpis = db.prepare(
			`INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
			 VALUES (?, 'zasklenia', ?, 'OP298', 'E2E Readback', 0, 1, '/t/f.xlsx', 'f.xlsx', 'h', '{}', 'e2e', datetime('now','-30 minutes'), ?, 'OP298')`
		);
		const insP = db.prepare(
			"INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (?, ?, ?, ?, 'm')"
		);
		// A (id 90001): sediaci DLV (2 pol.) → ✅ overené
		insOdpis.run(90001, 'E2E-RB-OK', 'E2E-RB-OK');
		insP.run(90001, 'ZASP1', 'P1', 3);
		insP.run(90001, 'ZASP2', 'P2', 5);
		// B (id 90002): žiadny DLV → ⛔ Money doklad chýba
		insOdpis.run(90002, 'E2E-RB-MISS', 'E2E-RB-MISS');
		insP.run(90002, 'ZASP1', 'P1', 3);
		insP.run(90002, 'ZASP2', 'P2', 5);
		db.prepare(
			"INSERT INTO money_dlv (dlv, zak_norm, op_norm, pocet_polozek) VALUES ('DLVE2E', 'E2E-RB-OK', 'OP298', 2)"
		).run();
		db.prepare(
			"INSERT OR REPLACE INTO money_dlv_meta (id, snapshot_generated_at, imported_at, row_count, window_days) VALUES (1, datetime('now'), datetime('now'), 1, 0)"
		).run();
	} finally {
		db.close();
	}
	await loginAs(page);
	await goto(page, '/odpisy');
	await expect(page.getByRole('columnheader', { name: 'Overenie' })).toBeVisible();
	await expect(page.getByTestId('readback-90001')).toContainText('overené');
	await expect(page.getByTestId('readback-90002')).toContainText('chýba');
	await expect(page.getByTestId('readback-stav')).toContainText('readback z');
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
