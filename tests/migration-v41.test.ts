// #496: migration v41 — objednavka_skla + objednavka_skla_subory tables.
// Postav DB v stave v40 (base tabuľky), import db.ts spustí v41 blok.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v41-test-'));
const dbPath = path.join(tmpRoot, 'v40.db');

{
	const v40 = new Database(dbPath);
	v40.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL DEFAULT '', dim TEXT NOT NULL DEFAULT 'S', koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks INTEGER NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, money_kod TEXT, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_sklo_trieda (system TEXT NOT NULL, trieda INTEGER NOT NULL, korekcia INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (system, trieda));
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL DEFAULT '', zakaznik TEXT NOT NULL DEFAULT '', caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, target TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), zak_norm TEXT NOT NULL DEFAULT '', UNIQUE (modul, zak, op, live));
		CREATE TABLE user_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('create','role_change','delete','seed')), target_username TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
		PRAGMA user_version = 40;
	`);
	v40.close();
}

process.env.DATABASE_PATH = dbPath;

describe('migration v40 → v41 (objednavka skla)', () => {
	it('bumps to v41 and creates tables', async () => {
		await import('../src/lib/server/db');
		const d = new Database(dbPath);
		expect(d.pragma('user_version', { simple: true })).toBe(42);

		// objednavka_skla table exists with correct columns
		const cols = d.prepare('PRAGMA table_info(objednavka_skla)').all() as { name: string }[];
		const colNames = cols.map((c) => c.name);
		expect(colNames).toContain('id');
		expect(colNames).toContain('zak');
		expect(colNames).toContain('zak_norm');
		expect(colNames).toContain('modul');
		expect(colNames).toContain('sirka_mm');
		expect(colNames).toContain('vyska_mm');
		expect(colNames).toContain('v_lavo_mm');
		expect(colNames).toContain('v_pravo_mm');
		expect(colNames).toContain('pocet');
		expect(colNames).toContain('typ_skla');
		expect(colNames).toContain('sikmy');
		expect(colNames).toContain('rezim');

		// objednavka_skla_subory table exists
		const subCols = d.prepare('PRAGMA table_info(objednavka_skla_subory)').all() as {
			name: string;
		}[];
		expect(subCols.map((c) => c.name)).toContain('polozka_id');
		expect(subCols.map((c) => c.name)).toContain('data');

		d.close();
	});

	it('can insert and read a glass item', () => {
		const d = new Database(dbPath);
		d.prepare(
			`INSERT INTO objednavka_skla (zak, zak_norm, modul, popis, sirka_mm, vyska_mm, pocet, typ_skla, created_by)
			 VALUES ('ZAK260123', 'ZAK260123', 'zasklenia', 'Posuv 1', 1200, 800, 2, 'Float 4mm', 'test')`
		).run();

		const row = d.prepare('SELECT * FROM objednavka_skla WHERE zak_norm = ?').get('ZAK260123') as {
			sirka_mm: number;
			pocet: number;
			rezim: string;
		};
		expect(row.sirka_mm).toBe(1200);
		expect(row.pocet).toBe(2);
		expect(row.rezim).toBe('rozmery');
		d.close();
	});

	it('cascade delete removes subory when polozka is deleted', () => {
		const d = new Database(dbPath);
		d.pragma('foreign_keys = ON');
		d.prepare(
			`INSERT INTO objednavka_skla (zak, zak_norm, modul, popis, sirka_mm, pocet, typ_skla, created_by)
			 VALUES ('ZAKCASC', 'ZAKCASC', 'fix', 'Pole 1', 500, 1, 'Float 6mm', 'test')`
		).run();
		const polId = (
			d.prepare('SELECT id FROM objednavka_skla WHERE zak_norm = ?').get('ZAKCASC') as {
				id: number;
			}
		).id;
		d.prepare(
			"INSERT INTO objednavka_skla_subory (polozka_id, nazov, typ, velkost, data) VALUES (?, 'test.pdf', 'application/pdf', 3, X'010203')"
		).run(polId);
		expect(
			(
				d
					.prepare('SELECT COUNT(*) as c FROM objednavka_skla_subory WHERE polozka_id = ?')
					.get(polId) as { c: number }
			).c
		).toBe(1);
		d.prepare('DELETE FROM objednavka_skla WHERE id = ?').run(polId);
		expect(
			(
				d
					.prepare('SELECT COUNT(*) as c FROM objednavka_skla_subory WHERE polozka_id = ?')
					.get(polId) as { c: number }
			).c
		).toBe(0);
		d.close();
	});
});
