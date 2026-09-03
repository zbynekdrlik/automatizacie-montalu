// Reálny prod upgrade path v37 → v38 (#369): rozvin profilu do cenového snapshotu
// pre výpočet spotreby farby na lakovanie. Postav DB v stave v37 (base tabuľky +
// `material_prices` v21 shape BEZ stĺpca `rozvin` + jeden base riadok), import db.ts
// spustí SKUTOČNÝ v38 blok. Overuje: user_version=38, pribudol stĺpec `rozvin`
// (aditívne, na koniec), base riadok prežil (rozvin default NULL), stĺpec je
// zapisovateľný, idempotencia (druhé volanie migrácie s guardom >= 38 nič nemení).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { migrateMaterialRozvin } from '../src/lib/server/migracie-seed';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v38-test-'));
const dbPath = path.join(tmpRoot, 'v37.db');

{
	const v37 = new Database(dbPath);
	// v37 stav: base tabuľky (vzor migration-v37.test.ts) — `material_prices` má
	// v21 shape BEZ `rozvin` (v38 ho pridá). Pred-insertnutý user/cfg → seed skočí.
	v37.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_sklo_trieda (system TEXT NOT NULL, trieda INTEGER NOT NULL, korekcia INTEGER NOT NULL, PRIMARY KEY (system, trieda));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE material_prices (kod TEXT PRIMARY KEY, nakup_cennik REAL, nakup_posledna_faktura REAL, predaj_vo REAL, mena TEXT NOT NULL DEFAULT 'EUR', sklad REAL, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE material_prices_meta (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot_generated_at TEXT, snapshot_file_mtime_ms REAL, imported_at TEXT, row_count INTEGER NOT NULL DEFAULT 0, rejected_count INTEGER NOT NULL DEFAULT 0);
	`);
	v37
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v37.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 83)").run();
	v37
		.prepare(
			"INSERT INTO glass_types (nazov, poradie, system) VALUES ('Float sklo 6 mm', 1, 'ALL')"
		)
		.run();
	// base cenový riadok BEZ rozvinu — musí prežiť ALTER
	v37
		.prepare(
			"INSERT INTO material_prices (kod, nakup_cennik, mena, sklad) VALUES ('ZASP00099', 4.5, 'EUR', 12)"
		)
		.run();
	v37.pragma('user_version = 37');
	v37.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v37 → v38: rozvin do material_prices (#369)', () => {
	it('user_version === 38 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(38);
	});

	it('material_prices má nový stĺpec rozvin (aditívne, na konci)', () => {
		const cols = (db.prepare('PRAGMA table_info(material_prices)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toEqual([
			'kod',
			'nakup_cennik',
			'nakup_posledna_faktura',
			'predaj_vo',
			'mena',
			'sklad',
			'updated_at',
			'rozvin'
		]);
	});

	it('base riadok prežil migráciu, rozvin default NULL', () => {
		const row = db
			.prepare(
				"SELECT kod, nakup_cennik, sklad, rozvin FROM material_prices WHERE kod = 'ZASP00099'"
			)
			.get() as { kod: string; nakup_cennik: number; sklad: number; rozvin: number | null };
		expect(row).toEqual({ kod: 'ZASP00099', nakup_cennik: 4.5, sklad: 12, rozvin: null });
	});

	it('rozvin je zapisovateľný', () => {
		db.prepare("UPDATE material_prices SET rozvin = 0.702 WHERE kod = 'ZASP00099'").run();
		const r = db.prepare("SELECT rozvin FROM material_prices WHERE kod = 'ZASP00099'").get() as {
			rozvin: number | null;
		};
		expect(r.rozvin).toBe(0.702);
	});

	it('idempotencia: opätovné volanie migrácie (guard >= 38) nič nemení', () => {
		migrateMaterialRozvin(db, () => {
			throw new Error('bump sa nesmie zavolať znova — guard >= 38 mal vrátiť skôr');
		});
		expect(db.pragma('user_version', { simple: true })).toBe(38);
	});

	it('feature-detect: DB bez material_prices → bump(38) bez ALTER (minimálne fixtúry nepadnú)', () => {
		const mini = new Database(':memory:');
		mini.pragma('user_version = 37');
		let bumped: number | null = null;
		migrateMaterialRozvin(mini, (v) => {
			mini.pragma(`user_version = ${v}`);
			bumped = v;
		});
		expect(bumped).toBe(38);
		expect(mini.pragma('user_version', { simple: true })).toBe(38);
		mini.close();
	});
});
