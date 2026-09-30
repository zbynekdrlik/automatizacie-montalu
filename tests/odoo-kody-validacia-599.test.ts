// #599 krok 1: kontrola kódov odpisu (`validateOdpisKody`, #295 brána pred zápisom do Money pre
// live=1) je z Odoo `product.product` namiesto Money snapshotu. Kód je platný, keď existuje ako
// AKTÍVNY produkt v Odoo (katalóg syncovaný z Money, rovnaké `default_code`; PROD sonda 30.9.: 164/164
// kódov odpísaných od 1.9. je v Odoo aktívnych). Pri NEDOSTUPNOM Odoo (chyba/timeout/403) FALLBACK na
// dnešnú snapshot validáciu + WARN — odpis sa NIKDY neblokuje len kvôli výpadku Odoo. Hláška pre
// používateľa je ROVNAKÁ ako dnes. Money-NEUTRÁLNE: obsah/kódy odpisu sa nemenia.
//
// MONEY_LIVE=1, ale MONEY_LIVE_DIR ide do TEMP priečinka — do reálneho /data/dlv-import NIKDY nič.
// Mockuje sa LEN sieťová hranica (`setJson2Transport`). Kódy = reálne PROD artikly, BEZ cien.
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-odoo-kody-599-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '1';
process.env.MONEY_LIVE_DIR = path.join(tmpRoot, 'dlv-import'); // TEMP, nikdy reálny import dir
process.env.MONEY_NA_ODPIS_DIR = path.join(tmpRoot, 'dlv-import', 'NA ODPIS'); // TEMP staging
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'neexistuje.json'); // no-file → seed z DB ostane

const { writeOdpis } = await import('../src/lib/server/money');
const { validateOdpisKody } = await import('../src/lib/server/ceny');
const { db } = await import('../src/lib/server/db');
const { setJson2Transport } = await import('../src/lib/server/odoo-json2');
const { _resetOdooKatalogCache } = await import('../src/lib/server/odoo-katalog');
import type { OdpisJob, Polozka } from '../src/lib/server/money';

// import PRV (migrácie ticho), level až potom — WARN o fallbacku musí prejsť captureom
process.env.LOG_LEVEL = 'warn';
afterAll(() => delete process.env.LOG_LEVEL);

// Odoo katalóg (reálne PROD kódy + názvy, bez cien)
const ODOO = [
	{
		default_code: 'ZASP00014',
		name: 'Koľajnica 2K Surový 7500 mm',
		uom_id: [9, 'm'],
		is_storable: true,
		active: true
	},
	{
		default_code: 'ZASP20244',
		name: 'Kladkový profil',
		uom_id: [9, 'm'],
		is_storable: true,
		active: true
	}
];

let odooStatus = 200;
let odooCalls = 0;

function enableOdoo() {
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
	setJson2Transport(async (url, init) => {
		odooCalls++;
		if (!String(url).includes('/json/2/product.product/search_read'))
			return new Response('[]', { status: 200 });
		if (odooStatus !== 200) return new Response('boom', { status: odooStatus });
		const body = JSON.parse(String(init?.body)) as { domain: [string, string, string[]][] };
		const kody = body.domain[0]![2];
		return new Response(JSON.stringify(ODOO.filter((p) => kody.includes(p.default_code))), {
			status: 200
		});
	});
}

function job(zak: string, polozky: Polozka[]): OdpisJob {
	return {
		modul: 'zasklenia',
		zak,
		op: '01',
		zakaznik: 'Test',
		caka: false,
		createdBy: 'vitest',
		cakaSubdir: 'Robust',
		popis: '01 : Test',
		polozky,
		detail: {}
	};
}

async function capture<T>(
	fn: () => Promise<T>
): Promise<{ res: T; logs: Record<string, unknown>[] }> {
	const lines: string[] = [];
	const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
		lines.push(String(chunk));
		return true;
	}) as typeof process.stdout.write);
	let res: T;
	try {
		res = await fn();
	} finally {
		spy.mockRestore();
	}
	const logs = lines
		.join('')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l) as Record<string, unknown>);
	return { res, logs };
}

beforeAll(() => {
	fs.mkdirSync(process.env.MONEY_LIVE_DIR!, { recursive: true });
	// čerstvý Money snapshot pokrýva prefix ZASP: ZASP00014 má kartu; ZASP20244 v snapshote NIE JE
	// (Odoo ho pozná) — dôkaz, že rozhoduje Odoo, nie snapshot.
	db.prepare(
		"INSERT INTO material_prices (kod, sklad, mena, updated_at) VALUES ('ZASP00014', 5, 'EUR', datetime('now'))"
	).run();
	db.prepare(
		"INSERT INTO material_prices_meta (id, snapshot_generated_at, imported_at, row_count) VALUES (1, datetime('now'), datetime('now'), 1)"
	).run();
});

