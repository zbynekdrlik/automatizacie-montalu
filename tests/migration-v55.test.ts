// #593 (Odoo úloha 1214, Marek 29.9.: „tu maju byt skla v clip 6mm a 16mm"): migrácia v54 → v55
// doplní povolené hrúbky Odoo skiel pre CLIP zábradlie do `cfg_sklo_hrubka` — 6 mm jednoduché
// (šablóna klasika) a 16 mm izolačné (šablóna IZO). LEN chýbajúce riadky (INSERT OR IGNORE);
// ostatné systémy bez zmeny. Money-NEUTRÁLNE (mení sa len ponuka výplne na /clip).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v55-test-'));
const dbPath = path.join(tmpRoot, 'v54.db');

{
	const v54 = new Database(dbPath);
	v54.exec(`
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
			cena_m2_manual REAL,
			otvor_od_hrany_mm REAL,
			otvor_od_spodku_mm REAL,
			otvor_priemer_mm REAL
		);
		INSERT INTO objednavka_skla (zak, zak_norm, modul, popis, sirka_mm, vyska_mm, pocet, typ_skla, spec_holes_qty, spec_hole_size, created_by)
			VALUES ('ZAK-V52', 'ZAKV52', 'zasklenia', 'Zasklenie 1 — s otvorom ⌀46', 1004, 1914, 2, 'Float kalené 10 mm', 1, 'd50', 'test');
		CREATE TABLE objednavka_skla_odoslanie (zak_norm TEXT PRIMARY KEY, glass_order_id INTEGER NOT NULL CHECK (glass_order_id > 0), name TEXT NOT NULL DEFAULT '', odoslane_at TEXT NOT NULL DEFAULT (datetime('now')), odoslal TEXT NOT NULL DEFAULT '');
		CREATE TABLE cfg_sklo_hrubka (
			id INTEGER PRIMARY KEY,
			system TEXT NOT NULL,
			mm REAL NOT NULL CHECK (mm > 0),
			druh TEXT NOT NULL CHECK (druh IN ('izolacne', 'jednoduche', 'esg')),
			UNIQUE (system, mm)
		);
		-- stav PROD po v54 + (fiktívny) CLIP riadok, ktorý už existuje s iným druhom → v55 ho NESMIE
		-- prepísať ani zdvojiť (INSERT OR IGNORE na UNIQUE(system, mm))
		INSERT INTO cfg_sklo_hrubka (system, mm, druh) VALUES
			('Robust', 24, 'izolacne'),
			('Štandard +', 6, 'jednoduche'), ('Štandard +', 16, 'izolacne'), ('Štandard +', 24, 'izolacne'),
			('Štandard', 6, 'jednoduche'), ('Štandard', 16, 'izolacne'), ('Štandard', 24, 'izolacne'),
			('Štandard +', 4, 'jednoduche'), ('Štandard', 4, 'jednoduche'),
			('Štandard Drevo', 6, 'jednoduche'), ('Štandard Drevo', 16, 'izolacne'), ('Štandard Drevo', 24, 'izolacne');
		PRAGMA user_version = 54;
	`);
	v54.close();
}

process.env.DATABASE_PATH = dbPath;
await import('../src/lib/server/db');

const hrubky = (d: Database.Database, system: string) =>
	(
		d.prepare('SELECT mm, druh FROM cfg_sklo_hrubka WHERE system = ? ORDER BY id').all(system) as {
			mm: number;
			druh: string;
		}[]
	).map((r) => `${r.mm}:${r.druh}`);

describe('migration → v55 (CLIP 6 mm jednoduché + 16 mm izolačné, #593)', () => {
	it('bumpne na v55', () => {
		const d = new Database(dbPath);
		expect(d.pragma('user_version', { simple: true })).toBe(55);
		d.close();
	});

	it('CLIP dostane 6 mm jednoduché + 16 mm izolačné na koniec tabuľky', () => {
		const d = new Database(dbPath);
		expect(hrubky(d, 'CLIP')).toEqual(['6:jednoduche', '16:izolacne']);
		const posledne = d
			.prepare('SELECT system FROM cfg_sklo_hrubka ORDER BY id DESC LIMIT 2')
			.all() as { system: string }[];
		expect(posledne.map((r) => r.system)).toEqual(['CLIP', 'CLIP']);
		d.close();
	});

	it('ostatné systémy bez zmeny', () => {
		const d = new Database(dbPath);
		expect(hrubky(d, 'Štandard')).toEqual([
			'6:jednoduche',
			'16:izolacne',
			'24:izolacne',
			'4:jednoduche'
		]);
		expect(hrubky(d, 'Robust')).toEqual(['24:izolacne']);
		expect(hrubky(d, 'Štandard Drevo')).toEqual(['6:jednoduche', '16:izolacne', '24:izolacne']);
		d.close();
	});

	it('existujúci CLIP riadok (systém, mm) sa NEprepíše ani nezdvojí', () => {
		const d = new Database(dbPath);
		d.prepare('DELETE FROM cfg_sklo_hrubka WHERE system = ?').run('CLIP');
		d.prepare('INSERT INTO cfg_sklo_hrubka (system, mm, druh) VALUES (?, ?, ?)').run(
			'CLIP',
			6,
			'esg'
		);
		d.pragma('user_version = 54');
		d.close();
		return import('../src/lib/server/migracie-clip-sklo-hrubky').then(
			({ migrateClipSkloHrubky }) => {
				const d2 = new Database(dbPath);
				migrateClipSkloHrubky(d2, (v) => d2.pragma(`user_version = ${v}`));
				expect(hrubky(d2, 'CLIP')).toEqual(['6:esg', '16:izolacne']);
				expect(d2.pragma('user_version', { simple: true })).toBe(55);
				// druhý beh je no-op (guard >= 55)
				migrateClipSkloHrubky(d2, () => {
					throw new Error('nemal bumpnúť');
				});
				expect(hrubky(d2, 'CLIP')).toEqual(['6:esg', '16:izolacne']);
				d2.close();
			}
		);
	});
});
