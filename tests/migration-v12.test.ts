// Reálny prod upgrade path v11 → v12: Štandard + IZO spodná koľajnica späť na NORMÁLNU
// (Dominik 2026-07-15: veľkosť koľajnice neurčuje IZO; o 1 väčšiu dá checkbox „prídavná
// koľajnica"). Postav DB v stave v11 so STARÝMI (zväčšenými) IZO koľajnicami, potom import
// db.ts spustí SKUTOČNÝ v12 blok → over že IZO spodnú koľajnicu vráti na hodnotu z cfg_seed
// (normálna) a NEDOTKNE sa hornej koľajnice ani basic/opona.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import seed from '../src/lib/server/cfg_seed.json';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v12-test-'));
const dbPath = path.join(tmpRoot, 'v11.db');

// STARÉ (zväčšené) IZO spodné koľajnice: normal → o 1 väčšia (opak novej opravy).
const OLD_UPSIZE: Record<string, { kod: string; nazov: string }> = {
	ZASP00104: { kod: 'ZASP00030', nazov: 'Koľajnica spodná 3K Surový 7500 mm' },
	ZASP00030: { kod: 'ZASP00033', nazov: 'Koľajnica spodná 4K Surový 7500 mm' },
	ZASP00033: { kod: 'ZASP202432', nazov: 'Koľajnica spodná 5K Surový 7500 mm' },
	ZASP202432: { kod: 'ZASP202437', nazov: 'Koľajnica spodná 6K Surový 7500 mm' }
};

{
	const v11 = new Database(dbPath);
	v11.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	const insSys = v11.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
	const insRez = v11.prepare(
		`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const s of seed.sys) insSys.run(s.sysStyl, s.N, s.skloOffset);
	for (const r of seed.rez) {
		// simuluj STARÝ stav: IZO spodná koľajnica zväčšená o 1
		let kod = r.kod,
			nazov = r.nazov;
		if (/^Štandard \+\|\d+K IZO$/.test(r.sysStyl) && /spodná/i.test(r.nazov) && OLD_UPSIZE[r.kod]) {
			kod = OLD_UPSIZE[r.kod]!.kod;
			nazov = OLD_UPSIZE[r.kod]!.nazov;
		}
		insRez.run(
			r.sysStyl,
			r.poradie,
			r.typ,
			kod,
			nazov,
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
	v11.exec(
		"INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES ('X', 0, 1, 'ALL')"
	);
	v11.pragma('user_version = 11');
	v11.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

const row = (sysStyl: string, poradie: number) =>
	db
		.prepare('SELECT kod, nazov FROM cfg_rez WHERE sys_styl = ? AND poradie = ?')
		.get(sysStyl, poradie) as { kod: string; nazov: string } | undefined;

describe('reálny v11 → v12: IZO spodná koľajnica späť na normálnu', () => {
	it('user_version = 13 (finálna po všetkých migráciách)', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(36);
	});

	it('KAŽDÁ IZO spodná koľajnica je opravená na cfg_seed (normálna, nie zväčšená)', () => {
		const izoSpodna = seed.rez.filter(
			(r) => /^Štandard \+\|\d+K IZO$/.test(r.sysStyl) && /spodná/i.test(r.nazov)
		);
		expect(izoSpodna.length).toBe(5);
		for (const r of izoSpodna) {
			const got = row(r.sysStyl, r.poradie)!;
			expect(got.kod, r.sysStyl).toBe(r.kod);
			expect(got.nazov, r.sysStyl).toBe(r.nazov);
		}
		// konkrétne: 2K IZO späť na 2K koľajnicu
		expect(row('Štandard +|2K IZO', 15)!.kod).toBe('ZASP00104');
	});

	it('NEDOTKNE sa hornej koľajnice ani basic/opona spodnej', () => {
		// 2K IZO horná = ZASP00107 (nezmenené)
		const horna = seed.rez.find(
			(r) => r.sysStyl === 'Štandard +|2K IZO' && /horná/i.test(r.nazov)
		)!;
		expect(row('Štandard +|2K IZO', horna.poradie)!.kod).toBe(horna.kod);
		// basic 2K spodná = ZASP00104 (nezmenené)
		expect(row('Štandard +|2K', 15)!.kod).toBe('ZASP00104');
	});
});
