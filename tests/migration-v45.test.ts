// Reálny prod upgrade path v44 → v45: uložené plány rezov (#505, prečíslovaná z
// pôvodnej v43→v44 kvôli kolízii s #504 v44 — pozri migracie-seed.ts).
// Postav DB v stave v43 (base tabuľky + ≥1 riadok → seedData/seedUsers no-opnú),
// import db.ts spustí SKUTOČNÝ migračný reťazec vrátane v43→v44 (#504) a v44→v45
// (#505). Overuje: user_version=45, nová tabuľka + stĺpce + index, zapisovateľnosť,
// žiadna strata iných dát.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v45-test-'));
const dbPath = path.join(tmpRoot, 'v43.db');

{
	const v43 = new Database(dbPath);
	// Minimálne base tabuľky (vzor migration-v34.test.ts).
	v43.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	v43
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v43.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 0)").run();
	v43.prepare("INSERT INTO glass_types (nazov, system) VALUES ('X', 'ALL')").run();
	v43.pragma('user_version = 43');
	v43.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v44 → v45: plan_rezov_ulozene (#505)', () => {
	it('user_version === 45 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(45);
	});

	it('vznikla tabuľka plan_rezov_ulozene s očakávanými stĺpcami', () => {
		const cols = (
			db.prepare('PRAGMA table_info(plan_rezov_ulozene)').all() as { name: string }[]
		).map((c) => c.name);
		expect(cols).toEqual([
			'id',
			'nazov',
			'zak',
			'cad_text',
			'dlzka_tyce',
			'rezna_medzera',
			'created_at',
			'created_by'
		]);
	});

	it('existuje index idx_plan_rezov_ulozene_nazov', () => {
		const idx = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='index' AND name='idx_plan_rezov_ulozene_nazov'"
			)
			.get();
		expect(idx).toBeTruthy();
	});

	it('zápis + čítanie fungujú', () => {
		db.prepare(
			"INSERT INTO plan_rezov_ulozene (nazov, zak, cad_text, dlzka_tyce, rezna_medzera, created_by) VALUES ('Brány', 'ZAK1', 'PROFIL\t2\t5330', 6000, 4, 'test')"
		).run();
		const row = db
			.prepare(
				'SELECT nazov, zak, cad_text, dlzka_tyce, rezna_medzera FROM plan_rezov_ulozene WHERE nazov = ?'
			)
			.get('Brány') as Record<string, unknown>;
		expect(row.nazov).toBe('Brány');
		expect(row.zak).toBe('ZAK1');
		expect(row.cad_text).toBe('PROFIL\t2\t5330');
		expect(row.dlzka_tyce).toBe(6000);
		expect(row.rezna_medzera).toBe(4);
	});

	it('defaulty: zak prázdny, dlzka_tyce 6000, rezna_medzera 4, created_at vyplnený', () => {
		db.prepare(
			"INSERT INTO plan_rezov_ulozene (nazov, cad_text) VALUES ('Test defaults', 'X\t1\t1000')"
		).run();
		const row = db
			.prepare(
				'SELECT zak, dlzka_tyce, rezna_medzera, created_at, created_by FROM plan_rezov_ulozene WHERE nazov = ?'
			)
			.get('Test defaults') as Record<string, unknown>;
		expect(row.zak).toBe('');
		expect(row.dlzka_tyce).toBe(6000);
		expect(row.rezna_medzera).toBe(4);
		expect(row.created_at).toBeTruthy();
		expect(row.created_by).toBe('');
	});

	it('base dáta (users) prežili migráciu', () => {
		const row = db.prepare("SELECT username FROM users WHERE username = 'palo'").get();
		expect(row).toEqual({ username: 'palo' });
	});
});
