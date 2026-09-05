// E2E: história odpisov — #294 ledger (obyčajné „Uvoľniť" identický obsah blokuje ako
// poistku) + jeho DVE override cesty: sankcionovaný „⚠️ Povoliť rovnaký" na /odpisy (kým
// riadok existuje) a modulové „⚠️ Odoslať aj tak" (#300, tuple override — aj po „Uvoľniť",
// keď riadok už neexistuje). Plus odhlásenie, login deep-link (?next=) a predvyplnenie mena.
// Trieda navigačných/stavových bugov + Money-kritický dedup/ledger. Nula console errors všade.
import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import path from 'node:path';
import {
	collectConsole,
	loginAs,
	goto,
	waitHydrated,
	skipAkLive,
	E2E_USER,
	E2E_PASS,
	vyberFarbuKovania,
	logout
} from './helpers';

const RUN = `E2E-${Date.now().toString(36).toUpperCase()}`;

test('odpisy: ledger blokuje identický re-import; „⚠️ Povoliť rovnaký" AJ „⚠️ Odoslať aj tak" ho povolia (celý UI tok)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	page.on('dialog', (d) => d.accept()); // confirm() pri „Uvoľniť" / „Povoliť rovnaký" / „Odoslať aj tak"
	await loginAs(page);

	const posli = async () => {
		await goto(page, '/zasklenia');
		await page.getByLabel('Číslo objednávky (ZAK) *').fill(`${RUN}-REL`);
		await page.getByLabel('OP/OPDL číslo *').fill('01');
		await page.getByLabel('Zákazník *').fill('E2E Uvoľniť');
		await page.getByLabel('Šírka (mm) *').fill('2509');
		await page.getByLabel('Výška (mm) *').fill('1930');
		await vyberFarbuKovania(page);
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
	// MAŽÚ riadok odpis_log, no toto tlačidlo ten riadok POTREBUJE (číta z neho content_hash) —
	// takže override sa musí ukázať KÝM riadok ešte existuje. Zhodné poradie ako kanonický unit
	// test tests/money-ledger.test.ts („Povoliť rovnaký … ONE-SHOT", riadky 117–137).
	await goto(page, '/odpisy');
	await rowRel().locator('button[data-testid^="povolit-reimport-"]').click();
	await expect(page.getByTestId('reimport-povoleny')).toBeVisible();

	// 3. po override sa identický obsah dá poslať znova (ledger: imports == overrides ⇒ neblokuje)
	await posli();
	await expect(page.getByTestId('vysledok')).toContainText('TEST');

	// --- VETVA B: obyčajné „Uvoľniť" → riadok je preč → „Povoliť rovnaký" je nedosiahnuteľné
	//     (dead-end #294), no modulové „⚠️ Odoslať aj tak" (#300, tuple override) ho dorieši ---
	// re-send z bodu 3 vytvoril nový odpis_log riadok → znova je to duplikát
	await posli();
	await expect(page.getByTestId('duplikat')).toContainText('už bola odoslaná');

	// obyčajné „Uvoľniť" zmaže dedup kľúč, ALE override do ledgeru NEpridá (riadok už preč)
	await goto(page, '/odpisy');
	await rowRel().getByRole('button', { name: 'Uvoľniť' }).click();
	await expect(page.getByTestId('uvolnene')).toBeVisible();

	// 4. identický re-send po „Uvoľniť" je ZABLOKOVANÝ append-only ledgerom (#294) a v histórii
	//    už NIE JE riadok na „Povoliť rovnaký" → modulový blok banner (#300) s „⚠️ Odoslať aj tak"
	await posli();
	await expect(page.getByTestId('blok')).toContainText('už bol raz importovaný do Money');
	await expect(page.getByTestId('odoslat-aj-tak')).toBeVisible();

	// 5. „⚠️ Odoslať aj tak" (tuple override, nepotrebuje odpis_log riadok) doklad reálne odošle —
	//    koniec „Uvoľniť" dead-endu
	await page.getByTestId('odoslat-aj-tak').click();
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
	// #448: súhrnný ČERVENÝ alarm banner na vrchu — LIVE odpis 90002 (chýbajúci DLV) sa v ňom objaví,
	// overený odpis 90001 (ok) NIE. Zviditeľní tichý Money drop bez scrollovania na konkrétny riadok.
	await expect(page.getByTestId('readback-alarm-banner')).toBeVisible();
	await expect(page.getByTestId('readback-alarm-banner')).toContainText('Money');
	await expect(page.getByTestId('readback-alarm-90002')).toContainText('E2E-RB-MISS');
	await expect(page.getByTestId('readback-alarm-90001')).toHaveCount(0);
	expect(consoleMsgs).toEqual([]);
});

