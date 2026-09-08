// Reálny prod upgrade path v39 → v40: Štandard Drevo systém (#445).
// Postav DB v stave v39 (base tabuľky + cfg_rez — Drevostavby ešte neexistuje),
// import db.ts spustí SKUTOČNÝ v40 blok. Overuje: user_version=40, nové cfg_sys +
// cfg_rez riadky, zapisovateľnosť, žiadna strata iných dát.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v40-test-'));
const dbPath = path.join(tmpRoot, 'v39.db');

{
	const v39 = new Database(dbPath);
	// Minimálne base tabuľky, aby seedData/seedUsers po migrácii no-opli.
	v39.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL, zakaznik TEXT NOT NULL DEFAULT '', caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, target TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', zak_norm TEXT NOT NULL DEFAULT '', op_norm TEXT NOT NULL DEFAULT '', presunute_at TEXT);
		CREATE TABLE odpis_odpad (id INTEGER PRIMARY KEY, odpis_log_id INTEGER NOT NULL REFERENCES odpis_log(id) ON DELETE CASCADE, profil_kod TEXT NOT NULL, profil_nazov TEXT NOT NULL, odpad_mm INTEGER NOT NULL, material_mm INTEGER NOT NULL, tyce INTEGER NOT NULL);
	`);
	v39
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	// Seed an existing system that should NOT be affected
	v39.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('Robust|2K', 2, 0)").run();
	v39.prepare("INSERT INTO glass_types (nazov, system) VALUES ('Float 6 mm', 'ALL')").run();
	v39.pragma('user_version = 39');
	v39.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v39 → v40: Štandard Drevo systém (#445)', () => {
	it('user_version === 40 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(41);
	});

	it('cfg_sys obsahuje Štandard Drevo|4K', () => {
		const row = db.prepare("SELECT * FROM cfg_sys WHERE sys_styl = 'Štandard Drevo|4K'").get() as
			Record<string, unknown> | undefined;
		expect(row).toBeTruthy();
		expect(row!.n).toBe(4);
		expect(row!.sklo_offset).toBe(0);
	});

	it('cfg_rez má 12 riadkov pre Štandard Drevo|4K (10 profil + 2 sklo)', () => {
		const count = (
			db.prepare("SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl = 'Štandard Drevo|4K'").get() as {
				c: number;
			}
		).c;
		expect(count).toBe(12);
	});

	it('cfg_rez má priečkový profil ZASP00113 s dlzkaTyce 5800', () => {
		const row = db
			.prepare("SELECT * FROM cfg_rez WHERE sys_styl = 'Štandard Drevo|4K' AND kod = 'ZASP00113'")
			.get() as Record<string, unknown> | undefined;
		expect(row).toBeTruthy();
		expect(row!.dlzka_tyce).toBe(5800);
		expect(row!.pocet_ks).toBe(3);
	});

	it('cfg_rez má 3 riadky ZASP202439 (U-profily s rôznymi rolami)', () => {
		const rows = db
			.prepare(
				"SELECT * FROM cfg_rez WHERE sys_styl = 'Štandard Drevo|4K' AND kod = 'ZASP202439' ORDER BY poradie"
			)
			.all() as Record<string, unknown>[];
		expect(rows).toHaveLength(3);
		// poradie 50: šírka U (dim=S)
		expect(rows[0]!.dim).toBe('S');
		expect(rows[0]!.pocet_ks).toBe(14);
		// poradie 51: výška U priečka (dim=V, koef=0.5)
		expect(rows[1]!.dim).toBe('V');
		expect(rows[1]!.koef).toBeCloseTo(0.5);
		expect(rows[1]!.pocet_ks).toBe(12);
		// poradie 52: výška U plný (dim=V, koef=1)
		expect(rows[2]!.dim).toBe('V');
		expect(rows[2]!.koef).toBeCloseTo(1);
		expect(rows[2]!.pocet_ks).toBe(2);
	});

	it('existujúce dáta (Robust|2K, users) prežili migráciu', () => {
		const sys = db.prepare("SELECT * FROM cfg_sys WHERE sys_styl = 'Robust|2K'").get() as
			Record<string, unknown> | undefined;
		expect(sys).toBeTruthy();
		const user = db.prepare("SELECT username FROM users WHERE username = 'palo'").get();
		expect(user).toEqual({ username: 'palo' });
	});
});
