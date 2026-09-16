// #521: migration v47 → v48 — spec_* stĺpce na objednavka_skla (špecifikácia tabule pre IZOS).
// Postav DB v stave v47 (base tabuľky + objednavka_skla bez spec stĺpcov), import db.ts spustí v48.
// Aditívne (ADD COLUMN, neutrálne defaulty) → existujúce riadky prežijú byte-identicky.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v48-test-'));
const dbPath = path.join(tmpRoot, 'v47.db');

const SPEC_COLS = [
	'spec_warm_edge',
	'spec_colored_frame',
	'spec_muntin_cross_qty',
	'spec_holes_qty',
	'spec_hole_size',
	'spec_cutout_small_qty',
	'spec_cutout_large_qty',
	'spec_edge_finish',
	'spec_hst',
	'spec_tempering_own_glass'
];

{
	const v47 = new Database(dbPath);
	// base tabuľky (seedData/migrate ich očakáva) + objednavka_skla v pôvodnom (v41) tvare,
	// s jedným existujúcim riadkom
	v47.exec(`
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
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			created_by TEXT NOT NULL DEFAULT ''
		);
		INSERT INTO objednavka_skla (zak, zak_norm, modul, popis, sirka_mm, vyska_mm, pocet, typ_skla, created_by)
			VALUES ('ZAK-V48', 'ZAKV48', 'zasklenia', 'Posuv 1', 1200, 800, 2, 'Izolačné sklo 4/16/4 číre', 'test');
		PRAGMA user_version = 47;
	`);
	v47.close();
}

process.env.DATABASE_PATH = dbPath;

describe('migration v47 → v48 (objednavka_skla spec)', () => {
	it('bumps to v48 and adds all 10 spec_* columns', async () => {
		await import('../src/lib/server/db');
		const d = new Database(dbPath);
		expect(d.pragma('user_version', { simple: true })).toBe(48);

		const cols = (
			d.prepare('PRAGMA table_info(objednavka_skla)').all() as { name: string }[]
		).map((c) => c.name);
		for (const c of SPEC_COLS) expect(cols).toContain(c);
		// pôvodné stĺpce ostávajú
		expect(cols).toContain('typ_skla');
		expect(cols).toContain('rezim');
		d.close();
	});

	it('existing row survives with neutral spec defaults (byte-identical base data)', () => {
		const d = new Database(dbPath);
		const row = d
			.prepare('SELECT * FROM objednavka_skla WHERE zak_norm = ?')
			.get('ZAKV48') as Record<string, unknown>;
		expect(row.sirka_mm).toBe(1200);
		expect(row.pocet).toBe(2);
		expect(row.typ_skla).toBe('Izolačné sklo 4/16/4 číre');
		// spec defaults
		expect(row.spec_warm_edge).toBe(0);
		expect(row.spec_holes_qty).toBe(0);
		expect(row.spec_hole_size).toBe('');
		expect(row.spec_edge_finish).toBe('');
		expect(row.spec_tempering_own_glass).toBe(0);
		d.close();
	});

	it('spec columns are writable', () => {
		const d = new Database(dbPath);
		d.prepare(
			`UPDATE objednavka_skla SET spec_warm_edge = 1, spec_holes_qty = 2, spec_hole_size = 'd30', spec_edge_finish = 'ksr' WHERE zak_norm = ?`
		).run('ZAKV48');
		const row = d.prepare('SELECT * FROM objednavka_skla WHERE zak_norm = ?').get('ZAKV48') as Record<
			string,
			unknown
		>;
		expect(row.spec_warm_edge).toBe(1);
		expect(row.spec_holes_qty).toBe(2);
		expect(row.spec_hole_size).toBe('d30');
		expect(row.spec_edge_finish).toBe('ksr');
		d.close();
	});
});
