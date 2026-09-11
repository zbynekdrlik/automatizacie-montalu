// Reálny prod upgrade path v45 → v46 (#506, prečíslovaná z pôvodnej v44→v45 kvôli
// kolízii s #505 v45 plan_rezov_ulozene): nakup_skladova_karta do material_prices —
// Artikly_Artikl.PosledniCena (posledná nákupná cena na skladovej karte Money).
// Pre BPK komponenty JEDINÝ nákupný zdroj (NC cenník = 0/173).
// Postav DB v stave v45 (base tabuľky + material_prices v42 shape s predaj_pcmo,
// BEZ stĺpca nakup_skladova_karta + jeden base riadok), import db.ts spustí
// SKUTOČNÝ v46 blok. Vzor: migration-v42.test.ts.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { migrateMaterialNakupSkladovaKarta } from '../src/lib/server/migracie-seed';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v46-test-'));
const dbPath = path.join(tmpRoot, 'v45.db');

{
	const v45 = new Database(dbPath);
	// v45 stav: base tabuľky + material_prices v42 shape (s predaj_pcmo, BEZ nakup_skladova_karta).
	v45.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_sklo_trieda (system TEXT NOT NULL, trieda INTEGER NOT NULL, korekcia INTEGER NOT NULL, PRIMARY KEY (system, trieda));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE material_prices (kod TEXT PRIMARY KEY, nakup_cennik REAL, nakup_posledna_faktura REAL, predaj_vo REAL, mena TEXT NOT NULL DEFAULT 'EUR', sklad REAL, updated_at TEXT NOT NULL DEFAULT (datetime('now')), rozvin REAL, predaj_pcmo REAL);
		CREATE TABLE material_prices_meta (id INTEGER PRIMARY KEY CHECK (id = 1), snapshot_generated_at TEXT, snapshot_file_mtime_ms REAL, imported_at TEXT, row_count INTEGER NOT NULL DEFAULT 0, rejected_count INTEGER NOT NULL DEFAULT 0);
	`);
	v45
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v45.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 83)").run();
	v45
		.prepare(
			"INSERT INTO glass_types (nazov, poradie, system) VALUES ('Float sklo 6 mm', 1, 'ALL')"
		)
		.run();
	// base cenový riadok BPK BEZ nakup_skladova_karta — musí prežiť ALTER
	v45
		.prepare(
			"INSERT INTO material_prices (kod, nakup_cennik, predaj_pcmo, mena, sklad) VALUES ('BPK00074', NULL, 12.0, 'EUR', 25)"
		)
		.run();
	v45.pragma('user_version = 45');
	v45.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v45 → v46: nakup_skladova_karta do material_prices (#506)', () => {
	it('user_version === 46 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(47);
	});

	it('material_prices má nový stĺpec nakup_skladova_karta (aditívne, na konci)', () => {
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
			'predaj_pcmo',
			'nakup_skladova_karta'
		]);
	});

	it('base riadok prežil migráciu, nakup_skladova_karta default NULL', () => {
		const row = db
			.prepare(
				"SELECT kod, nakup_cennik, predaj_pcmo, nakup_skladova_karta FROM material_prices WHERE kod = 'BPK00074'"
			)
			.get() as {
			kod: string;
			nakup_cennik: number | null;
			predaj_pcmo: number | null;
			nakup_skladova_karta: number | null;
		};
		expect(row).toEqual({
			kod: 'BPK00074',
			nakup_cennik: null,
			predaj_pcmo: 12,
			nakup_skladova_karta: null
		});
	});

	it('nakup_skladova_karta je zapisovateľný', () => {
		db.prepare(
			"UPDATE material_prices SET nakup_skladova_karta = 4.00 WHERE kod = 'BPK00074'"
		).run();
		const r = db
			.prepare("SELECT nakup_skladova_karta FROM material_prices WHERE kod = 'BPK00074'")
			.get() as { nakup_skladova_karta: number | null };
		expect(r.nakup_skladova_karta).toBe(4);
	});

	it('idempotencia: opätovné volanie migrácie (guard >= 46) nič nemení', () => {
		migrateMaterialNakupSkladovaKarta(db, () => {
			throw new Error('bump sa nesmie zavolať znova — guard >= 46 mal vrátiť skôr');
		});
		expect(db.pragma('user_version', { simple: true })).toBe(47);
	});

	it('feature-detect: DB bez material_prices → bump(46) bez ALTER (minimálne fixtúry nepadnú)', () => {
		const mini = new Database(':memory:');
		mini.pragma('user_version = 45');
		let bumped: number | null = null;
		migrateMaterialNakupSkladovaKarta(mini, (v) => {
			mini.pragma(`user_version = ${v}`);
			bumped = v;
		});
		expect(bumped).toBe(46);
		expect(mini.pragma('user_version', { simple: true })).toBe(46);
		mini.close();
	});
});