test('odpisy: ručný presun zo staging → 📦 „presunuté ručne" + odpis vstúpi do readbacku (#299)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	// seeduje LOKÁLNU zdieľanú e2e DB (WAL → preview server to vidí) — proti nasadenému cieľu skip.
	test.skip(!!process.env.BASE_URL, 'seeduje lokálnu e2e DB — nedá sa proti nasadenému cieľu');
	// caka=1 LIVE odpis, ktorého staged súbor „bol ručne presunutý do Money": `target` má EXISTUJÚCI
	// rodičovský dir (./data), ale súbor tam nikdy nevznikne → detekcia (v /odpisy load) ho označí ako
	// presunutý. MONEY_LIVE=0, takže do Money nič nejde — je to len DB riadok + neexistujúci súbor.
	const goneTarget = path.resolve('data', 'e2e-presun-90003-gone.xlsx');
	const db = new Database('./data/e2e.db');
	try {
		db.prepare(
			`INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
			 VALUES (90003, 'pergola', 'E2E-PRESUN', 'OP299', 'E2E Presun', 1, 1, ?, 'gone.xlsx', 'h299', '{}', 'e2e', datetime('now','-30 minutes'), 'E2E-PRESUN', 'OP299')`
		).run(goneTarget);
		const insP = db.prepare(
			"INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (?, ?, ?, ?, 'm')"
		);
		insP.run(90003, 'ZASP1', 'P1', 3);
		insP.run(90003, 'ZASP2', 'P2', 5);
		// zhodný Money DLV (2 pol.) — po presune sa odpis MUSÍ napárovať (✅ overené), nie ostať ⏳
		db.prepare(
			"INSERT OR REPLACE INTO money_dlv (dlv, zak_norm, op_norm, pocet_polozek) VALUES ('DLV299', 'E2E-PRESUN', 'OP299', 2)"
		).run();
		db.prepare(
			"INSERT OR REPLACE INTO money_dlv_meta (id, snapshot_generated_at, imported_at, row_count, window_days) VALUES (1, datetime('now'), datetime('now'), 1, 0)"
		).run();
	} finally {
		db.close();
	}
	await loginAs(page);
	await goto(page, '/odpisy');
	// detekcia (v load) označí presun → UI marker 📦 „presunuté ručne" (namiesto ⏳ parkovaný)
	await expect(page.getByTestId('presunute-90003')).toContainText('presunuté ručne');
	// a odpis VSTÚPI do #308 readback matchingu → reálny Money verdikt (✅ overené), nie trvalé ⏳
	await expect(page.getByTestId('readback-90003')).toContainText('overené');
	expect(consoleMsgs).toEqual([]);
});

