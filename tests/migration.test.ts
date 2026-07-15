// Migrácia v1 → v2 na PRODUKČNÝCH dátach: existujúce zasklenia odpisy si musia
// zachovať dedup (HARD RULE: tá istá ZAK+OP sa nesmie do Money poslať druhýkrát
// ani po migrácii schémy).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-migr-test-'));
const dbPath = path.join(tmpRoot, 'test.db');

// 1. postav v1 DB presne ako ju vytvorila prvá verzia appky
{
	const v1 = new Database(dbPath);
	v1.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE cfg_audit (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), username TEXT NOT NULL, sys_styl TEXT NOT NULL, zmeny TEXT NOT NULL);
		CREATE TABLE odpis_log (
			id INTEGER PRIMARY KEY, zak TEXT NOT NULL, op TEXT NOT NULL, zakaznik TEXT NOT NULL,
			system TEXT NOT NULL, styl TEXT NOT NULL, s REAL NOT NULL, v REAL NOT NULL,
			sklo TEXT NOT NULL DEFAULT '', otvaranie TEXT NOT NULL DEFAULT '',
			caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL,
			target TEXT NOT NULL, filename TEXT NOT NULL, content_hash TEXT NOT NULL DEFAULT '',
			created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
			UNIQUE (zak, op, live)
		);
		CREATE TABLE problem_reports (id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now')), username TEXT NOT NULL DEFAULT '', oblast TEXT NOT NULL DEFAULT '', popis TEXT NOT NULL);
	`);
	v1.prepare(
		`INSERT INTO odpis_log (zak, op, zakaznik, system, styl, s, v, sklo, otvaranie, caka, live, target, filename, content_hash, created_by)
		 VALUES ('ZAK-MIG-1', '01', 'Migrovaný', 'Robust', '2K', 2509, 1930, 'Izolačné sklo 4/16/4 mliečne', 'P - L', 0, 0, '/test/subor.xlsx', 'subor.xlsx', 'abcd1234', 'marek')`
	).run();
	v1.pragma('user_version = 1');
	v1.close();
}

// 2. import appky nad v1 DB → migrate() zbehne pri importe
process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');
const { writeOdpis } = await import('../src/lib/server/money');

describe('migrácia odpis_log v1 → v2/v3', () => {
	it('user_version = 9 a dáta prežili s modul=zasklenia + detail JSON', () => {
		// v1 DB prejde VŠETKÝMI migráciami po import db.ts (naposledy v9 Štandard +).
		expect(db.pragma('user_version', { simple: true })).toBe(12);
		const row = db
			.prepare('SELECT modul, zak, op, zakaznik, live, content_hash, detail FROM odpis_log WHERE zak = ?')
			.get('ZAK-MIG-1') as Record<string, unknown>;
		expect(row.modul).toBe('zasklenia');
		expect(row.zakaznik).toBe('Migrovaný');
		expect(row.content_hash).toBe('abcd1234');
		const d = JSON.parse(String(row.detail));
		expect(d.system).toBe('Robust');
		expect(d.styl).toBe('2K');
		expect(d.s).toBe(2509);
		// v4: Robust 4K + 2x4K (koľajnica ZASP20254); v5: Slide opona 2x2K + 2x3K
		const styly = db.prepare("SELECT sys_styl FROM cfg_sys WHERE sys_styl IN ('Robust|4K','Robust|2x4K','Slide|2x2K','Slide|2x3K')").all() as { sys_styl: string }[];
		expect(styly.length).toBe(4);
		expect(db.prepare("SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl='Robust|2x4K' AND kod='ZASP20254'").get()).toEqual({ c: 2 });
		// Slide opona má redukciu (sklozavislé) — kľúčový rozdiel oproti Robust opone
		expect(db.prepare("SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl='Slide|2x2K' AND kod='ZASP00091' AND sklozavisle=1").get()).toEqual({ c: 2 });
	});

	it('v7: Deluxe — 8 štýlov, hrúbka skla vyberá kladka/klzný (sklo_hrubka + glass_types.hrubka)', () => {
		// v7 zlúčila 5K6/5K10/6K6/6K10 → 5K/6K: 8 základných štýlov (2K…6K), hrúbka
		// skla (6/10) vyberá kladka/klzný profil — nie štýl (Dominik 2026-07-10).
		const deluxe = db.prepare("SELECT sys_styl FROM cfg_sys WHERE sys_styl LIKE 'Deluxe|%'").all() as { sys_styl: string }[];
		expect(deluxe.length).toBe(8);
		const styly = new Set(deluxe.map((d) => d.sys_styl.split('|')[1]));
		expect(styly).toEqual(new Set(['2K', '3K', '4K', '2x2K', '2x3K', '2x4K', '5K', '6K']));
		// staré delené štýly už NEEXISTUJÚ
		expect(db.prepare("SELECT COUNT(*) c FROM cfg_sys WHERE sys_styl IN ('Deluxe|5K6','Deluxe|5K10','Deluxe|6K6','Deluxe|6K10')").get()).toEqual({ c: 0 });
		// nové stĺpce existujú
		const cols = (db.prepare('PRAGMA table_info(cfg_rez)').all() as { name: string }[]).map((c) => c.name);
		expect(cols).toContain('dlzka_tyce');
		expect(cols).toContain('sklo_hrubka');
		const gcols = (db.prepare('PRAGMA table_info(glass_types)').all() as { name: string }[]).map((c) => c.name);
		expect(gcols).toContain('hrubka');
		// kladka/klzný sú hrúbko-závislé: 6mm → sklo_hrubka=6, 10mm → =10; oba 3600mm tyč
		expect(db.prepare("SELECT DISTINCT sklo_hrubka h, dlzka_tyce d FROM cfg_rez WHERE kod='ZASP202416'").get()).toEqual({ h: 6, d: 3600 });
		expect(db.prepare("SELECT DISTINCT sklo_hrubka h, dlzka_tyce d FROM cfg_rez WHERE kod='ZASP202424'").get()).toEqual({ h: 6, d: 3600 });
		expect(db.prepare("SELECT DISTINCT sklo_hrubka h, dlzka_tyce d FROM cfg_rez WHERE kod='ZASP202417'").get()).toEqual({ h: 10, d: 3600 });
		expect(db.prepare("SELECT DISTINCT sklo_hrubka h, dlzka_tyce d FROM cfg_rez WHERE kod='ZASP202425'").get()).toEqual({ h: 10, d: 3600 });
		// každý Deluxe štýl má PRÁVE JEDNU 6mm + JEDNU 10mm kladku (nie napevno 10mm)
		expect(db.prepare("SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl='Deluxe|2K' AND sklo_hrubka=6").get()).toEqual({ c: 2 }); // kladka+klzný 6mm
		expect(db.prepare("SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl='Deluxe|2K' AND sklo_hrubka=10").get()).toEqual({ c: 2 }); // kladka+klzný 10mm
		// koľajnice/dorazové/sklo = hrúbko-nezávislé (sklo_hrubka=0)
		expect(db.prepare("SELECT DISTINCT sklo_hrubka h FROM cfg_rez WHERE kod IN ('ZASP00078','ZASP00104','ZASP00021')").all()).toEqual([{ h: 0 }]);
		// 5K horná koľajnica = 6000mm tyč (Money-kritické)
		expect(db.prepare("SELECT dlzka_tyce d FROM cfg_rez WHERE sys_styl='Deluxe|5K' AND kod='ZASP202434'").get()).toEqual({ d: 6000 });
		// migrované Robust/Slide riadky = default 7500 tyč + sklo_hrubka 0 (žiadna regresia).
		// Štandard + (v9, pridaný neskôr) LEGITÍMNE má vlastné 3600mm-tyčové profily
		// (kladkový prírez, IZO U profil) — vylúčený z tejto v7-scoped kontroly, ktorá
		// overuje LEN Robust/Slide po Deluxe migrácii, nie Štandard +.
		expect(
			db
				.prepare(
					"SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl NOT LIKE 'Deluxe|%' AND sys_styl NOT LIKE 'Štandard +|%' AND (dlzka_tyce <> 7500 OR sklo_hrubka <> 0)"
				)
				.get()
		).toEqual({ c: 0 });
		// Deluxe sklá (Float kalené) majú hrúbku 6/10; Robust/Slide/ALL sklá = 0
		expect(db.prepare("SELECT hrubka h FROM glass_types WHERE nazov='Float kalené 6 mm'").get()).toEqual({ h: 6 });
		expect(db.prepare("SELECT hrubka h FROM glass_types WHERE nazov='Float kalené 10 mm'").get()).toEqual({ h: 10 });
		expect(db.prepare("SELECT COUNT(*) c FROM glass_types WHERE system<>'Deluxe' AND hrubka<>0").get()).toEqual({ c: 0 });
		// 2x3K spodná koľajnica = 3K (ZASP00030), workbook preklep ZASP00104 opravený
		expect(db.prepare("SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl='Deluxe|2x3K' AND poradie=15 AND kod='ZASP00030'").get()).toEqual({ c: 1 });
		expect(db.prepare("SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl='Deluxe|2x3K' AND kod='ZASP00104'").get()).toEqual({ c: 0 });
	});

	it('dedup migrovaného záznamu drží — tá istá ZAK+OP sa neodošle druhýkrát', async () => {
		process.env.MONEY_LIVE = '0';
		process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'odpis-export');
		const out = await writeOdpis({
			modul: 'zasklenia',
			zak: 'ZAK-MIG-1',
			op: '01',
			zakaznik: 'Migrovaný',
			caka: false,
			createdBy: 'vitest',
			cakaSubdir: 'Robust',
			filenameBase: 'ZAK-MIG-1 - OP01 - Migrovaný ZASKLENIA Robust 2K',
			popis: '01 : Migrovaný',
			polozky: [{ kod: 'ZASP00014', nazov: 'Koľajnica', qty: 15 }],
			detail: {}
		});
		expect(out.status).toBe('duplicate');
	});

	it('iný modul tej istej ZAK+OP po migrácii prejde', async () => {
		const out = await writeOdpis({
			modul: 'bazen',
			zak: 'ZAK-MIG-1',
			op: '01',
			zakaznik: 'Migrovaný',
			caka: false,
			createdBy: 'vitest',
			cakaSubdir: 'Bazen',
			filenameBase: 'ZAK-MIG-1 - OP01 - Migrovaný BAZEN',
			popis: '01 Migrovaný',
			polozky: [{ kod: 'BPP00091', nazov: '2-koľaj', qty: 4.6 }],
			detail: {}
		});
		expect(out.status).toBe('written');
	});

	it('opakovaný beh migrácie je idempotentný (žiadny crash-loop)', () => {
		// simulácia prerušenej migrácie: odpis_log2 ostal, verzia späť na 1
		db.exec('CREATE TABLE odpis_log2 (id INTEGER PRIMARY KEY)');
		db.pragma('user_version = 1');
		// re-run migračného bloku (rovnaké SQL ako v db.ts)
		expect(() =>
			db.exec(`
				BEGIN;
				DROP TABLE IF EXISTS odpis_log2;
				CREATE TABLE odpis_log2 (
					id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL,
					zakaznik TEXT NOT NULL, caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL,
					target TEXT NOT NULL, filename TEXT NOT NULL, content_hash TEXT NOT NULL DEFAULT '',
					detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '',
					created_at TEXT NOT NULL DEFAULT (datetime('now')),
					UNIQUE (modul, zak, op, live)
				);
				INSERT INTO odpis_log2 SELECT * FROM odpis_log;
				DROP TABLE odpis_log;
				ALTER TABLE odpis_log2 RENAME TO odpis_log;
				PRAGMA user_version = 2;
				COMMIT;
			`)
		).not.toThrow();
		expect(db.pragma('user_version', { simple: true })).toBe(2);
		expect((db.prepare('SELECT COUNT(*) c FROM odpis_log').get() as { c: number }).c).toBeGreaterThan(0);
	});
});
