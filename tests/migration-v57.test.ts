// #608 dorobenie — migrácia v56 → v57: `odpis_log` dostane `poradie INTEGER NOT NULL DEFAULT 1` a
// dedup kľúč sa rozšíri na UNIQUE (modul, zak, op, live, poradie). UNIQUE je inline v CREATE TABLE,
// takže ide o PRESTAVBU tabuľky — a na `odpis_log(id)` visia FK `ON DELETE CASCADE` z `odpis_polozky`
// (v19) aj `odpis_odpad` (v39). Pri zapnutých FK by `DROP TABLE odpis_log` zmazal položky aj odpad
// CASCADE-om → migrácia MUSÍ zachovať každý existujúci riadok (aj id) a všetky detské riadky.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v57-test-'));
const dbPath = path.join(tmpRoot, 'v56.db');

const ODPIS_LOG_V56 = `CREATE TABLE odpis_log (
	id INTEGER PRIMARY KEY,
	modul TEXT NOT NULL,
	zak TEXT NOT NULL,
	op TEXT NOT NULL,
	zakaznik TEXT NOT NULL,
	caka INTEGER NOT NULL DEFAULT 0,
	live INTEGER NOT NULL,
	target TEXT NOT NULL,
	filename TEXT NOT NULL,
	content_hash TEXT NOT NULL DEFAULT '',
	detail TEXT NOT NULL DEFAULT '{}',
	created_by TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	zak_norm TEXT NOT NULL DEFAULT '',
	op_norm TEXT NOT NULL DEFAULT '',
	presunute_at TEXT,
	UNIQUE (modul, zak, op, live)
)`;

