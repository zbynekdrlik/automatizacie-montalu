// Reálny prod upgrade path v23 → v24: audit CHECK rozšírený o 'delete' + 'seed',
// deleteB2BUser audit (#246). SQLite nevie ALTER-núť CHECK → migrácia recreate-ne
// tabuľku user_audit v transakcii a MUSÍ zachovať existujúce riadky.
//
// Postav DB v stave v23 (len tabuľky, ktoré v24 blok alebo seed funkcie čítajú:
// user_audit so STARÝM CHECK, + users/cfg_sys/glass_types s ≥1 riadkom, nech
// seedData/seedUsers na konci migrate() no-opnú), import db.ts spustí SKUTOČNÝ v24
// blok (verzia < 24 → beží len v24, staršie bloky sa preskočia).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v24-test-'));
const dbPath = path.join(tmpRoot, 'v23.db');

{
	const v23 = new Database(dbPath);
	v23.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
		-- reálna DB má cfg_rez od v1; migrácia v27 (#296) ho UPDATE-uje (Deluxe 5K vrchná koľajnica), prázdna tabuľka = no-op
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE user_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('create','role_change')), target_username TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
	`);
	// ≥1 riadok do každej tabuľky čítaje seedom → seedData/seedUsers no-op
	v23
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v23.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 0)").run();
	v23.prepare("INSERT INTO glass_types (nazov, system) VALUES ('X', 'ALL')").run();
	// existujúci audit riadok — recreate ho MUSÍ zachovať
	v23
		.prepare(
			"INSERT INTO user_audit (actor, action, target_username, detail) VALUES ('boss', 'create', 'obchod', 'role=b2b')"
		)
		.run();
	v23.pragma('user_version = 23');
	v23.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v23 → v24: audit CHECK delete+seed, história zachovaná (#246)', () => {
	it('user_version === 24 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(33);
	});

	it('existujúci user_audit riadok (create) prežil recreate tabuľky', () => {
		const row = db
			.prepare("SELECT actor, action, target_username FROM user_audit WHERE action = 'create'")
			.get();
		expect(row).toEqual({ actor: 'boss', action: 'create', target_username: 'obchod' });
	});

	it("CHECK akceptuje 'delete' aj 'seed'", () => {
		expect(() =>
			db
				.prepare(
					"INSERT INTO user_audit (actor, action, target_username) VALUES ('a', 'delete', 't')"
				)
				.run()
		).not.toThrow();
		expect(() =>
			db
				.prepare("INSERT INTO user_audit (actor, action, target_username) VALUES ('', 'seed', 't')")
				.run()
		).not.toThrow();
	});

	it('CHECK stále odmieta neznámu akciu', () => {
		expect(() =>
			db
				.prepare(
					"INSERT INTO user_audit (actor, action, target_username) VALUES ('a', 'bogus', 't')"
				)
				.run()
		).toThrow();
	});
});
