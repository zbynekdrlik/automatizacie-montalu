// Reálny prod upgrade path v26 → v27: Deluxe 5K vrchná (horná) koľajnica mala
// nesprávny Money kód ZASP202434 → správne ZASP202427 (nahlásil zákazník Patrik
// Javorský, Odoo kanál 207, msg 1734424, 2026-08-24; #296). Postav DB v stave v26
// s cfg_rez, kde Deluxe|5K poradie 10 = STARÝ kód ZASP202434, import db.ts spustí
// SKUTOČNÝ v27 blok (verzia < 27 → beží len v27, staršie sa preskočia). Overuje:
// user_version=27, kód vrchnej koľajnice opravený, spodná koľajnica (poradie 15)
// aj iný systém (Deluxe|6K) NEZMENENÉ (žiadny over-reach), starý kód už neexistuje.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v27-test-'));
const dbPath = path.join(tmpRoot, 'v26.db');

{
	const v26 = new Database(dbPath);
	v26.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	// ≥1 riadok do každej tabuľky čítanej seedom → seedData/seedUsers no-op
	v26
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v26.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('Deluxe|5K', 5, 83)").run();
	v26.prepare("INSERT INTO glass_types (nazov, system) VALUES ('X', 'ALL')").run();
	const ins = v26.prepare(
		'INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, dlzka_tyce) VALUES (?, ?, ?, ?, ?, ?, ?)'
	);
	// Deluxe|5K vrchná koľajnica so STARÝM (zlým) kódom — presný prod stav pred opravou
	ins.run('Deluxe|5K', 10, 'profil', 'ZASP202434', 'Koľajnica horná 5K Surový 6000 mm', 'S', 6000);
	// Deluxe|5K spodná koľajnica — NESMIE sa dotknúť (poradie 15)
	ins.run('Deluxe|5K', 15, 'profil', 'ZASP202432', 'Koľajnica spodná 5K Surový 7500 mm', 'S', 7500);
	// iný systém (Deluxe|6K vrchná koľajnica) — NESMIE sa dotknúť (WHERE viaže sys_styl)
	ins.run('Deluxe|6K', 10, 'profil', 'ZASP202411', 'Koľajnica horná 6K Surový 7500 mm', 'S', 7500);
	v26.pragma('user_version = 26');
	v26.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v26 → v27: Deluxe 5K vrchná koľajnica ZASP202434 → ZASP202427 (#296)', () => {
	it('user_version === 27 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(27);
	});

	it('Deluxe|5K vrchná koľajnica (poradie 10) má opravený kód ZASP202427', () => {
		const row = db
			.prepare(
				"SELECT kod, nazov, dlzka_tyce FROM cfg_rez WHERE sys_styl='Deluxe|5K' AND poradie=10"
			)
			.get();
		expect(row).toEqual({
			kod: 'ZASP202427',
			nazov: 'Koľajnica horná 5K Surový 6000 mm',
			dlzka_tyce: 6000 // fyzický profil (6000mm tyč) nezmenený
		});
	});

	it('Deluxe|5K spodná koľajnica (poradie 15) ostáva ZASP202432 — žiadny over-reach', () => {
		expect(
			db.prepare("SELECT kod FROM cfg_rez WHERE sys_styl='Deluxe|5K' AND poradie=15").get()
		).toEqual({ kod: 'ZASP202432' });
	});

	it('iný systém (Deluxe|6K vrchná koľajnica) sa migráciou nedotkne', () => {
		expect(
			db.prepare("SELECT kod FROM cfg_rez WHERE sys_styl='Deluxe|6K' AND poradie=10").get()
		).toEqual({ kod: 'ZASP202411' });
	});

	it('starý kód ZASP202434 už v cfg_rez neexistuje', () => {
		expect(db.prepare("SELECT COUNT(*) c FROM cfg_rez WHERE kod='ZASP202434'").get()).toEqual({
			c: 0
		});
	});
});
