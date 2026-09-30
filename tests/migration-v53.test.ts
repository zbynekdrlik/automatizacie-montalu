// #587: migration v52 → v53 (hlavička; fixture z v51 prejde aj v52 #579) — poloha zámkového otvoru na riadku objednávky skla
// (`otvor_od_hrany_mm`, `otvor_od_spodku_mm`, `otvor_priemer_mm`, všetky nullable REAL) → PDF výkres
// pre IZOS. Postav DB v stave v51 (base tabuľky + objednavka_skla s v49 stĺpcami + v51 tabuľka) →
// import db.ts spustí v52. Aditívne ADD COLUMN — existujúce riadky dostanú NULL (honest-null).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v53-test-'));
const dbPath = path.join(tmpRoot, 'v51.db');

{
	const v51 = new Database(dbPath);
	v51.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL DEFAULT '', dim TEXT NOT NULL DEFAULT 'S', koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks INTEGER NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, money_kod TEXT, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_sklo_trieda (system TEXT NOT NULL, trieda INTEGER NOT NULL, korekcia INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (system, trieda));
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL DEFAULT '', zakaznik TEXT NOT NULL DEFAULT '', caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL DEFAULT 0, target TEXT NOT NULL DEFAULT '', filename TEXT NOT NULL DEFAULT '', content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), zak_norm TEXT NOT NULL DEFAULT '', UNIQUE (modul, zak, op, live));
		CREATE TABLE user_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('create','role_change','delete','seed')), target_username TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
		CREATE TABLE cfg_sietka_standard (kluc TEXT PRIMARY KEY CHECK (kluc IN ('k', 'r', 'h')), hodnota REAL NOT NULL);
		INSERT INTO cfg_sietka_standard (kluc, hodnota) VALUES ('k', 16.5), ('r', 17), ('h', 3);
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
			created_by TEXT NOT NULL DEFAULT '',
			typ_skla_manual TEXT,
			cena_m2_manual REAL
		);
		INSERT INTO objednavka_skla (zak, zak_norm, modul, popis, sirka_mm, vyska_mm, pocet, typ_skla, spec_holes_qty, spec_hole_size, created_by)
			VALUES ('ZAK-V52', 'ZAKV52', 'zasklenia', 'Zasklenie 1 — s otvorom ⌀46', 1004, 1914, 2, 'Float kalené 10 mm', 1, 'd50', 'test');
		CREATE TABLE objednavka_skla_odoslanie (zak_norm TEXT PRIMARY KEY, glass_order_id INTEGER NOT NULL CHECK (glass_order_id > 0), name TEXT NOT NULL DEFAULT '', odoslane_at TEXT NOT NULL DEFAULT (datetime('now')), odoslal TEXT NOT NULL DEFAULT '');
		PRAGMA user_version = 51;
	`);
	v51.close();
}

process.env.DATABASE_PATH = dbPath;
await import('../src/lib/server/db');

describe('migration → v53 (poloha otvoru na objednavka_skla, #587)', () => {
	it('bumpne na v53 a pridá tri nullable stĺpce polohy otvoru', () => {
		const d = new Database(dbPath);
		expect(d.pragma('user_version', { simple: true })).toBe(56);
		const cols = d.prepare('PRAGMA table_info(objednavka_skla)').all() as {
			name: string;
			type: string;
			notnull: number;
		}[];
		for (const n of ['otvor_od_hrany_mm', 'otvor_od_spodku_mm', 'otvor_priemer_mm']) {
			const c = cols.find((x) => x.name === n);
			expect(c, n).toBeDefined();
			expect(c!.type).toBe('REAL');
			expect(c!.notnull).toBe(0);
		}
		d.close();
	});

	it('existujúci riadok prežije a má polohu NULL (honest-null — výkres sa negeneruje)', () => {
		const d = new Database(dbPath);
		const r = d
			.prepare(
				'SELECT popis, spec_holes_qty, otvor_od_hrany_mm, otvor_od_spodku_mm, otvor_priemer_mm FROM objednavka_skla WHERE zak_norm = ?'
			)
			.get('ZAKV52') as Record<string, unknown>;
		expect(r.popis).toBe('Zasklenie 1 — s otvorom ⌀46');
		expect(r.spec_holes_qty).toBe(1);
		expect(r.otvor_od_hrany_mm).toBeNull();
		expect(r.otvor_od_spodku_mm).toBeNull();
		expect(r.otvor_priemer_mm).toBeNull();
		d.close();
	});

	it('stĺpce sú zapisovateľné', () => {
		const d = new Database(dbPath);
		d.prepare(
			'UPDATE objednavka_skla SET otvor_od_hrany_mm = 50, otvor_od_spodku_mm = 1050, otvor_priemer_mm = 46 WHERE zak_norm = ?'
		).run('ZAKV52');
		const r = d
			.prepare('SELECT otvor_od_spodku_mm FROM objednavka_skla WHERE zak_norm = ?')
			.get('ZAKV52') as { otvor_od_spodku_mm: number };
		expect(r.otvor_od_spodku_mm).toBe(1050);
		d.close();
	});
});
