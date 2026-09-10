// Reálny prod upgrade path v41 → v42 (#364): predaj_pcmo do material_prices —
// predajná cena z Money cenníka PCMO pre BPK bazénové komponenty (display-only).
// Postav DB v stave v41 (base tabuľky + material_prices v38 shape s rozvinom,
// BEZ stĺpca predaj_pcmo + jeden base riadok), import db.ts spustí SKUTOČNÝ v42
// blok. Overuje: user_version=42, pribudol stĺpec predaj_pcmo (aditívne, na koniec),
// base riadok prežil (predaj_pcmo default NULL), stĺpec je zapisovateľný,
// idempotencia (guard >= 42 nič nemení).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { migrateMaterialPredajPcmo } from '../src/lib/server/migracie-seed';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v42-test-'));
const dbPath = path.join(tmpRoot, 'v41.db');

{
	const v41 = new Database(dbPath);
	// v41 stav: base tabuľky + material_prices v38 shape (s rozvinom, BEZ predaj_pcmo).
	v41.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_sklo_trieda (system TEXT NOT NULL, trieda INTEGER NOT NULL, korekcia INTEGER NOT NULL, PRIMARY KEY (system, trieda));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE material_prices (kod TEXT PRIMARY KEY, nakup_cennik REAL, nakup_posledna_faktura REAL, predaj_vo REAL, mena TEXT NOT NULL DEFAULT 'EUR', sklad REAL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), rozvin REAL);
		CREATE TABLE material_prices_meta (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot_generated_at TEXT, snapshot_file_mtime_ms REAL, imported_at TEXT, row_count INTEGER NOT NULL DEFAULT 0, rejected_count INTEGER NOT NULL DEFAULT 0);
	`);
	v41
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v41.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 83)").run();
	v41
		.prepare(
			"INSERT INTO glass_types (nazov, poradie, system) VALUES ('Float sklo 6 mm', 1, 'ALL')"
		)
		.run();
	// base cenový riadok BPK BEZ predaj_pcmo — musí prežiť ALTER
	v41
		.prepare(
			"INSERT INTO material_prices (kod, nakup_cennik, mena, sklad, rozvin) VALUES ('BPK00074', NULL, 'EUR', 25, NULL)"
		)
		.run();
	v41.pragma('user_version = 41');
	v41.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v41 → v42: predaj_pcmo do material_prices (#364)', () => {
	it('user_version === 42 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(44);
	});

	it('material_prices má nový stĺpec predaj_pcmo (aditívne, na konci)', () => {
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
			'rozvin',
			'predaj_pcmo'
		]);
	});

	it('base riadok prežil migráciu, predaj_pcmo default NULL', () => {
		const row = db
			.prepare(
				"SELECT kod, nakup_cennik, sklad, predaj_pcmo FROM material_prices WHERE kod = 'BPK00074'"
			)
			.get() as {
			kod: string;
			nakup_cennik: number | null;
			sklad: number;
			predaj_pcmo: number | null;
		};
		expect(row).toEqual({ kod: 'BPK00074', nakup_cennik: null, sklad: 25, predaj_pcmo: null });
	});

	it('predaj_pcmo je zapisovateľný', () => {
		db.prepare("UPDATE material_prices SET predaj_pcmo = 12.00 WHERE kod = 'BPK00074'").run();
		const r = db
			.prepare("SELECT predaj_pcmo FROM material_prices WHERE kod = 'BPK00074'")
			.get() as {
			predaj_pcmo: number | null;
		};
		expect(r.predaj_pcmo).toBe(12);
	});

	it('idempotencia: opätovné volanie migrácie (guard >= 42) nič nemení', () => {
		migrateMaterialPredajPcmo(db, () => {
			throw new Error('bump sa nesmie zavolať znova — guard >= 42 mal vrátiť skôr');
		});
		expect(db.pragma('user_version', { simple: true })).toBe(44);
	});

	it('feature-detect: DB bez material_prices → bump(42) bez ALTER (minimálne fixtúry nepadnú)', () => {
		const mini = new Database(':memory:');
		mini.pragma('user_version = 41');
		let bumped: number | null = null;
		migrateMaterialPredajPcmo(mini, (v) => {
			mini.pragma(`user_version = ${v}`);
			bumped = v;
		});
		expect(bumped).toBe(42);
		// mini DB nikdy nevolá v43 (migrateGlassCatalogExpansion) → ostáva na 42
		expect(mini.pragma('user_version', { simple: true })).toBe(42);
		mini.close();
	});
});
