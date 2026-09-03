// Reálny prod upgrade path v33 → v34: durable retry queue pre Odoo zákazka-push (#349, follow-up
// #340). Postav DB v stave v33 (base tabuľky s ≥1 riadkom → seedData/seedUsers no-opnú; bez tabuľky
// `odoo_zakazka_push`), import db.ts spustí SKUTOČNÝ v34 blok (staršie sa preskočia). Overuje:
// user_version=34, nová tabuľka + stĺpce + index, zapisovateľnosť, žiadna strata iných dát.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v34-test-'));
const dbPath = path.join(tmpRoot, 'v33.db');

{
	const v33 = new Database(dbPath);
	// Minimálne base tabuľky, aby seedData/seedUsers po migrácii no-opli (≥1 riadok v každej).
	v33.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	v33
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v33.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 0)").run();
	v33.prepare("INSERT INTO glass_types (nazov, system) VALUES ('X', 'ALL')").run();
	v33.pragma('user_version = 33');
	v33.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v33 → v34: durable retry queue pre Odoo zákazka-push (#349)', () => {
	it('user_version === 34 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(37);
	});

	it('vznikla tabuľka odoo_zakazka_push s očakávanými stĺpcami', () => {
		const cols = (
			db.prepare('PRAGMA table_info(odoo_zakazka_push)').all() as { name: string }[]
		).map((c) => c.name);
		expect(cols).toEqual([
			'zak_norm',
			'op_norm',
			'zak',
			'op',
			'pending',
			'attempts',
			'last_error',
			'posted_at',
			'created_at',
			'updated_at'
		]);
	});

	it('PRIMARY KEY je (zak_norm, op_norm) — druhý upsert nevytvorí duplicitný riadok', () => {
		db.prepare(
			"INSERT INTO odoo_zakazka_push (zak_norm, op_norm, zak, op) VALUES ('ZAK1', 'OP1', 'ZAK1', 'OP1')"
		).run();
		expect(() =>
			db
				.prepare(
					"INSERT INTO odoo_zakazka_push (zak_norm, op_norm, zak, op) VALUES ('ZAK1', 'OP1', 'ZAK1', 'OP1')"
				)
				.run()
		).toThrow(); // PK konflikt (bez ON CONFLICT) → dôkaz že PK drží
		const n = (
			db.prepare("SELECT COUNT(*) c FROM odoo_zakazka_push WHERE zak_norm='ZAK1'").get() as {
				c: number;
			}
		).c;
		expect(n).toBe(1);
	});

	it('existuje sweep index idx_odoo_zakazka_push_pending', () => {
		const idx = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='index' AND name='idx_odoo_zakazka_push_pending'"
			)
			.get();
		expect(idx).toBeTruthy();
	});

	it('defaulty: pending/attempts=0, last_error/posted_at prázdne/NULL, created_at/updated_at vyplnené', () => {
		db.prepare(
			"INSERT INTO odoo_zakazka_push (zak_norm, op_norm, zak, op) VALUES ('ZAK2', 'OP2', 'ZAK2', 'OP2')"
		).run();
		const row = db
			.prepare(
				'SELECT pending, attempts, last_error, posted_at, created_at, updated_at FROM odoo_zakazka_push WHERE zak_norm = ?'
			)
			.get('ZAK2') as Record<string, unknown>;
		expect(row.pending).toBe(0);
		expect(row.attempts).toBe(0);
		expect(row.last_error).toBe('');
		expect(row.posted_at).toBeNull();
		expect(row.created_at).toBeTruthy();
		expect(row.updated_at).toBeTruthy();
	});

	it('base dáta (users) prežili migráciu (žiadna strata)', () => {
		const row = db.prepare("SELECT username FROM users WHERE username = 'palo'").get();
		expect(row).toEqual({ username: 'palo' });
	});
});
