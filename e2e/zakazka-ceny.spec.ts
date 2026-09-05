// E2E: cenový zoznam odpísaného materiálu K ZÁKAZKE (#154, časti 1+2) —
// /odpisy/zakazka/[zak]: agregát všetkých odpisov jednej ZAK (group by kod, LIVE
// scope), ceny z denného Money snapshotu (honest-null „cena neznáma"), readback
// overenie, navigácia z histórie aj z detailu, tlačidlo tlače. VŠETKY ceny sú
// VYMYSLENÉ (repo je verejné). Nula console errors.
//
// Pasca poradia specov (#232, ceny-snapshot rule): e2e DB je ZDIEĽANÁ na celý beh —
// virgin-DB hlášky sa tu NEassertujú; material_prices sa seeduje PRIAMO s unikátnymi
// kódmi (UPSERT importu ich nikdy nezmaže) a „cena neznáma" sa testuje na kóde,
// ktorý nie je v žiadnom seede.
import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { collectConsole, loginAs, goto, waitHydrated, stubWindowPrint } from './helpers';

test('zákazka: agregovaný cenový zoznam cez viac odpisov — súčty, „cena neznáma", TEST mimo súčtov, readback, tlač (#154)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	// seeduje LOKÁLNU zdieľanú e2e DB (WAL → preview server to vidí) — proti nasadenému cieľu skip
	test.skip(!!process.env.BASE_URL, 'seeduje lokálnu e2e DB — nedá sa proti nasadenému cieľu');
	// MONEY_LIVE=0 → žiadny súbor do Money, sú to len DB riadky. Fixné vysoké id
	// (91xxx — nekolidujú s 90xxx v odpisy.spec ani s UI-tvorenými riadkami).
	const db = new Database('./data/e2e.db');
	try {
		const insOdpis = db.prepare(
			`INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
			 VALUES (?, ?, 'E2E-ZC-AGG', ?, 'E2E Zákazka', 0, ?, '/t/f.xlsx', 'f.xlsx', ?, '{}', 'e2e', datetime('now','-30 minutes'), 'E2E-ZC-AGG', ?)`
		);
		const insP = db.prepare(
			'INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (?, ?, ?, ?, ?)'
		);
		// LIVE zasklenia (2 pol.) — napáruje sa na DLV nižšie → ✅ overené
		insOdpis.run(91501, 'zasklenia', 'OP1541', 1, 'hzc1', 'OP1541');
		insP.run(91501, 'ZASP-E2E-ZC-1', 'E2E Profil 1', 3, 'm');
		insP.run(91501, 'ZASP-E2E-ZC-2', 'E2E Profil 2', 1.5, 'm');
		// LIVE pergola (3 pol.) — žiadny DLV → ⛔ doklad chýba; zdieľa kód ZC-1 (agregácia 3+2=5)
		insOdpis.run(91502, 'pergola', 'OP1542', 1, 'hzc2', 'OP1542');
		insP.run(91502, 'ZASP-E2E-ZC-1', 'E2E Profil 1', 2, 'm');
		insP.run(91502, 'ZASP-E2E-ZC-3', 'E2E Profil 3', 1, 'm');
		insP.run(91502, 'E2E-ZC-NEZNAMY', 'E2E Bez ceny', 4, 'ks');
		// 🧪 TEST odpis tej istej ZAK — v zozname áno, do súčtov NIE
		insOdpis.run(91503, 'zasklenia', 'OP1541', 0, 'hzc3', 'OP1541');
		insP.run(91503, 'E2E-ZC-TESTKOD', 'E2E Testový kód', 9, 'm');
		// Money DLV sedí LEN na 91501 (op_norm + počet v pásme [2..2])
		db.prepare(
			"INSERT OR REPLACE INTO money_dlv (dlv, zak_norm, op_norm, pocet_polozek) VALUES ('DLVZC1', 'E2E-ZC-AGG', 'OP1541', 2)"
		).run();
		db.prepare(
			"INSERT OR REPLACE INTO money_dlv_meta (id, snapshot_generated_at, imported_at, row_count, window_days) VALUES (1, datetime('now'), datetime('now'), 1, 0)"
		).run();
		// cena LEN pre ZC-1 (vymyslená) — ostatné kódy = „cena neznáma", súčty ⚠ neúplné
		db.prepare(
			"INSERT OR REPLACE INTO material_prices (kod, nakup_cennik, nakup_posledna_faktura, predaj_vo, mena, sklad) VALUES ('ZASP-E2E-ZC-1', 4.5, 4.8, 7.0, 'EUR', 12)"
		).run();
	} finally {
		db.close();
	}
	await loginAs(page);

	// navigácia z histórie: ZAK bunka je link na zákazku
	await goto(page, '/odpisy');
	await page.getByTestId('zakazka-link-91501').click();
	await expect(page).toHaveURL(/\/odpisy\/zakazka\/E2E-ZC-AGG/);
	await waitHydrated(page);

	// hlavička + scope: súčty z 2 LIVE odpisov, TEST mimo súčtov
	await expect(page.getByTestId('zakazka-hlavicka')).toContainText('Zákazka E2E-ZC-AGG');
	await expect(page.getByTestId('zakazka-scope')).toContainText('odpisy — 2 z 3');
	await expect(page.getByTestId('zakazka-scope')).toContainText(
		'TEST odpisy sa do súčtov nepočítajú'
	);

	// zoznam odpisov: všetky 3 (LIVE aj TEST) + readback verdikty LIVE odpisov
	const tabulka = page.getByTestId('odpisy-zakazky-tabulka');
	await expect(tabulka.locator('tbody tr')).toHaveCount(3);
	await expect(page.getByTestId('zak-readback-91501')).toContainText('overené');
	await expect(page.getByTestId('zak-readback-91502')).toContainText('chýba');

	// agregát: zdieľaný kód sčítaný cez odpisy (3+2=5 m), TEST kód v agregáte NIE JE
	const ceny = page.getByTestId('ceny-tabulka');
	await expect(ceny.locator('tr', { hasText: 'ZASP-E2E-ZC-1' })).toContainText('5 m');
	await expect(ceny.locator('tr', { hasText: 'E2E-ZC-NEZNAMY' })).toContainText('4 ks');
	await expect(ceny).not.toContainText('E2E-ZC-TESTKOD');

	// ceny: vymyslený cenník pre ZC-1, honest-null pre neznámy kód, súčty ⚠ neúplné
	await expect(page.getByTestId('cena-nakup-cennik-ZASP-E2E-ZC-1')).toContainText('4,50');
	await expect(page.getByTestId('cena-predaj-vo-ZASP-E2E-ZC-1')).toContainText('7,00');
	await expect(page.getByTestId('cena-nakup-cennik-E2E-ZC-NEZNAMY')).toContainText('cena neznáma');
	await expect(page.getByTestId('ceny-sucet-nakup-cennik')).toContainText('22,50');
	await expect(page.getByTestId('ceny-sucet-nakup-cennik')).toContainText('neúplné');

	// tlač je k dispozícii (print CSS — samotný window.print() sa v e2e nevolá)
	await expect(page.getByTestId('zakazka-tlac')).toBeVisible();

	// detail odpisu má odkaz na celú zákazku
	await goto(page, '/odpisy/91501');
	await page.getByTestId('cela-zakazka').click();
	await expect(page).toHaveURL(/\/odpisy\/zakazka\/E2E-ZC-AGG/);

	expect(consoleMsgs).toEqual([]);
});

