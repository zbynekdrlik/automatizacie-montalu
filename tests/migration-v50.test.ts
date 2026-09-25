// #569: migration v49 → v50 — nová tabuľka `cfg_sietka_standard` (K/R/H modelu sieťky
// Štandard), seed = dnešné hodnoty (K 16,5 / R 17 / H 3). Postav DB v stave v49 (base
// tabuľky pre seedData/seedUsers) → import db.ts spustí v50. Aditívne (CREATE TABLE),
// existujúce cfg dáta nedotknuté; idempotentné (INSERT OR IGNORE nechá upravenú hodnotu).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v50-test-'));
const dbPath = path.join(tmpRoot, 'v49.db');

{
	const v49 = new Database(dbPath);
	v49.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL DEFAULT '', dim TEXT NOT NULL DEFAULT 'S', koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks INTEGER NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, money_kod TEXT, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_sklo_trieda (system TEXT NOT NULL, trieda INTEGER NOT NULL, korekcia INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (system, trieda));
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL DEFAULT '', zakaznik TEXT NOT NULL DEFAULT '', caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, target TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), zak_norm TEXT NOT NULL DEFAULT '', UNIQUE (modul, zak, op, live));
		CREATE TABLE user_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('create','role_change','delete','seed')), target_username TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
		INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('Štandard +|3K', 3, 0);
		PRAGMA user_version = 49;
	`);
	v49.close();
}

process.env.DATABASE_PATH = dbPath;
await import('../src/lib/server/db');

describe('migration v49 → v50 (cfg_sietka_standard, #569)', () => {
	it('bumpne na v50 a vytvorí tabuľku so seed hodnotami K 16,5 / R 17 / H 3', () => {
		const d = new Database(dbPath);
		expect(d.pragma('user_version', { simple: true })).toBe(50);
		const rows = d.prepare('SELECT kluc, hodnota FROM cfg_sietka_standard ORDER BY kluc').all() as {
			kluc: string;
			hodnota: number;
		}[];
		expect(rows).toEqual([
			{ kluc: 'h', hodnota: 3 },
			{ kluc: 'k', hodnota: 16.5 },
			{ kluc: 'r', hodnota: 17 }
		]);
		d.close();
	});

	it('neznámy kľúč CHECK odmietne (tabuľka drží len K/R/H)', () => {
		const d = new Database(dbPath);
		expect(() =>
			d.prepare("INSERT INTO cfg_sietka_standard (kluc, hodnota) VALUES ('x', 1)").run()
		).toThrow();
		d.close();
	});

	it('base cfg dáta prežijú (aditívna migrácia)', () => {
		const d = new Database(dbPath);
		const row = d.prepare('SELECT n FROM cfg_sys WHERE sys_styl = ?').get('Štandard +|3K') as {
			n: number;
		};
		expect(row.n).toBe(3);
		d.close();
	});
});
