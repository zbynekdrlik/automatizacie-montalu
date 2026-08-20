// Reálny prod upgrade path v20 → v21: cenový zoznam materiálu — fáza 1 (#154).
//
// Postav DB presne v stave v20 (users/odpis_log ako na ostrej appke, BEZ
// material_prices/material_prices_meta/odpis_polozky), import db.ts spustí SKUTOČNÝ
// v21 blok → over že vzniknú všetky 3 tabuľky so správnymi stĺpcami, existujúce dáta
// (odpis_log) ostávajú nedotknuté, a FK CASCADE z odpis_polozky na odpis_log funguje.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v21-test-'));
const dbPath = path.join(tmpRoot, 'v20.db');

{
	const v20 = new Database(dbPath);
	v20.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE cfg_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), username TEXT NOT NULL, sys_styl TEXT NOT NULL, zmeny TEXT NOT NULL);
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL, zakaznik TEXT NOT NULL, caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL, target TEXT NOT NULL, filename TEXT NOT NULL, content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (modul, zak, op, live));
		CREATE TABLE problem_reports (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), username TEXT NOT NULL DEFAULT '', oblast TEXT NOT NULL DEFAULT '', popis TEXT NOT NULL);
		CREATE TABLE user_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('create','role_change')), target_username TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
	`);
	v20.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)').run('palo', 'x:y');
	const rowId = v20
		.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, live, target, filename)
			 VALUES ('zasklenia', 'ZAK-V21', '01', 'Test Zákazník', 0, '/tmp/x.xlsx', 'x.xlsx')`
		)
		.run().lastInsertRowid;
	v20.pragma('user_version = 20');
	v20.close();
	// zapamätaj si id pre test nižšie (mimo bloku by import db.ts inak zmenil connection)
	(globalThis as { __v21TestOdpisLogId?: number | bigint }).__v21TestOdpisLogId = rowId;
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v20 → v21: cenový zoznam materiálu (#154, fáza 1)', () => {
	it('user_version=21 po migrácii, existujúci odpis_log riadok nedotknutý', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(24);
		const row = db.prepare("SELECT zak, op FROM odpis_log WHERE zak = 'ZAK-V21'").get();
		expect(row).toEqual({ zak: 'ZAK-V21', op: '01' });
	});

	it('material_prices má očakávané stĺpce', () => {
		const cols = (db.prepare('PRAGMA table_info(material_prices)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toEqual([
			'kod',
			'nakup_cennik',
			'nakup_posledna_faktura',
			'predaj_vo',
			'mena',
			'sklad',
			'updated_at'
		]);
	});

	it('material_prices_meta má očakávané stĺpce a je prázdna (žiadny import ešte neprebehol)', () => {
		const cols = (
			db.prepare('PRAGMA table_info(material_prices_meta)').all() as { name: string }[]
		).map((c) => c.name);
		expect(cols).toEqual([
			'id',
			'snapshot_generated_at',
			'snapshot_file_mtime_ms',
			'imported_at',
			'row_count',
			'rejected_count'
		]);
		expect(
			(db.prepare('SELECT COUNT(*) c FROM material_prices_meta').get() as { c: number }).c
		).toBe(0);
	});

	it('odpis_polozky: FK CASCADE — zmazanie odpis_log riadku zmaže aj jeho položky', () => {
		const logId = (globalThis as { __v21TestOdpisLogId?: number | bigint }).__v21TestOdpisLogId!;
		db.prepare(
			"INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (?, 'ZASP99999', 'Test profil', 7.5, 'm')"
		).run(logId);
		expect(
			(
				db.prepare('SELECT COUNT(*) c FROM odpis_polozky WHERE odpis_log_id = ?').get(logId) as {
					c: number;
				}
			).c
		).toBe(1);

		db.prepare('DELETE FROM odpis_log WHERE id = ?').run(logId);

		expect(
			(
				db.prepare('SELECT COUNT(*) c FROM odpis_polozky WHERE odpis_log_id = ?').get(logId) as {
					c: number;
				}
			).c
		).toBe(0);
	});
});
