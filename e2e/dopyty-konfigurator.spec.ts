// #282 — interný zoznam dopytov /dopyty-konfigurator. Prihlásený interný používateľ vidí
// hodnoty NASEEDOVANÉHO dopytu + súhrn konfigurácie, stiahne PDF, nula console errors;
// neprihlásený → redirect na login.
//
// Seed: dopyt tabuľka nemá (zatiaľ) namountovaný verejný submit formulár (to je integrácia
// #275), takže testovací dopyt vložíme priamo do zdieľaného e2e.db súboru (appka beží ako
// lokálny child preview servera → zdieľa filesystem, rovnaký vzor ako #154 ceny fixture).
// Preto je seed test PREVIEW-only (proti nasadeniu (BASE_URL) nemáme na DB súbor prístup).
import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { collectConsole, loginAs, goto } from './helpers';

const DB_PATH = process.env.DATABASE_PATH || './data/e2e.db';

const SEED_MENO = 'E2E Dopyt Novák';
const SEED_EMAIL = 'e2e-dopyt@example.com';
const SEED_MIESTO = 'Trnava';
const SEED_CFG = {
	system: 'Robust',
	typStrechy: 'bioklimatická lamelová',
	sirka: 3000,
	hlbka: 4000,
	farba: 'RAL 7016',
	sklo: 'Deluxe Float'
};

/** Vloží testovací dopyt priamo do zdieľaného e2e.db (preview-only). Vráti nové id. */
function seedDopyt(): number {
	const db = new Database(DB_PATH);
	try {
		const info = db
			.prepare(
				`INSERT INTO dopyt (konfiguracia, meno, email, telefon, miesto, poznamka)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(
				JSON.stringify(SEED_CFG),
				SEED_MENO,
				SEED_EMAIL,
				'+421 900 111 222',
				SEED_MIESTO,
				'ozvite sa'
			);
		return Number(info.lastInsertRowid);
	} finally {
		db.close();
	}
}

test('interný zoznam: prihlásený vidí dopyt + súhrn a stiahne PDF (nula console)', async ({
	page
}) => {
	test.skip(!!process.env.BASE_URL, 'seed cez lokálny DB súbor — len preview beh');
	const consoleMsgs = collectConsole(page);
	seedDopyt();

	await loginAs(page);
	await goto(page, '/dopyty-konfigurator');

	// riadok nášho dopytu podľa mena
	const row = page.locator('tr', { hasText: SEED_MENO }).first();
	await expect(row).toBeVisible();
	await expect(row).toContainText(SEED_EMAIL);
	await expect(row).toContainText(SEED_MIESTO);
	// súhrn konfigurácie (znovupoužitý zhrnutieRiadky)
	await expect(row).toContainText('Robust');
	await expect(row).toContainText('3000 × 4000 mm');
	await expect(row).toContainText('RAL 7016');
	await expect(row).toContainText('Deluxe Float');

	// re-download PDF ponuky pre tento dopyt
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		row.getByRole('link', { name: /PDF/ }).click()
	]);
	expect(download.suggestedFilename()).toMatch(/^Montalu-ponuka-dopyt-\d+-\d{4}-\d{2}-\d{2}\.pdf$/);

	expect(consoleMsgs).toEqual([]);
});

test('neprihlásený používateľ je z /dopyty-konfigurator presmerovaný na login', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await page.goto('/dopyty-konfigurator');
	await expect(page).toHaveURL(/\/login/);
	// deep-link sa po prihlásení nesmie stratiť (next param)
	await expect(page).toHaveURL(/next=.*dopyty-konfigurator/);
	expect(consoleMsgs).toEqual([]);
});
