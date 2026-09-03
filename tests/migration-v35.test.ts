// Reálny prod upgrade path v34 → v35: stĺpec `produkt` na tabuľke `dopyt` (#384, jednotný verejný
// konfigurátor). Postav DB v stave v34 (base tabuľky s ≥1 riadkom → seedData/seedUsers no-opnú;
// tabuľka `dopyt` BEZ `produkt` + 1 existujúci riadok), import db.ts spustí SKUTOČNÝ v35 blok
// (staršie sa preskočia). Overuje: user_version=35, pribudol stĺpec `produkt`, existujúci riadok
// prežil s `produkt IS NULL` (starý pergolový dopyt), nový riadok sa dá zapísať s `produkt`.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v35-test-'));
const dbPath = path.join(tmpRoot, 'v34.db');

{
	const v34 = new Database(dbPath);
	// Minimálne base tabuľky, aby seedData/seedUsers po migrácii no-opli (≥1 riadok v každej).
	v34.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE dopyt (id INTEGER PRIMARY KEY, konfiguracia TEXT NOT NULL DEFAULT '{}', meno TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', telefon TEXT NOT NULL DEFAULT '', miesto TEXT NOT NULL DEFAULT '', poznamka TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
	`);
	v34
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v34.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 0)").run();
	v34.prepare("INSERT INTO glass_types (nazov, system) VALUES ('X', 'ALL')").run();
	// existujúci (starý pergolový) dopyt bez `produkt` — musí migráciu prežiť
	v34.prepare("INSERT INTO dopyt (meno, email) VALUES ('Starý dopyt', 'stary@example.com')").run();
	v34.pragma('user_version = 34');
	v34.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v34 → v35: stĺpec produkt na dopyt (#384)', () => {
	it('user_version === 35 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(37);
	});

	it('tabuľka dopyt má nový stĺpec produkt', () => {
		const cols = (db.prepare('PRAGMA table_info(dopyt)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toContain('produkt');
	});

	it('existujúci (starý) dopyt prežil migráciu s produkt IS NULL (spätná kompatibilita)', () => {
		const row = db
			.prepare("SELECT meno, produkt FROM dopyt WHERE email = 'stary@example.com'")
			.get() as { meno: string; produkt: string | null };
		expect(row.meno).toBe('Starý dopyt');
		expect(row.produkt).toBeNull();
	});

	it('nový dopyt sa dá zapísať s produktom', () => {
		db.prepare(
			"INSERT INTO dopyt (meno, email, produkt) VALUES ('Nový', 'novy@example.com', 'bazen')"
		).run();
		const row = db.prepare("SELECT produkt FROM dopyt WHERE email = 'novy@example.com'").get() as {
			produkt: string | null;
		};
		expect(row.produkt).toBe('bazen');
	});
});
