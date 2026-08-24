// #298 — /odpisy load PRIPOJÍ readback stav ku každému LIVE odpisu (on-the-fly proti Money DLV
// snapshotu). Overuje integráciu load → readbackStav → dáta pre badge. TEST odpisy readback nemajú.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-odpisy-readback-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.DLV_READBACK_PATH = path.join(tmpRoot, 'neexistuje.json'); // no-file → priamy seed ostane

const { db } = await import('../src/lib/server/db');
const { load } = await import('../src/routes/odpisy/+page.server');

let nextId = 1;
function insOdpis(zak: string, op: string, qtys: number[], live = 1): number {
	const id = nextId++;
	db.prepare(
		`INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
		 VALUES (?, 'zasklenia', ?, ?, 'T', 0, ?, '/t/f', 'f', 'h', '{}', 't', datetime('now','-30 minutes'), ?, ?)`
	).run(id, zak, op, live, zak, op);
	const insP = db.prepare(
		"INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (?, ?, ?, ?, 'm')"
	);
	qtys.forEach((q, i) => insP.run(id, `ZASP${i}`, `P${i}`, q));
	return id;
}

type LoadOut = {
	odpisy: { id: number; zak: string; readback: { stav: string; dovod: string } | null }[];
};
const runLoad = async () =>
	((await load({} as Parameters<typeof load>[0])) as unknown as LoadOut).odpisy;

beforeEach(() => {
	db.prepare('DELETE FROM odpis_polozky').run();
	db.prepare('DELETE FROM odpis_log').run();
	db.prepare('DELETE FROM money_dlv').run();
	db.prepare('DELETE FROM money_dlv_meta').run();
	db.prepare(
		"INSERT INTO money_dlv_meta (id, snapshot_generated_at, imported_at, row_count) VALUES (1, datetime('now'), datetime('now'), 1)"
	).run();
	nextId = 1;
});

describe('#298 /odpisy load — readback stav na LIVE odpisoch', () => {
	it('LIVE odpis so sediacim DLV ⇒ readback.stav ok', async () => {
		const id = insOdpis('ZAK1', 'OP1', [3, 5]);
		db.prepare(
			"INSERT INTO money_dlv (dlv, zak_norm, op_norm, pocet_polozek) VALUES ('DLV1', 'ZAK1', 'OP1', 2)"
		).run();
		const row = (await runLoad()).find((o) => o.id === id)!;
		expect(row.readback).toMatchObject({ stav: 'ok' });
	});

	it('LIVE odpis bez DLV (fresh snapshot) ⇒ readback.stav nesulad/chyba-doklad', async () => {
		const id = insOdpis('ZAK2', 'OP2', [3, 5]);
		const row = (await runLoad()).find((o) => o.id === id)!;
		expect(row.readback).toMatchObject({ stav: 'nesulad', dovod: 'chyba-doklad' });
	});

	it('TEST odpis (live=0) ⇒ readback null (do Money nešiel)', async () => {
		const id = insOdpis('ZAK3', 'OP3', [1], 0);
		const row = (await runLoad()).find((o) => o.id === id)!;
		expect(row.readback).toBeNull();
	});
});