beforeEach(() => {
	_resetOdooKatalogCache();
	odooStatus = 200;
	odooCalls = 0;
});

afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
});

describe('#599 validateOdpisKody z Odoo product.product', () => {
	it('[RED] kód, ktorý Odoo pozná (v snapshote chýba) → odpis PREJDE (zdroj odoo)', async () => {
		enableOdoo();
		const v = await validateOdpisKody([{ kod: 'ZASP20244', nazov: 'Kladkový profil' }]);
		expect(v.zdroj).toBe('odoo');
		expect(v.ok).toBe(true);
		const w = await writeOdpis(
			job('ZAK599-OK', [{ kod: 'ZASP20244', nazov: 'Kladkový profil', qty: 15 }])
		);
		expect(w.status).toBe('written');
		expect(fs.existsSync(w.target)).toBe(true);
		expect(odooCalls).toBeGreaterThan(0);
	});

	it('[RED] kód, ktorý Odoo NEPOZNÁ (v snapshote je) → blok unknown-kod s dnešnou hláškou', async () => {
		enableOdoo();
		const ineOdoo = ODOO.filter((p) => p.default_code !== 'ZASP00014');
		ODOO.splice(0, ODOO.length, ...ineOdoo);
		try {
			const w = await writeOdpis(
				job('ZAK599-UNK', [{ kod: 'ZASP00014', nazov: 'Koľajnica', qty: 3 }])
			);
			expect(w.status).toBe('blocked');
			expect(w.reason).toBe('unknown-kod');
			expect(fs.existsSync(w.target)).toBe(false);
			expect(w.chybajuceKody).toEqual([
				{
					kod: 'ZASP00014',
					nazov: 'Koľajnica',
					dovod: 'neznamy',
					popis:
						'Money nepozná kód ZASP00014 — import by tento riadok (a možno celý doklad) preskočil.'
				}
			]);
		} finally {
			ODOO.unshift({
				default_code: 'ZASP00014',
				name: 'Koľajnica 2K Surový 7500 mm',
				uom_id: [9, 'm'],
				is_storable: true,
				active: true
			});
		}
	});

	it('[RED] Odoo validuje AJ rodinu mimo snapshotu (PRP) — neznámy PRP kód sa zablokuje', async () => {
		enableOdoo();
		const v = await validateOdpisKody([{ kod: 'PRP99999', nazov: 'Neznámy pergolový profil' }]);
		expect(v.zdroj).toBe('odoo');
		expect(v.ok).toBe(false);
		expect(v.problemy[0]!.dovod).toBe('neznamy');
	});

	it('[RED] Odoo nedostupné (500) → FALLBACK na snapshot + WARN log; snapshot-známy kód prejde', async () => {
		enableOdoo();
		odooStatus = 500;
		const { res, logs } = await capture(() =>
			validateOdpisKody([{ kod: 'ZASP00014', nazov: 'Koľajnica' }])
		);
		expect(res.zdroj).toBe('snapshot');
		expect(res.ok).toBe(true);
		const warn = logs.find((l) => l.module === 'ceny' && l.level === 'warn');
		expect(warn).toBeDefined();
		expect(String(warn!.msg)).toContain('Odoo');
	});

	it('[RED] Odoo nedostupné → snapshot fallback stále blokuje snapshot-neznámy kód (ako dnes)', async () => {
		enableOdoo();
		odooStatus = 403;
		const w = await writeOdpis(
			job('ZAK599-FB', [{ kod: 'ZASP99999', nazov: 'Neznámy profil', qty: 3 }])
		);
		expect(w.status).toBe('blocked');
		expect(w.reason).toBe('unknown-kod');
		expect(w.chybajuceKody?.[0]?.popis).toBe(
			'Money nepozná kód ZASP99999 — import by tento riadok (a možno celý doklad) preskočil.'
		);
	});

	it('[RED] Odoo nenakonfigurované (dev/CI) → snapshot validácia bez volania Odoo', async () => {
		const v = await validateOdpisKody([{ kod: 'ZASP00014', nazov: 'Koľajnica' }]);
		expect(v.zdroj).toBe('snapshot');
		expect(v.ok).toBe(true);
		expect(odooCalls).toBe(0);
	});
});