test('zákazka bez LIVE odpisu: 🧪 TEST fallback s explicitným označením (#154)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	// seeduje LOKÁLNU zdieľanú e2e DB (WAL → preview server to vidí) — proti nasadenému cieľu skip
	test.skip(!!process.env.BASE_URL, 'seeduje lokálnu e2e DB — nedá sa proti nasadenému cieľu');
	const db = new Database('./data/e2e.db');
	try {
		db.prepare(
			`INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
			 VALUES (91511, 'zasklenia', 'E2E-ZC-TESTONLY', 'OP1543', 'E2E Testovací', 0, 0, '/t/f.xlsx', 'f.xlsx', 'hzc11', '{}', 'e2e', datetime('now','-30 minutes'), 'E2E-ZC-TESTONLY', 'OP1543')`
		).run();
		db.prepare(
			"INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (91511, 'E2E-ZC-T1', 'E2E Len test', 2, 'm')"
		).run();
	} finally {
		db.close();
	}
	await loginAs(page);
	await goto(page, '/odpisy/zakazka/E2E-ZC-TESTONLY');
	await expect(page.getByTestId('zakazka-scope')).toContainText('nemá žiadny ostrý');
	const ceny = page.getByTestId('ceny-tabulka');
	await expect(ceny.locator('tr', { hasText: 'E2E-ZC-T1' })).toContainText('2 m');
	await expect(page.getByTestId('cena-nakup-cennik-E2E-ZC-T1')).toContainText('cena neznáma');
	expect(consoleMsgs).toEqual([]);
});

