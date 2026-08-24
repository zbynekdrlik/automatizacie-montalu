// Reálny prod upgrade path v25 → v26: Odoo lead stavové stĺpce na tabuľke `dopyt` (#278).
// Postav DB v stave v25 (base tabuľky, ktoré seed číta, s ≥1 riadkom → seedData/seedUsers
// no-opnú; + tabuľka `dopyt` z v25 s jedným riadkom), import db.ts spustí SKUTOČNÝ v26 blok
// (verzia < 26 → beží len v26, staršie sa preskočia). Overuje: user_version=26, žiadna strata
// dát (existujúci dopyt prežije), nové stĺpce + ich defaulty, dopyt stále zapisovateľný.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v26-test-'));
const dbPath = path.join(tmpRoot, 'v25.db');

{
	const v25 = new Database(dbPath);
	v25.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
		-- reálna DB má cfg_rez od v1; migrácia v27 (#296) ho UPDATE-uje (Deluxe 5K vrchná koľajnica), prázdna tabuľka = no-op
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE dopyt (
			id INTEGER PRIMARY KEY,
			konfiguracia TEXT NOT NULL,
			meno TEXT NOT NULL,
			email TEXT NOT NULL,
			telefon TEXT NOT NULL DEFAULT '',
			miesto TEXT NOT NULL DEFAULT '',
			poznamka TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`);
	// ≥1 riadok do každej tabuľky čítanej seedom → seedData/seedUsers no-op
	v25
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v25.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 0)").run();
	v25.prepare("INSERT INTO glass_types (nazov, system) VALUES ('X', 'ALL')").run();
	// existujúci dopyt (pred migráciou) → dôkaz, že ALTER nestratí dáta
	v25
		.prepare(
			"INSERT INTO dopyt (konfiguracia, meno, email, miesto) VALUES ('{\"system\":\"Robust\"}', 'Eva', 'eva@x.sk', 'Nitra')"
		)
		.run();
	v25.pragma('user_version = 25');
	v25.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v25 → v26: Odoo lead stavové stĺpce na dopyt (#278)', () => {
	it('user_version === 26 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(28);
	});

	it('existujúci dopyt (Eva) prežil migráciu (žiadna strata dát)', () => {
		const row = db.prepare("SELECT meno, email, miesto FROM dopyt WHERE email = 'eva@x.sk'").get();
		expect(row).toEqual({ meno: 'Eva', email: 'eva@x.sk', miesto: 'Nitra' });
	});

	it('tabuľka dopyt má nové Odoo stĺpce', () => {
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
			'created_at',
			'odoo_lead_id',
			'odoo_attempts',
			'odoo_last_error'
		]);
	});

	it('nové stĺpce majú správne defaulty na existujúcom riadku', () => {
		const row = db
			.prepare(
				"SELECT odoo_lead_id, odoo_attempts, odoo_last_error FROM dopyt WHERE email = 'eva@x.sk'"
			)
			.get() as { odoo_lead_id: number | null; odoo_attempts: number; odoo_last_error: string };
		expect(row.odoo_lead_id).toBeNull(); // ešte nevytvorený lead
		expect(row.odoo_attempts).toBe(0); // DEFAULT 0
		expect(row.odoo_last_error).toBe(''); // DEFAULT ''
	});

	it('dopyt je stále zapisovateľný (aj bez explicitných Odoo stĺpcov)', () => {
		db.prepare(
			"INSERT INTO dopyt (konfiguracia, meno, email) VALUES ('{}', 'Ján', 'j@x.sk')"
		).run();
		const row = db
			.prepare("SELECT odoo_attempts, odoo_lead_id FROM dopyt WHERE email = 'j@x.sk'")
			.get() as { odoo_attempts: number; odoo_lead_id: number | null };
		expect(row.odoo_attempts).toBe(0);
		expect(row.odoo_lead_id).toBeNull();
	});
});
