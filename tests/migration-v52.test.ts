// #579 časť 2: migration v51 → v52 — nová tabuľka `cfg_sklo_hrubka` (povolené hrúbky Odoo skiel per
// systém, nastaviteľné výrobou v `/zasklenia/nastavenia`). Seed = `ODOO_HRUBKY_SEED` (dnešná
// konštanta, jeden zdroj s kódom). Postav DB v stave v51 (base tabuľky pre seedData/seedUsers) →
// import db.ts spustí v52. Aditívne (CREATE TABLE IF NOT EXISTS + INSERT OR IGNORE).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ODOO_HRUBKY_SEED } from '../src/lib/sklo-povolene';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v52-test-'));
const dbPath = path.join(tmpRoot, 'v51.db');

{
	const v51 = new Database(dbPath);
	v51.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL DEFAULT '', dim TEXT NOT NULL DEFAULT 'S', koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks INTEGER NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, money_kod TEXT, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_sklo_trieda (system TEXT NOT NULL, trieda INTEGER NOT NULL, korekcia INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (system, trieda));
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL DEFAULT '', zakaznik TEXT NOT NULL DEFAULT '', caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, target TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), zak_norm TEXT NOT NULL DEFAULT '', UNIQUE (modul, zak, op, live));
		CREATE TABLE user_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('create','role_change','delete','seed')), target_username TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
		INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('Štandard +|3K', 3, 0);
		CREATE TABLE cfg_sietka_standard (kluc TEXT PRIMARY KEY CHECK (kluc IN ('k', 'r', 'h')), hodnota REAL NOT NULL);
		INSERT INTO cfg_sietka_standard (kluc, hodnota) VALUES ('k', 16.5), ('r', 17), ('h', 3);
		CREATE TABLE objednavka_skla_odoslanie (zak_norm TEXT PRIMARY KEY, glass_order_id INTEGER NOT NULL CHECK (glass_order_id > 0), name TEXT NOT NULL DEFAULT '', odoslane_at TEXT NOT NULL DEFAULT (datetime('now')), odoslal TEXT NOT NULL DEFAULT '');
		PRAGMA user_version = 51;
	`);
	v51.close();
}

process.env.DATABASE_PATH = dbPath;
await import('../src/lib/server/db');

describe('migration v51 → v52 (cfg_sklo_hrubka, #579)', () => {
	it('bumpne na v52 a vytvorí tabuľku (id, system, mm, druh)', () => {
		const d = new Database(dbPath);
		expect(d.pragma('user_version', { simple: true })).toBe(54);
		const cols = (d.prepare('PRAGMA table_info(cfg_sklo_hrubka)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toEqual(['id', 'system', 'mm', 'druh']);
		d.close();
	});

	it('seed = ODOO_HRUBKY_SEED (poradie zachované)', () => {
		const d = new Database(dbPath);
		const rows = d.prepare('SELECT system, mm, druh FROM cfg_sklo_hrubka ORDER BY id').all() as {
			system: string;
			mm: number;
			druh: string;
		}[];
		const cakane = Object.entries(ODOO_HRUBKY_SEED).flatMap(([system, r]) =>
			r.map(({ mm, druh }) => ({ system, mm, druh }))
		);
		expect(rows).toEqual(cakane);
		d.close();
	});

	it('CHECK: neplatný druh / mm <= 0 / duplicitná hrúbka systému sa odmietnu', () => {
		const d = new Database(dbPath);
		const ins = d.prepare('INSERT INTO cfg_sklo_hrubka (system, mm, druh) VALUES (?, ?, ?)');
		expect(() => ins.run('Slide', 24, 'xyz')).toThrow();
		expect(() => ins.run('Slide', 0, 'izolacne')).toThrow();
		expect(() => ins.run('Robust', 24, 'jednoduche')).toThrow();
		ins.run('Slide', 24, 'izolacne');
		d.close();
	});

	it('base dáta prežijú (aditívna migrácia)', () => {
		const d = new Database(dbPath);
		const row = d.prepare('SELECT hodnota FROM cfg_sietka_standard WHERE kluc = ?').get('k') as {
			hodnota: number;
		};
		expect(row.hodnota).toBe(16.5);
		d.close();
	});
});
