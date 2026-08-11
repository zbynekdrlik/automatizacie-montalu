// Reálny prod upgrade path v9 → v10: oprava šírky skla Štandard + (Dominik 2026-07-14:
// všetky skla o 2 mm užšie — chýbala +2 mm rezná rezerva vo vzorci šírky skla).
// Postav DB v stave v9 so STARÝMI offsetmi šírky skla (aktuálny cfg_seed − 2N),
// potom import db.ts spustí SKUTOČNÝ v10 blok → over že offsety opraví na hodnotu
// z cfg_seed a NEDOTKNE sa iných riadkov (koľajnica) ani výšky skla.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import seed from '../src/lib/server/cfg_seed.json';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v10-test-'));
const dbPath = path.join(tmpRoot, 'v9.db');

const N: Record<string, number> = {};
for (const s of seed.sys) N[s.sysStyl] = s.N;

// 1. Postav DB v stave v9: schéma + VŠETKY štýly, ale Štandard "Sklo šírka" offset
//    STARÝ (= cfg_seed − 2N), aby sme simulovali chybný prod stav pred opravou.
{
	const v9 = new Database(dbPath);
	v9.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	const insSys = v9.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
	const insRez = v9.prepare(
		`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const s of seed.sys) insSys.run(s.sysStyl, s.N, s.skloOffset);
	for (const r of seed.rez) {
		// simuluj STARÝ (chybný) stav: Štandard šírka skla o 2N nižšie
		const oldOffset =
			r.sysStyl.startsWith('Štandard +') && r.nazov === 'Sklo šírka'
				? r.offset - 2 * N[r.sysStyl]
				: r.offset;
		insRez.run(
			r.sysStyl,
			r.poradie,
			r.typ,
			r.kod,
			r.nazov,
			r.dim,
			r.koef,
			oldOffset,
			r.delitN,
			r.kerf,
			r.pocetKs,
			r.sklozavisle,
			(r as { dlzkaTyce?: number }).dlzkaTyce ?? 7500,
			(r as { skloHrubka?: number }).skloHrubka ?? 0
		);
	}
	v9.exec(
		"INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES ('X', 0, 1, 'ALL')"
	);
	v9.pragma('user_version = 9');
	v9.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

const off = (sysStyl: string, nazov: string) =>
	(
		db
			.prepare('SELECT offset o FROM cfg_rez WHERE sys_styl = ? AND nazov = ?')
			.get(sysStyl, nazov) as { o: number } | undefined
	)?.o;

describe('reálny v9 → v10 upgrade: oprava šírky skla Štandard + (+2 mm)', () => {
	it('user_version = 10', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(20);
	});

	it('offset šírky skla je opravený na cfg_seed hodnotu (o 2N vyššie) pre KAŽDÝ Štandard štýl', () => {
		const stdSkloWidth = seed.rez.filter(
			(r) => r.sysStyl.startsWith('Štandard +') && r.nazov === 'Sklo šírka'
		);
		expect(stdSkloWidth.length).toBe(13);
		for (const r of stdSkloWidth) expect(off(r.sysStyl, 'Sklo šírka'), r.sysStyl).toBe(r.offset);
	});

	it('NEDOTKNE sa iných riadkov: koľajnica ani výška skla', () => {
		// koľajnica horná 2K = ZASP00107; offset nezmenený voči cfg_seed
		const kol = seed.rez.find((r) => r.sysStyl === 'Štandard +|2K' && r.kod === 'ZASP00107')!;
		expect(off('Štandard +|2K', kol.nazov)).toBe(kol.offset);
		// výška skla nezmenená
		const vys = seed.rez.find((r) => r.sysStyl === 'Štandard +|2K' && r.nazov === 'Sklo výška')!;
		expect(off('Štandard +|2K', 'Sklo výška')).toBe(vys.offset);
	});
});
