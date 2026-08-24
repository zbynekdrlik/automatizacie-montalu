// #295 — tichá strata položiek chýbajúcich v Money. PRE-export validácia kódov proti dennému
// Money snapshotu (`material_prices`): pre live=1 neznámy kód / kód bez skladovej karty MUSÍ
// zablokovať zápis (import by ho ticho preskočil — Dominik: „keď chýba profil, neodpíše VÔBEC").
// MONEY_LIVE=1, ale MONEY_LIVE_DIR ide do TEMP priečinka — do reálneho /data/dlv-import NIKDY nič.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-valid-kody-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '1';
process.env.MONEY_LIVE_DIR = path.join(tmpRoot, 'dlv-import'); // TEMP, nikdy reálny import dir
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'neexistuje.json'); // no-file → seed z DB ostane

const { writeOdpis } = await import('../src/lib/server/money');
const { db } = await import('../src/lib/server/db');
import type { OdpisJob, Polozka } from '../src/lib/server/money';

function job(zak: string, op: string, polozky: Polozka[]): OdpisJob {
	return {
		modul: 'zasklenia',
		zak,
		op,
		zakaznik: 'Test',
		caka: false,
		createdBy: 'vitest',
		cakaSubdir: 'Robust',
		popis: `${op} : Test`,
		polozky,
		detail: {}
	};
}

beforeAll(() => {
	fs.mkdirSync(process.env.MONEY_LIVE_DIR!, { recursive: true });
	// čerstvý Money snapshot: prefix ZASP je pokrytý; ZASP00014 má kartu, ZASP00099 kartu nemá.
	// Neznámy kód ZASP99999 v snapshote VÔBEC nie je → Money by ho preskočil.
	db.prepare(
		"INSERT INTO material_prices (kod, sklad, mena, updated_at) VALUES ('ZASP00014', 5, 'EUR', datetime('now'))"
	).run();
	db.prepare(
		"INSERT INTO material_prices (kod, sklad, mena, updated_at) VALUES ('ZASP00099', NULL, 'EUR', datetime('now'))"
	).run();
	db.prepare(
		"INSERT INTO material_prices_meta (id, snapshot_generated_at, imported_at, row_count) VALUES (1, datetime('now'), datetime('now'), 2)"
	).run();
});

describe('#295 pre-export validácia kódov (live=1)', () => {
	it('[RED] live job s NEZNÁMYM kódom sa NEzapíše (import by celý doklad preskočil)', async () => {
		const w = await writeOdpis(
			job('ZAK-UNK', '01', [{ kod: 'ZASP99999', nazov: 'Neznámy profil', qty: 3 }])
		);
		expect(fs.existsSync(w.target)).toBe(false); // žiadny súbor do Money
	});

	it('[RED] live job so samými ZNÁMYMI kódmi prejde (zapíše sa)', async () => {
		const w = await writeOdpis(
			job('ZAK-OK', '01', [{ kod: 'ZASP00014', nazov: 'Koľajnica', qty: 15 }])
		);
		expect(w.status).toBe('written');
		expect(fs.existsSync(w.target)).toBe(true);
	});
});
