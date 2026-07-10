// Reálny prod upgrade path: DB v stave v6 so STARÝMI 10 Deluxe štýlmi
// (5K6/5K10/6K6/6K10 + malé napevno 10mm), potom import db.ts spustí SKUTOČNÝ v7
// migračný kód (nie kópiu SQL) — over že prod upgrade zmaže staré štýly, naseeduje
// 8 nových, pridá sklo_hrubka/hrubka a nedotkne sa Robust/Slide. Fresh v1→v7 test
// (migration.test.ts) tento starý stav nikdy nevytvorí (v6 už seeduje novú štruktúru),
// preto samostatný fixture. Vitest izoluje test súbory → vlastná db.ts inštancia.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v7up-test-'));
const dbPath = path.join(tmpRoot, 'v6.db');

// 1. Postav DB presne v stave v6 (schéma + STARÉ 10-štýlové Deluxe). Stačia tabuľky,
//    ktorých sa v7 blok + seedData + seedUsers dotýkajú (users/cfg_sys/cfg_rez/glass_types).
{
	const v6 = new Database(dbPath);
	v6.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL');
	`);
	// STARÉ 10-štýlové Deluxe + Robust ako kontrola (že sa nedotkne)
	for (const st of ['2K', '3K', '4K', '2x2K', '2x3K', '2x4K', '5K6', '5K10', '6K6', '6K10'])
		v6.prepare('INSERT INTO cfg_sys (sys_styl,n,sklo_offset) VALUES (?,5,0)').run('Deluxe|' + st);
	v6.prepare('INSERT INTO cfg_sys (sys_styl,n,sklo_offset) VALUES (?,2,135)').run('Robust|2K');
	v6.prepare(
		"INSERT INTO cfg_rez (sys_styl,poradie,typ,kod,nazov,dim,dlzka_tyce) VALUES ('Deluxe|5K10',20,'profil','ZASP202417','Kladka 10mm stará','S',3600)"
	).run();
	v6.prepare(
		"INSERT INTO cfg_rez (sys_styl,poradie,typ,kod,nazov,dim) VALUES ('Robust|2K',10,'profil','ZASP00014','Koľajnica','S')"
	).run();
	v6.prepare("INSERT INTO glass_types (nazov,redukcia_zero,poradie,system) VALUES ('Float kalené 6 mm',0,10,'Deluxe')").run();
	v6.prepare("INSERT INTO glass_types (nazov,redukcia_zero,poradie,system) VALUES ('Float kalené 10 mm',0,20,'Deluxe')").run();
	v6.pragma('user_version = 6');
	v6.close();
}

// 2. Import appky nad v6 DB → migrate() spustí REÁLNY v7 blok z db.ts
process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('reálny v6 → v7 upgrade (prod stav: 10 pôvodných Deluxe štýlov)', () => {
	it('db.ts v7: user_version=7, staré 5K6/5K10/6K6/6K10 preč, 8 nových + hrubka, Robust nedotknutý', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(7);

		// staré delené štýly zmazané
		expect(
			db.prepare("SELECT COUNT(*) c FROM cfg_sys WHERE sys_styl IN ('Deluxe|5K6','Deluxe|5K10','Deluxe|6K6','Deluxe|6K10')").get()
		).toEqual({ c: 0 });
		// presne 8 nových štýlov
		expect((db.prepare("SELECT COUNT(*) c FROM cfg_sys WHERE sys_styl LIKE 'Deluxe|%'").get() as { c: number }).c).toBe(8);
		expect(
			new Set(
				(db.prepare("SELECT sys_styl FROM cfg_sys WHERE sys_styl LIKE 'Deluxe|%'").all() as { sys_styl: string }[]).map(
					(r) => r.sys_styl.split('|')[1]
				)
			)
		).toEqual(new Set(['2K', '3K', '4K', '2x2K', '2x3K', '2x4K', '5K', '6K']));

		// nové stĺpce + hodnoty
		const cols = (db.prepare('PRAGMA table_info(cfg_rez)').all() as { name: string }[]).map((c) => c.name);
		expect(cols).toContain('sklo_hrubka');
		const gcols = (db.prepare('PRAGMA table_info(glass_types)').all() as { name: string }[]).map((c) => c.name);
		expect(gcols).toContain('hrubka');
		expect(db.prepare("SELECT DISTINCT sklo_hrubka h FROM cfg_rez WHERE kod='ZASP202417'").get()).toEqual({ h: 10 });
		expect(db.prepare("SELECT DISTINCT sklo_hrubka h FROM cfg_rez WHERE kod='ZASP202416'").get()).toEqual({ h: 6 });
		expect(db.prepare("SELECT hrubka h FROM glass_types WHERE nazov='Float kalené 6 mm'").get()).toEqual({ h: 6 });
		expect(db.prepare("SELECT hrubka h FROM glass_types WHERE nazov='Float kalené 10 mm'").get()).toEqual({ h: 10 });

		// Robust NEDOTKNUTÝ (dáta ostali, sklo_hrubka default 0)
		expect((db.prepare("SELECT COUNT(*) c FROM cfg_sys WHERE sys_styl='Robust|2K'").get() as { c: number }).c).toBe(1);
		expect(db.prepare("SELECT sklo_hrubka h FROM cfg_rez WHERE kod='ZASP00014'").get()).toEqual({ h: 0 });
	});
});
