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
		-- reálna DB má cfg_rez od v1; migrácia v27 (#296) ho UPDATE-uje (Deluxe 5K vrchná koľajnica), prázdna tabuľka = no-op
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
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
	it('user_version === 26 (migruje po najnovšiu) po v25 migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(37);
	});

	it('existujúci user (palo) prežil migráciu (žiadna strata dát)', () => {
		const row = db.prepare("SELECT username FROM users WHERE username = 'palo'").get();
		expect(row).toEqual({ username: 'palo' });
	});

	it('tabuľka dopyt existuje s očakávanými stĺpcami', () => {
		const cols = (db.prepare('PRAGMA table_info(dopyt)').all() as { name: string }[]).map(
			(c) => c.name
		);
		// migrácia beží po NAJNOVŠIU verziu → v26 (#278) doplní Odoo lead stavové stĺpce
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
			'odoo_last_error',
			// #309/v30 — opečiatkovaná cena (migrácia beží po najnovšiu verziu)
			'cena_druh',
			'cena_bez_dph',
			'cena_s_dph',
			'cena_hlbka_grid_m',
			'cena_sirka_grid_m',
			'cena_model',
			'cennik_verzia',
			// #318/v32 — typ cenovej hladiny (MO/VO) opečiatkovanej ceny
			'cena_hladina',
			// #319/v33 — záväzná objednávka (fakturačné údaje + súhlas)
			'je_objednavka',
			'fakt_meno',
			'fakt_adresa',
			'fakt_ico',
			'fakt_dic',
			'suhlas_podmienky',
			// #384/v35 — produktový rad (jednotný verejný konfigurátor)
			'produkt'
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
