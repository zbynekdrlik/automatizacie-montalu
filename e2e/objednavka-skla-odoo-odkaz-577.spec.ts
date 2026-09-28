// #577 (Marek D., Odoo úloha 1181): po „Odoslať do Odoo" má podklad objednávky skla ukázať PRIAMY
// odkaz na vytvorenú objednávku skla v Odoo (`/odoo/action-1008/<id>`) — a TRVALO, aj po obnovení.
// V CI je Odoo upload vypnutý (žiadny ODOO_JSON2_URL) → reálne odoslanie tu odkaz nevytvorí (akcia +
// uloženie sú pokryté unit testom `tests/objednavka-skla-odoslanie-577.test.ts` s mocknutým Odoo).
// E2E preto overí POUŽÍVATEĽSKÝ tok okolo toho: (1) náhľad bez uploadu → žiadny mŕtvy odkaz;
// (2) uložené posledné odoslanie (seed lokálnej e2e DB, syntetické id) → odkaz je na podklade aj po
// obnovení, otvára sa v novej karte. Seed DB → `skipAkLive` (na ostrom nasadení sa preskočí).
import { test, expect } from '@playwright/test';
import Database from 'better-sqlite3';
import { collectConsole, loginAs, goto, waitHydrated, skipAkLive } from './helpers';

const DB_PATH = process.env.DATABASE_PATH || './data/e2e.db';
const RUN = `E2E-ODKAZ-${Date.now().toString(36).slice(-5)}`.toUpperCase();
// syntetické id (nie PROD objednávka) — overuje sa len tvar odkazu
const GLASS_ORDER_ID = 900577;

function seedPodklad(zak: string, odoslane: boolean): void {
	const db = new Database(DB_PATH);
	try {
		db.prepare(
			`INSERT INTO objednavka_skla (zak, zak_norm, op, modul, popis, sirka_mm, vyska_mm, pocet, typ_skla, m2, created_by)
			 VALUES (?, ?, 'OP577', 'manual', 'V.O.', 800, 600, 1, 'Float sklo 6 mm', 0.48, 'e2e')`
		).run(zak, zak);
		if (odoslane) {
			db.prepare(
				`INSERT INTO objednavka_skla_odoslanie (zak_norm, glass_order_id, name, odoslal)
				 VALUES (?, ?, 'OSK-E2E', 'e2e')`
			).run(zak, GLASS_ORDER_ID);
		}
	} finally {
		db.close();
	}
}

test('objednávka skla: uložené odoslanie → odkaz do Odoo aj po obnovení (#577)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	const zak = `${RUN}-TRVALO`;
	seedPodklad(zak, true);

	await loginAs(page);
	await goto(page, `/objednavka-skla/${zak}`);
	const odkaz = page.getByTestId('odoo-objednavka-link');
	await expect(odkaz).toBeVisible();
	await expect(odkaz).toContainText('Otvoriť objednávku skla v Odoo');
	await expect(odkaz).toContainText('OSK-E2E');
	await expect(odkaz).toHaveAttribute('href', new RegExp(`/odoo/action-1008/${GLASS_ORDER_ID}$`));
	await expect(odkaz).toHaveAttribute('target', '_blank');

	// obnovenie stránky → odkaz ostáva (trvalé uloženie k podkladu)
	await page.reload();
	await waitHydrated(page);
	await expect(page.getByTestId('odoo-objednavka-link')).toHaveAttribute(
		'href',
		new RegExp(`/odoo/action-1008/${GLASS_ORDER_ID}$`)
	);

	expect(consoleMsgs).toEqual([]);
});

test('objednávka skla: odoslanie bez Odoo (náhľad) → žiadny mŕtvy odkaz (#577)', async ({
	page
}) => {
	const consoleMsgs = collectConsole(page);
	await skipAkLive(page);
	const zak = `${RUN}-NAHLAD`;
	seedPodklad(zak, false);

	await loginAs(page);
	await goto(page, `/objednavka-skla/${zak}`);
	await expect(page.getByTestId('odoo-objednavka-link')).toHaveCount(0);
	await page.getByTestId('odoslat-odoo').click();
	await waitHydrated(page);
	await expect(page.getByTestId('odoslane-stav')).toBeVisible();
	await expect(page.getByTestId('glass-order-payload')).toBeVisible();
	await expect(page.getByTestId('odoo-objednavka-link')).toHaveCount(0);

	expect(consoleMsgs).toEqual([]);
});