{
	const v56 = new Database(dbPath);
	v56.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL DEFAULT '', dim TEXT NOT NULL DEFAULT 'S', koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks INTEGER NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, money_kod TEXT, sklo_korekcia INTEGER, hrubka_trieda INTEGER, UNIQUE(nazov, system));
		CREATE TABLE cfg_sklo_trieda (system TEXT NOT NULL, trieda INTEGER NOT NULL, korekcia INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (system, trieda));
		CREATE TABLE cfg_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), username TEXT NOT NULL, sys_styl TEXT NOT NULL, zmeny TEXT NOT NULL);
		${ODPIS_LOG_V56};
		CREATE INDEX idx_odpis_log_norm ON odpis_log(modul, live, zak_norm, op_norm);
		CREATE TABLE odpis_polozky (id INTEGER PRIMARY KEY, odpis_log_id INTEGER NOT NULL REFERENCES odpis_log(id) ON DELETE CASCADE, kod TEXT NOT NULL, nazov TEXT NOT NULL, qty REAL NOT NULL, mj TEXT NOT NULL DEFAULT 'm');
		CREATE INDEX idx_odpis_polozky_log ON odpis_polozky(odpis_log_id);
		CREATE TABLE odpis_odpad (id INTEGER PRIMARY KEY, odpis_log_id INTEGER NOT NULL REFERENCES odpis_log(id) ON DELETE CASCADE, profil_kod TEXT NOT NULL, profil_nazov TEXT NOT NULL, odpad_mm INTEGER NOT NULL, material_mm INTEGER NOT NULL, tyce INTEGER NOT NULL);
		CREATE INDEX idx_odpis_odpad_log ON odpis_odpad(odpis_log_id);
		CREATE TABLE user_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL CHECK (action IN ('create','role_change','delete','seed')), target_username TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
		CREATE TABLE cfg_sietka_standard (kluc TEXT PRIMARY KEY CHECK (kluc IN ('k', 'r', 'h')), hodnota REAL NOT NULL);
		INSERT INTO cfg_sietka_standard (kluc, hodnota) VALUES ('k', 16.5), ('r', 17), ('h', 3);
		CREATE TABLE objednavka_skla (id INTEGER PRIMARY KEY, zak TEXT NOT NULL, zak_norm TEXT NOT NULL, op TEXT NOT NULL DEFAULT '', modul TEXT NOT NULL, popis TEXT NOT NULL DEFAULT '', sirka_mm REAL NOT NULL, vyska_mm REAL, v_lavo_mm REAL, v_pravo_mm REAL, pocet INTEGER NOT NULL DEFAULT 1, typ_skla TEXT NOT NULL DEFAULT '', sikmy INTEGER NOT NULL DEFAULT 0, m2 REAL, rezim TEXT NOT NULL DEFAULT 'rozmery' CHECK(rezim IN ('rozmery','atyp')), spec_warm_edge INTEGER NOT NULL DEFAULT 0, spec_colored_frame INTEGER NOT NULL DEFAULT 0, spec_muntin_cross_qty INTEGER NOT NULL DEFAULT 0, spec_holes_qty INTEGER NOT NULL DEFAULT 0, spec_hole_size TEXT NOT NULL DEFAULT '', spec_cutout_small_qty INTEGER NOT NULL DEFAULT 0, spec_cutout_large_qty INTEGER NOT NULL DEFAULT 0, spec_edge_finish TEXT NOT NULL DEFAULT '', spec_hst INTEGER NOT NULL DEFAULT 0, spec_tempering_own_glass INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), created_by TEXT NOT NULL DEFAULT '', typ_skla_manual TEXT, cena_m2_manual REAL, otvor_od_hrany_mm REAL, otvor_od_spodku_mm REAL, otvor_priemer_mm REAL);
		CREATE TABLE objednavka_skla_odoslanie (zak_norm TEXT PRIMARY KEY, glass_order_id INTEGER NOT NULL CHECK (glass_order_id > 0), name TEXT NOT NULL DEFAULT '', odoslane_at TEXT NOT NULL DEFAULT (datetime('now')), odoslal TEXT NOT NULL DEFAULT '');
		CREATE TABLE cfg_sklo_hrubka (id INTEGER PRIMARY KEY, system TEXT NOT NULL, mm REAL NOT NULL CHECK (mm > 0), druh TEXT NOT NULL CHECK (druh IN ('izolacne', 'jednoduche', 'esg')), UNIQUE (system, mm));
		INSERT INTO cfg_sklo_hrubka (system, mm, druh) VALUES ('Robust', 24, 'izolacne'), ('Štandard +', 6, 'jednoduche'), ('CLIP', 6, 'jednoduche');

		-- PROD-like odpisy: dva moduly jednej zákazky + jeden parkovaný/presunutý, s ne-sekvenčnými id
		INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm, presunute_at) VALUES
			(7, 'zasklenia', 'ZAK2026337', 'OP260286', 'Zákazník B', 0, 1, '/data/dlv-import/a.xlsx', 'a.xlsx', 'b1e403ee', '{"system":"Robust"}', 'patrik', '2026-10-01 08:00:00', 'ZAK2026337', 'OP260286', NULL),
			(9, 'pergola', 'ZAK2026337', 'OP260286', 'Zákazník B', 0, 1, '/data/dlv-import/b.xlsx', 'b.xlsx', 'c2f5aa01', '{"model":"P1"}', 'dominik', '2026-10-02 09:30:00', 'ZAK2026337', 'OP260286', NULL),
			(12, 'zasklenia', 'ZAK2026400', 'OP260300', 'Zákazník C', 1, 1, '/data/dlv-import/NA ODPIS/Robust/c.xlsx', 'c.xlsx', 'd3a0b0c0', '{}', 'patrik', '2026-09-20 10:00:00', 'ZAK2026400', 'OP260300', '2026-09-21 07:00:00');
		INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES
			(7, 'ZASP00014', 'Koľajnica 2K', 15, 'm'), (7, 'ZASK00027', 'Kladka', 4, 'ks'),
			(9, 'PRP20258', 'Kotviaci profil', 7.5, 'm'),
			(12, 'ZASP00010', 'Nosový', 3, 'm');
		INSERT INTO odpis_odpad (odpis_log_id, profil_kod, profil_nazov, odpad_mm, material_mm, tyce) VALUES
			(7, 'ZASP00014', 'Koľajnica 2K', 1204, 15000, 2),
			(12, 'ZASP00010', 'Nosový', 300, 7500, 1);
		PRAGMA user_version = 56;
	`);
	v56.close();
}

const pred = new Database(dbPath, { readonly: true });
const logPred = pred.prepare('SELECT * FROM odpis_log ORDER BY id').all();
const polozkyPred = pred.prepare('SELECT * FROM odpis_polozky ORDER BY id').all();
const odpadPred = pred.prepare('SELECT * FROM odpis_odpad ORDER BY id').all();
pred.close();

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migration v56 → v57 (#608 poradie odpisu — dorobenie)', () => {
	it('[RED] bumpne na v57', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(57);
	});

	it('[RED] odpis_log má stĺpec poradie (NOT NULL DEFAULT 1) a existujúce riadky majú poradie 1', () => {
		const cols = db.prepare('PRAGMA table_info(odpis_log)').all() as {
			name: string;
			notnull: number;
			dflt_value: string | null;
		}[];
		const poradie = cols.find((c) => c.name === 'poradie');
		expect(poradie).toBeTruthy();
		expect(poradie!.notnull).toBe(1);
		expect(poradie!.dflt_value).toBe('1');
		const rows = db.prepare('SELECT id, poradie FROM odpis_log ORDER BY id').all();
		expect(rows).toEqual([
			{ id: 7, poradie: 1 },
			{ id: 9, poradie: 1 },
			{ id: 12, poradie: 1 }
		]);
	});

	it('[RED] všetky existujúce riadky odpis_log zachované BIT-PRESNE (vrátane id, presunute_at, norm stĺpcov)', () => {
		const po = (
			db.prepare('SELECT * FROM odpis_log ORDER BY id').all() as Record<string, unknown>[]
		).map((r) => {
			const kopia = { ...r };
			delete kopia.poradie;
			return kopia;
		});
		expect(po).toEqual(logPred);
	});

	it('[RED] odpis_polozky aj odpis_odpad (FK CASCADE deti) prežili prestavbu bez straty', () => {
		expect(db.prepare('SELECT * FROM odpis_polozky ORDER BY id').all()).toEqual(polozkyPred);
		expect(db.prepare('SELECT * FROM odpis_odpad ORDER BY id').all()).toEqual(odpadPred);
		expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
	});

	it('[RED] FK sú po migrácii znova ZAPNUTÉ a CASCADE funguje na novej tabuľke', () => {
		expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
		const fk = db.prepare('PRAGMA foreign_key_list(odpis_odpad)').all() as { table: string }[];
		expect(fk.map((f) => f.table)).toEqual(['odpis_log']);
		db.prepare('DELETE FROM odpis_log WHERE id = 12').run();
		expect(
			db.prepare('SELECT COUNT(*) c FROM odpis_polozky WHERE odpis_log_id = 12').get()
		).toEqual({
			c: 0
		});
		expect(db.prepare('SELECT COUNT(*) c FROM odpis_odpad WHERE odpis_log_id = 12').get()).toEqual({
			c: 0
		});
		// ostatné odpisy nedotknuté
		expect(db.prepare('SELECT COUNT(*) c FROM odpis_polozky').get()).toEqual({ c: 3 });
	});

	it('[RED] nový dedup kľúč: rovnaká (modul, zak, op, live) s poradím 2 prejde, s rovnakým poradím nie', () => {
		const ins = db.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, live, target, filename, poradie)
			 VALUES ('zasklenia', 'ZAK2026337', 'OP260286', 'Zákazník B', 1, '/t', 'f.xlsx', ?)`
		);
		expect(() => ins.run(2)).not.toThrow();
		expect(() => ins.run(2)).toThrow(/UNIQUE/);
		expect(() => ins.run(1)).toThrow(/UNIQUE/);
		expect(() => ins.run(0)).toThrow(/CHECK/);
	});

	it('[RED] normalizovaný index idx_odpis_log_norm je po prestavbe späť', () => {
		const idx = db
			.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='odpis_log'")
			.all() as { name: string }[];
		expect(idx.map((i) => i.name)).toContain('idx_odpis_log_norm');
	});

	it('[RED] čerstvá DB (v0 → hlava) má poradie aj UNIQUE s poradím', async () => {
		const { migrate } = await import('../src/lib/server/migracie');
		const fresh = new Database(':memory:');
		fresh.pragma('foreign_keys = ON');
		migrate(fresh, (p) => `x:${p}`);
		const sql = (
			fresh
				.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='odpis_log'")
				.get() as {
				sql: string;
			}
		).sql;
		expect(sql).toMatch(/UNIQUE\s*\(modul, zak, op, live, poradie\)/);
		expect(fresh.pragma('foreign_keys', { simple: true })).toBe(1);
		expect(fresh.pragma('user_version', { simple: true })).toBe(57);
		fresh.close();
	});
});
