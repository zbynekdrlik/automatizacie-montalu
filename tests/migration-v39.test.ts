// Reálny prod upgrade path v38 → v39: per-profil odpad z nárezov (#417 fáza 2).
// Postav DB v stave v38 (base tabuľky + odpis_log — odpis_odpad ešte neexistuje),
// import db.ts spustí SKUTOČNÝ v39 blok. Overuje: user_version=39, nová tabuľka +
// stĺpce + index + FK CASCADE, zapisovateľnosť, žiadna strata iných dát.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v39-test-'));
const dbPath = path.join(tmpRoot, 'v38.db');

{
	const v38 = new Database(dbPath);
	// Minimálne base tabuľky, aby seedData/seedUsers po migrácii no-opli.
	v38.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL, zakaznik TEXT NOT NULL DEFAULT '', caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, target TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', zak_norm TEXT NOT NULL DEFAULT '', op_norm TEXT NOT NULL DEFAULT '', presunute_at TEXT);
	`);
	v38
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v38.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 0)").run();
	v38.prepare("INSERT INTO glass_types (nazov, system) VALUES ('X', 'ALL')").run();
	// Seed an odpis_log row for FK test
	v38
		.prepare(
			"INSERT INTO odpis_log (modul, zak, op, zakaznik, zak_norm, op_norm) VALUES ('zasklenia', 'ZAK1', 'OP1', 'Test', 'ZAK1', 'OP1')"
		)
		.run();
	v38.pragma('user_version = 38');
	v38.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v38 → v39: per-profil odpad z nárezov (#417 fáza 2)', () => {
	it('user_version === 39 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(39);
	});

	it('vznikla tabuľka odpis_odpad s očakávanými stĺpcami', () => {
		const cols = (db.prepare('PRAGMA table_info(odpis_odpad)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toEqual([
			'id',
			'odpis_log_id',
			'profil_kod',
			'profil_nazov',
			'odpad_mm',
			'material_mm',
			'tyce'
		]);
	});

	it('existuje index idx_odpis_odpad_log', () => {
		const idx = db
			.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_odpis_odpad_log'")
			.get();
		expect(idx).toBeTruthy();
	});

	it('zápis + čítanie funguje', () => {
		db.prepare(
			"INSERT INTO odpis_odpad (odpis_log_id, profil_kod, profil_nazov, odpad_mm, material_mm, tyce) VALUES (1, 'ZASP001', 'Rámový', 500, 15000, 2)"
		).run();
		const row = db.prepare('SELECT * FROM odpis_odpad WHERE odpis_log_id = 1').get() as Record<
			string,
			unknown
		>;
		expect(row.profil_kod).toBe('ZASP001');
		expect(row.odpad_mm).toBe(500);
		expect(row.material_mm).toBe(15000);
		expect(row.tyce).toBe(2);
	});

	it('FK CASCADE — zmazanie odpis_log zmaže aj odpis_odpad', () => {
		// odpis_log id=1 has the odpad row from previous test
		const before = (
			db.prepare('SELECT COUNT(*) c FROM odpis_odpad WHERE odpis_log_id = 1').get() as {
				c: number;
			}
		).c;
		expect(before).toBeGreaterThan(0);
		db.prepare('DELETE FROM odpis_log WHERE id = 1').run();
		const after = (
			db.prepare('SELECT COUNT(*) c FROM odpis_odpad WHERE odpis_log_id = 1').get() as {
				c: number;
			}
		).c;
		expect(after).toBe(0);
	});

	it('base dáta (users) prežili migráciu', () => {
		const row = db.prepare("SELECT username FROM users WHERE username = 'palo'").get();
		expect(row).toEqual({ username: 'palo' });
	});
});