test('odpisy: časy sa zobrazujú v bratislavskom lokálnom čase, nie surové UTC (#313)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	// seeduje LOKÁLNU zdieľanú e2e DB (WAL → preview server to vidí) — proti nasadenému cieľu skip.
	test.skip(!!process.env.BASE_URL, 'seeduje lokálnu e2e DB — nedá sa proti nasadenému cieľu');
	// FIXNÝ zimný UTC timestamp (CET, UTC+1) → Bratislava DETERMINISTICKY, bez DST nejednoznačnosti:
	// SQLite tvar „2026-01-05 13:32:00" (UTC) = 5.1.2026 14:32 bratislavského času (dátum 5.1.2026).
	// created_at aj presunute_at seedujeme priamo (nie datetime('now')) → očakávaný výstup je fixný.
	// caka=1 + presunute_at NOT NULL → detekcia (`presunute_at IS NULL` filter) ho preskočí, odznak
	// 📦 sa vykreslí z nasedovanej hodnoty. live=1 (presun je LIVE koncept); readback bez money_dlv
	// dá vedľajší ⛔ badge — nevadí, asserty cielia len na časové bunky.
	const UTC = '2026-01-05 13:32:00';
	const db = new Database('./data/e2e.db');
	try {
		db.prepare(
			`INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, presunute_at, zak_norm, op_norm)
			 VALUES (90010, 'zasklenia', 'E2E-TZ', 'OP313', 'E2E Zóna', 1, 1, '/t/f.xlsx', 'f.xlsx', 'h313', '{}', 'e2e', ?, ?, 'E2E-TZ', 'OP313')`
		).run(UTC, UTC);
	} finally {
		db.close();
	}
	await loginAs(page);
	await goto(page, '/odpisy');

	// Kedy stĺpec (prvý td riadku) — bratislavský dátum+čas, NIE surový UTC „2026-01-05 13:32:00"
	const kedy = page.locator('tr', { hasText: 'E2E-TZ' }).first().locator('td').first();
	await expect(kedy).toHaveText('5.1.2026 14:32');
	await expect(kedy).not.toContainText('13:32'); // surová UTC hodina preč

	// #299 odznak „presunuté ručne (dátum)" — bratislavský dátum, NIE ISO UTC deň „2026-01-05"
	await expect(page.getByTestId('presunute-90010')).toContainText('presunuté ručne (5.1.2026)');
	await expect(page.getByTestId('presunute-90010')).not.toContainText('2026-01-05');

	// detail /odpisy/[id] — „Kedy" v detaile tiež bratislavský lokálny čas
	await goto(page, '/odpisy/90010');
	await expect(page.locator('.g')).toContainText('5.1.2026 14:32');
	await expect(page.locator('.g')).not.toContainText('13:32');

	expect(consoleMsgs).toEqual([]);
});

test('odhlásenie zmaže session a presmeruje na login', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	await loginAs(page);
	await logout(page);
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

// #464: odpis detail print button + „← Späť na históriu"
test('odpis detail: print button + „← Späť na históriu"', async ({ page }) => {
	const consoleMsgs = collectConsole(page);
	test.skip(!!process.env.BASE_URL, 'seeduje lokálnu e2e DB — nedá sa proti nasadenému cieľu');
	await page.addInitScript(() => {
		(window as unknown as Record<string, number>).__printCallCount = 0;
		window.print = () => {
			(window as unknown as Record<string, number>).__printCallCount++;
		};
	});
	const db = new Database('./data/e2e.db');
	try {
		db.prepare(
			`INSERT OR IGNORE INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
			 VALUES (91530, 'zasklenia', 'E2E-OD-PRINT', 'OP01', 'E2E Print', 0, 1, '/t/f.xlsx', 'f.xlsx', 'hodprint', '{}', 'e2e', datetime('now','-5 minutes'), 'E2E-OD-PRINT', 'OP01')`
		).run();
	} finally {
		db.close();
	}
	await loginAs(page);
	await goto(page, '/odpisy/91530');

	// print button
	await expect(page.getByTestId('odpis-detail-tlac')).toBeVisible();
	await page.getByTestId('odpis-detail-tlac').click();
	const count = await page.evaluate(
		() => (window as unknown as Record<string, number>).__printCallCount
	);
	expect(count).toBeGreaterThan(0);

	// „← Späť na históriu" naviguje
	const link = page.getByRole('link', { name: '← Späť na históriu' });
	await expect(link).toBeVisible();
	await link.click();
	await expect(page).toHaveURL(/\/odpisy$/);
	expect(consoleMsgs).toEqual([]);
});
