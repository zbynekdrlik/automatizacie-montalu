// Reálny prod upgrade path v24 → v25: nová tabuľka `dopyt` (#277). Postav DB v stave v24
// (len tabuľky, ktoré seed funkcie čítajú, s ≥1 riadkom → seedData/seedUsers no-opnú),
// import db.ts spustí SKUTOČNÝ v25 blok (verzia < 25 → beží len v25, staršie sa preskočia).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v25-test-'));
const dbPath = path.join(tmpRoot, 'v24.db');

{
	const v24 = new Database(dbPath);
	v24.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
	`);
	// ≥1 riadok do každej tabuľky čítanej seedom → seedData/seedUsers no-op
	v24
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v24.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 0)").run();
	v24.prepare("INSERT INTO glass_types (nazov, system) VALUES ('X', 'ALL')").run();
	v24.pragma('user_version = 24');
	v24.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v24 → v25: tabuľka dopyt (#277)', () => {
	it('user_version === 25 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(25);
	});

	it('existujúci user (palo) prežil migráciu (žiadna strata dát)', () => {
		const row = db.prepare("SELECT username FROM users WHERE username = 'palo'").get();
		expect(row).toEqual({ username: 'palo' });
	});

	it('tabuľka dopyt existuje s očakávanými stĺpcami', () => {
		const cols = (db.prepare('PRAGMA table_info(dopyt)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toEqual([
			'id',
			'konfiguracia',
			'meno',
			'email',
			'telefon',
			'miesto',
			'poznamka',
			'created_at'
		]);
	});

	it('dopyt je zapisovateľný (created_at default)', () => {
		db.prepare(
			"INSERT INTO dopyt (konfiguracia, meno, email) VALUES ('{}', 'Ján', 'j@x.sk')"
		).run();
		const row = db.prepare('SELECT meno, email, telefon, created_at FROM dopyt').get() as {
			meno: string;
			email: string;
			telefon: string;
			created_at: string;
		};
		expect(row.meno).toBe('Ján');
		expect(row.telefon).toBe(''); // DEFAULT ''
		expect(row.created_at).toMatch(/\d{4}-\d{2}-\d{2}/);
	});
});