// #464: zakazka print button volá window.print()
test('zákazka: print button volá window.print()', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	test.skip(!!process.env.BASE_URL, 'seeduje lokálnu e2e DB — nedá sa proti nasadenému cieľu');
	const { assertPrintCalled } = await stubWindowPrint(page);
	// seed a minimal odpis for the zakazka page
	const db = new Database('./data/e2e.db');
	try {
		db.prepare(
			`INSERT OR IGNORE INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
			 VALUES (91520, 'zasklenia', 'E2E-ZC-PRINT', 'OP01', 'E2E Print', 0, 1, '/t/f.xlsx', 'f.xlsx', 'hzcprint', '{}', 'e2e', datetime('now','-5 minutes'), 'E2E-ZC-PRINT', 'OP01')`
		).run();
		db.prepare(
			"INSERT OR IGNORE INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (91520, 'ZASP-PRINT', 'Print test', 1, 'm')"
		).run();
	} finally {
		db.close();
	}
	await loginAs(page);
	await goto(page, '/odpisy/zakazka/E2E-ZC-PRINT');
	await expect(page.getByTestId('zakazka-tlac')).toBeVisible();
	await page.getByTestId('zakazka-tlac').click();
	await assertPrintCalled();
	expect(consoleMsgs).toEqual([]);
});

// #464: „← Späť na históriu" z /odpisy/zakazka naviguje na /odpisy
test('zákazka: „← Späť na históriu" naviguje na /odpisy', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	test.skip(!!process.env.BASE_URL, 'seeduje lokálnu e2e DB — nedá sa proti nasadenému cieľu');
	const db = new Database('./data/e2e.db');
	try {
		db.prepare(
			`INSERT OR IGNORE INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
			 VALUES (91521, 'zasklenia', 'E2E-ZC-NAV', 'OP01', 'E2E Nav', 0, 1, '/t/f.xlsx', 'f.xlsx', 'hzcnav', '{}', 'e2e', datetime('now','-5 minutes'), 'E2E-ZC-NAV', 'OP01')`
		).run();
		db.prepare(
			"INSERT OR IGNORE INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (91521, 'ZASP-NAV', 'Nav test', 1, 'm')"
		).run();
	} finally {
		db.close();
	}
	await loginAs(page);
	await goto(page, '/odpisy/zakazka/E2E-ZC-NAV');
	const link = page.getByRole('link', { name: '← Späť na históriu' });
	await expect(link).toBeVisible();
	await link.click();
	await expect(page).toHaveURL(/\/odpisy$/);
	expect(consoleMsgs).toEqual([]);
});
