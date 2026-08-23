// Reálny prod upgrade path v10 → v11: oprava NÁZVOV profilov Štandard + podľa Money
// katalógu (Dominik 2026-07-15: kód sedí, názov domotaný). Postav DB v stave v10 so
// STARÝMI (domotanými) názvami, potom import db.ts spustí SKUTOČNÝ v11 blok → over že
// názvy opraví na hodnotu z cfg_seed. Money-safe (kód nezmenený, len zobrazenie).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import seed from '../src/lib/server/cfg_seed.json';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v11-test-'));
const dbPath = path.join(tmpRoot, 'v10.db');

// 1. Postav DB v stave v10: schéma + VŠETKY štýly, ale Štandard profil NÁZVY „OLD-…"
//    (domotané), aby sme simulovali chybný prod stav pred opravou názvov.
{
	const v10 = new Database(dbPath);
	v10.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	const insSys = v10.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
	const insRez = v10.prepare(
		`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const s of seed.sys) insSys.run(s.sysStyl, s.N, s.skloOffset);
	for (const r of seed.rez) {
		const oldNazov =
			r.sysStyl.startsWith('Štandard +') && r.typ === 'profil' ? 'OLD-' + r.nazov : r.nazov;
		insRez.run(
			r.sysStyl,
			r.poradie,
			r.typ,
			r.kod,
			oldNazov,
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
	v10.exec(
		"INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES ('X', 0, 1, 'ALL')"
	);
	v10.pragma('user_version = 10');
	v10.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

const naz = (sysStyl: string, poradie: number) =>
	(
		db
			.prepare('SELECT nazov n FROM cfg_rez WHERE sys_styl = ? AND poradie = ?')
			.get(sysStyl, poradie) as { n: string } | undefined
	)?.n;

describe('reálny v10 → v11 upgrade: oprava názvov profilov Štandard +', () => {
	it('user_version = 11', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(25);
	});

	it('KAŽDÝ Štandard profil názov je opravený na cfg_seed (žiadne „OLD-")', () => {
		const stdProfil = seed.rez.filter(
			(r) => r.sysStyl.startsWith('Štandard +') && r.typ === 'profil'
		);
		expect(stdProfil.length).toBeGreaterThan(50);
		for (const r of stdProfil)
			expect(naz(r.sysStyl, r.poradie), `${r.sysStyl} ${r.kod}`).toBe(r.nazov);
	});

	it('konkrétne opravy z katalógu (kladkový/koncový profil)', () => {
		const kladka = seed.rez.find((r) => r.sysStyl === 'Štandard +|2K' && r.kod === 'ZASP202415')!;
		expect(naz('Štandard +|2K', kladka.poradie)).toBe('Kladkový profil Surový 3600mm');
	});
});
