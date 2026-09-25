// #548: migration v48 → v49 — typ_skla_manual + cena_m2_manual na objednavka_skla („iné sklo").
// Postav DB v stave v48 (base tabuľky + objednavka_skla so spec stĺpcami, bez manuálnych) → import
// db.ts spustí v49. Aditívne (ADD COLUMN nullable) → existujúci riadok prežije byte-identicky.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v49-test-'));
const dbPath = path.join(tmpRoot, 'v48.db');

{
	const v48 = new Database(dbPath);
	v48.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL DEFAULT '', dim TEXT NOT NULL DEFAULT 'S', koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks INTEGER NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, money_kod TEXT, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_sklo_trieda (system TEXT NOT NULL, trieda INTEGER NOT NULL, korekcia INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (system, trieda));
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL DEFAULT '', zakaznik TEXT NOT NULL DEFAULT '', caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, target TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), zak_norm TEXT NOT NULL DEFAULT '', UNIQUE (modul, zak, op, live));
		CREATE TABLE user_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('create','role_change','delete','seed')), target_username TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
		CREATE TABLE objednavka_skla (
			id INTEGER PRIMARY KEY,
			zak TEXT NOT NULL,
			zak_norm TEXT NOT NULL,
			op TEXT NOT NULL DEFAULT '',
			modul TEXT NOT NULL,
			popis TEXT NOT NULL DEFAULT '',
			sirka_mm REAL NOT NULL,
			vyska_mm REAL,
			v_lavo_mm REAL,
			v_pravo_mm REAL,
			pocet INTEGER NOT NULL DEFAULT 1,
			typ_skla TEXT NOT NULL DEFAULT '',
			sikmy INTEGER NOT NULL DEFAULT 0,
			m2 REAL,
			rezim TEXT NOT NULL DEFAULT 'rozmery' CHECK(rezim IN ('rozmery','atyp')),
			spec_warm_edge INTEGER NOT NULL DEFAULT 0,
			spec_colored_frame INTEGER NOT NULL DEFAULT 0,
			spec_muntin_cross_qty INTEGER NOT NULL DEFAULT 0,
			spec_holes_qty INTEGER NOT NULL DEFAULT 0,
			spec_hole_size TEXT NOT NULL DEFAULT '',
			spec_cutout_small_qty INTEGER NOT NULL DEFAULT 0,
			spec_cutout_large_qty INTEGER NOT NULL DEFAULT 0,
			spec_edge_finish TEXT NOT NULL DEFAULT '',
			spec_hst INTEGER NOT NULL DEFAULT 0,
			spec_tempering_own_glass INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			created_by TEXT NOT NULL DEFAULT ''
		);
		INSERT INTO objednavka_skla (zak, zak_norm, modul, popis, sirka_mm, vyska_mm, pocet, typ_skla, created_by)
			VALUES ('ZAK-V49', 'ZAKV49', 'zasklenia', 'Posuv 1', 1200, 800, 2, 'Izolačné sklo 4/16/4 číre', 'test');
		PRAGMA user_version = 48;
	`);
	v48.close();
}

process.env.DATABASE_PATH = dbPath;
await import('../src/lib/server/db');

describe('migration v48 → v49 (objednavka_skla „iné sklo")', () => {
	it('bumpne na v49 a pridá typ_skla_manual + cena_m2_manual (nullable)', () => {
		const d = new Database(dbPath);
		expect(d.pragma('user_version', { simple: true })).toBe(50);
		const cols = (
			d.prepare('PRAGMA table_info(objednavka_skla)').all() as {
				name: string;
				type: string;
				notnull: number;
			}[]
		).filter((c) => c.name === 'typ_skla_manual' || c.name === 'cena_m2_manual');
		expect(cols.map((c) => c.name).sort()).toEqual(['cena_m2_manual', 'typ_skla_manual']);
		// nullable (notnull=0)
		for (const c of cols) expect(c.notnull).toBe(0);
		d.close();
	});

	it('existujúci riadok prežije s NULL manuálnymi hodnotami (byte-identické base dáta)', () => {
		const d = new Database(dbPath);
		const row = d
			.prepare('SELECT * FROM objednavka_skla WHERE zak_norm = ?')
			.get('ZAKV49') as Record<string, unknown>;
		expect(row.sirka_mm).toBe(1200);
		expect(row.pocet).toBe(2);
		expect(row.typ_skla).toBe('Izolačné sklo 4/16/4 číre');
		expect(row.typ_skla_manual).toBeNull();
		expect(row.cena_m2_manual).toBeNull();
		d.close();
	});

	it('manuálne stĺpce sú zapisovateľné', () => {
		const d = new Database(dbPath);
		d.prepare(
			`UPDATE objednavka_skla SET typ_skla = '', typ_skla_manual = 'lepené 33.1 bronz', cena_m2_manual = 42.5 WHERE zak_norm = ?`
		).run('ZAKV49');
		const row = d
			.prepare('SELECT typ_skla_manual, cena_m2_manual FROM objednavka_skla WHERE zak_norm = ?')
			.get('ZAKV49') as { typ_skla_manual: string; cena_m2_manual: number };
		expect(row.typ_skla_manual).toBe('lepené 33.1 bronz');
		expect(row.cena_m2_manual).toBe(42.5);
		d.close();
	});
});
