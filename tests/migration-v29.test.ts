// Reálny prod upgrade path v28 → v29: POST-import readback z Money DB (#298). Postav DB v stave v28
// (base tabuľky + `odpis_imported` + `odpis_log` s norm stĺpcami), user_version=28 → import db.ts
// spustí SKUTOČNÝ v29 blok (v28 #296 sa preskočí, netreba `cfg_rez`). Overuje: user_version=29, nové
// tabuľky `money_dlv` + `money_dlv_meta` s ich stĺpcami/CHECK, Money-NEUTRÁLNE (žiadny odpis sa
// nemení). Vzor: migration-v27.test.ts. (#298 pôvodne v28, prečíslované na v29 po #296 na deve.)
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v29-test-'));
const dbPath = path.join(tmpRoot, 'v28.db');

{
	const v28 = new Database(dbPath);
	v28.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL, zakaznik TEXT NOT NULL, caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL, target TEXT NOT NULL, filename TEXT NOT NULL, content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), zak_norm TEXT NOT NULL DEFAULT '', op_norm TEXT NOT NULL DEFAULT '', UNIQUE (modul, zak, op, live));
		CREATE TABLE odpis_imported (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak_norm TEXT NOT NULL, op_norm TEXT NOT NULL, live INTEGER NOT NULL, content_hash TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('import','override')), filename TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
	`);
	// ≥1 riadok do tabuliek čítaných seedom → seedData/seedUsers no-op (cfg_rez netreba, v28 #296 sa
	// pri user_version=28 preskočí, takže jeho `UPDATE cfg_rez` sa nespustí).
	v28
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v28.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 0)").run();
	v28.prepare("INSERT INTO glass_types (nazov, system) VALUES ('X', 'ALL')").run();
	// existujúci LIVE odpis pred migráciou — musí prežiť nedotknutý (Money-neutralita)
	v28
		.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, created_by, zak_norm, op_norm)
			 VALUES ('zasklenia', 'ZAK2026273', 'OP260233', 'Rovný', 0, 1, '/x/a.xlsx', 'a.xlsx', 'deadbeef', 'vyroba', 'ZAK2026273', 'OP260233')`
		)
		.run();
	v28.pragma('user_version = 28');
	v28.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v28 → v29: POST-import readback z Money DB (#298)', () => {
	it('user_version === 29 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(37);
	});

	it('nová tabuľka money_dlv existuje so správnymi stĺpcami', () => {
		const cols = (db.prepare('PRAGMA table_info(money_dlv)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toEqual([
			'dlv',
			'zak_norm',
			'op_norm',
			'datum',
			'pocet_polozek',
			'popis',
			'updated_at'
		]);
	});

	it('nová tabuľka money_dlv_meta existuje s CHECK(id=1) + window_days', () => {
		const cols = (db.prepare('PRAGMA table_info(money_dlv_meta)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toContain('snapshot_generated_at');
		expect(cols).toContain('window_days');
		// CHECK(id=1): druhý riadok s id=2 musí padnúť
		db.prepare(
			'INSERT INTO money_dlv_meta (id, row_count) VALUES (1, 0) ON CONFLICT(id) DO NOTHING'
		).run();
		expect(() =>
			db.prepare('INSERT INTO money_dlv_meta (id, row_count) VALUES (2, 0)').run()
		).toThrow();
	});

	it('Money-neutralita: existujúci odpis prežil migráciu nedotknutý', () => {
		const row = db
			.prepare("SELECT zak, op, live FROM odpis_log WHERE zak = 'ZAK2026273'")
			.get() as { zak: string; op: string; live: number };
		expect(row).toEqual({ zak: 'ZAK2026273', op: 'OP260233', live: 1 });
	});
});
