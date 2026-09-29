// #577: migration v50 → v51 — nová tabuľka `objednavka_skla_odoslanie` (posledné odoslanie
// objednávky skla do Odoo per podklad: id `montalu.glass.order` + OSK názov + kedy/kto) → trvalý
// odkaz „Otvoriť objednávku skla v Odoo" aj po obnovení stránky. Postav DB v stave v50 (base
// tabuľky pre seedData/seedUsers) → import db.ts spustí v51. Aditívne (CREATE TABLE).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v51-test-'));
const dbPath = path.join(tmpRoot, 'v50.db');

{
	const v50 = new Database(dbPath);
	v50.exec(`
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
		PRAGMA user_version = 50;
	`);
	v50.close();
}

process.env.DATABASE_PATH = dbPath;
await import('../src/lib/server/db');

describe('migration v50 → v51 (objednavka_skla_odoslanie, #577)', () => {
	it('bumpne na v51 a vytvorí tabuľku s kľúčom zak_norm', () => {
		const d = new Database(dbPath);
		expect(d.pragma('user_version', { simple: true })).toBe(55);
		const cols = (
			d.prepare('PRAGMA table_info(objednavka_skla_odoslanie)').all() as {
				name: string;
				pk: number;
			}[]
		).map((c) => [c.name, c.pk]);
		expect(cols).toEqual([
			['zak_norm', 1],
			['glass_order_id', 0],
			['name', 0],
			['odoslane_at', 0],
			['odoslal', 0]
		]);
		d.close();
	});

	it('je zapisovateľná; neplatné id (<= 0) CHECK odmietne', () => {
		const d = new Database(dbPath);
		d.prepare(
			'INSERT INTO objednavka_skla_odoslanie (zak_norm, glass_order_id, name, odoslal) VALUES (?, ?, ?, ?)'
		).run('ZAK1', 3, 'OSK00003', 'e2e');
		const r = d
			.prepare(
				'SELECT glass_order_id, odoslane_at FROM objednavka_skla_odoslanie WHERE zak_norm = ?'
			)
			.get('ZAK1') as { glass_order_id: number; odoslane_at: string };
		expect(r.glass_order_id).toBe(3);
		expect(r.odoslane_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		expect(() =>
			d
				.prepare('INSERT INTO objednavka_skla_odoslanie (zak_norm, glass_order_id) VALUES (?, ?)')
				.run('ZAK2', 0)
		).toThrow();
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
