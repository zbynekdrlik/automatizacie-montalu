// Reálny prod upgrade path v8 → v9: Štandard + zasklenie (13 nových štýlov:
// basic 2K…6K, IZO 2K IZO…6K IZO, opona 2x2K/2x3K/2x4K). Postav DB presne v
// stave v8 (role stĺpec už existuje, existujúce Robust/Slide/Deluxe dáta),
// potom import db.ts spustí SKUTOČNÝ v9 migračný kód (nie kópiu SQL) — over že
// pridá presne 13 nových sys_styl + ich rez riadky z cfg_seed.json, pridá 4
// nové glass_types (system='Štandard +'), a NEDOTKNE SA Robust/Slide/Deluxe
// (aditívny dôkaz — additive proof požadovaný zadaním).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import seed from '../src/lib/server/cfg_seed.json';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v9-test-'));
const dbPath = path.join(tmpRoot, 'v8.db');

// 1. Postav DB presne v stave v8: schéma + Robust/Slide/Deluxe dáta (BEZ Štandard +).
{
	const v8 = new Database(dbPath);
	v8.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	const insSys = v8.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
	const insRez = v8.prepare(
		`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const insGlass = v8.prepare(
		'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system, hrubka) VALUES (?, ?, ?, ?, ?)'
	);
	// seed ONLY the non-Štandard+ styles (Robust/Slide/Deluxe), exactly as v8 would have them
	for (const s of seed.sys) {
		if (s.sysStyl.startsWith('Štandard +')) continue;
		insSys.run(s.sysStyl, s.N, s.skloOffset);
		for (const r of seed.rez.filter((x) => x.sysStyl === s.sysStyl))
			insRez.run(
				r.sysStyl,
				r.poradie,
				r.typ,
				r.kod,
				r.nazov,
				r.dim,
				r.koef,
				r.offset,
				r.delitN,
				r.kerf,
				r.pocetKs,
				r.sklozavisle,
				(r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500,
				(r as { skloHrubka?: number }).skloHrubka ?? 0
			);
	}
	insGlass.run('Izolačné sklo 4/16/4 mliečne', 0, 10, 'Robust', 0);
	insGlass.run('Float kalené 6 mm', 0, 10, 'Deluxe', 6);
	insGlass.run('Float kalené 10 mm', 0, 20, 'Deluxe', 10);
	v8.pragma('user_version = 8');
	v8.close();
}

// 2. Import appky nad v8 DB → migrate() spustí REÁLNY v9 blok z db.ts
process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('reálny v8 → v9 upgrade: Štandard + zasklenie (13 nových štýlov)', () => {
	it('user_version=9', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(35);
	});

	it('presne 13 nových Štandard + štýlov (basic 2K…6K, IZO 2K IZO…6K IZO, opona 2x2K/2x3K/2x4K)', () => {
		const rows = db
			.prepare("SELECT sys_styl FROM cfg_sys WHERE sys_styl LIKE 'Štandard +|%'")
			.all() as { sys_styl: string }[];
		expect(rows.length).toBe(13);
		const styly = new Set(rows.map((r) => r.sys_styl.split('|')[1]));
		expect(styly).toEqual(
			new Set([
				'2K',
				'3K',
				'4K',
				'5K',
				'6K',
				'2K IZO',
				'3K IZO',
				'4K IZO',
				'5K IZO',
				'6K IZO',
				'2x2K',
				'2x3K',
				'2x4K'
			])
		);
	});

	it('rez riadky Štandard + sedia presne s cfg_seed.json (kódy, N)', () => {
		const seedRows = seed.rez.filter((r) => r.sysStyl === 'Štandard +|2K IZO');
		const dbRows = db
			.prepare("SELECT kod FROM cfg_rez WHERE sys_styl = 'Štandard +|2K IZO' ORDER BY poradie")
			.all() as { kod: string }[];
		expect(dbRows.length).toBe(seedRows.length);
		// U profil (ZASP202439) je prítomný DVAKRÁT (vodorovný + zvislý, rovnaký kód)
		expect(dbRows.filter((r) => r.kod === 'ZASP202439').length).toBe(2);
		expect(
			(db.prepare("SELECT n FROM cfg_sys WHERE sys_styl='Štandard +|2x3K'").get() as { n: number })
				.n
		).toBe(6);
	});

	it('glass_types so system=Štandard + (Float 4/6/10 + Izolačné 4.8.4; „3.3.1" pridané vo v22)', () => {
		const rows = db
			.prepare("SELECT nazov, hrubka FROM glass_types WHERE system = 'Štandard +' ORDER BY poradie")
			.all() as { nazov: string; hrubka: number }[];
		// „3.3.1" (#214, v22) sedí hneď za „Float sklo 6 mm" (poradie 25)
		expect(rows.map((r) => r.nazov)).toEqual([
			'Float sklo 4 mm',
			'Float sklo 6 mm',
			'3.3.1',
			'Float sklo 10 mm',
			'Izolačné sklo 4.8.4'
		]);
		// žiadne z nich nevyberá kladka/klzný profil podľa hrúbky (na rozdiel od Deluxe)
		expect(rows.every((r) => r.hrubka === 0)).toBe(true);
	});

	it('ADITÍVNY DÔKAZ: Robust/Slide/Deluxe štýly aj ich rez riadky sú NEDOTKNUTÉ', () => {
		const robustSlideDeluxe = seed.sys.filter((s) => !s.sysStyl.startsWith('Štandard +'));
		const countBefore = robustSlideDeluxe.length;
		const countAfter = (
			db.prepare("SELECT COUNT(*) c FROM cfg_sys WHERE sys_styl NOT LIKE 'Štandard +|%'").get() as {
				c: number;
			}
		).c;
		expect(countAfter).toBe(countBefore);
		// spot-check: Robust|2K a Deluxe|5K rez riadky nezmenené (kódy + počty)
		expect(
			(
				db.prepare("SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl='Robust|2K'").get() as {
					c: number;
				}
			).c
		).toBe(seed.rez.filter((r) => r.sysStyl === 'Robust|2K').length);
		expect(
			(
				db.prepare("SELECT COUNT(*) c FROM cfg_rez WHERE sys_styl='Deluxe|5K'").get() as {
					c: number;
				}
			).c
		).toBe(seed.rez.filter((r) => r.sysStyl === 'Deluxe|5K').length);
		// pôvodné glass_types (Robust/Deluxe) nedotknuté
		expect(
			(
				db
					.prepare("SELECT COUNT(*) c FROM glass_types WHERE system IN ('Robust','Deluxe')")
					.get() as {
					c: number;
				}
			).c
		).toBe(3);
	});
});
