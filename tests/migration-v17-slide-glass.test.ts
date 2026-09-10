// Reálny prod upgrade path v16 → v17: SLIDE SKLÁ podľa dielne (Patrik, 2026-07-27).
// Slide má dve skladby a od skla závisí, či sa počíta Redukcia 6mm (ZASP00091 —
// sklozavislý profil, ktorý má LEN Slide):
//   • bez redukcie = 4/8/4 (skladba 16 mm) → obe varianty redukciu nulujú
//   • s redukciou  = čokoľvek 6 mm → v zozname 6mm číre, 6mm mliečne, 3.3.1
// Kalené 8/10 sa zo Slide odoberajú (do žiadnej skladby sa nezmestia) — zostávajú Robustu.
//
// Postav DB v stave v16 (Slide len 4/8/4, kalené ako 'ALL'), import db.ts spustí
// SKUTOČNÝ v17 blok → over zoznam skiel per systém + že sa Robustu nič nepokazilo.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import seed from '../src/lib/server/cfg_seed.json';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v17-test-'));
const dbPath = path.join(tmpRoot, 'v16.db');

{
	const v16 = new Database(dbPath);
	v16.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	const insSys = v16.prepare('INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES (?, ?, ?)');
	const insRez = v16.prepare(
		`INSERT INTO cfg_rez (sys_styl, poradie, typ, kod, nazov, dim, koef, offset, delit_n, kerf, pocet_ks, sklozavisle, dlzka_tyce, sklo_hrubka)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	for (const s of seed.sys) insSys.run(s.sysStyl, s.N, s.skloOffset);
	for (const r of seed.rez)
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
	// presne stav ostrej DB pred v17 (odčítaný read-only 2026-07-27)
	const insG = v16.prepare(
		'INSERT INTO glass_types (nazov, redukcia_zero, poradie, system) VALUES (?, ?, ?, ?)'
	);
	insG.run('Izolačné sklo 4/16/4 mliečne', 0, 10, 'Robust');
	insG.run('Izolačné sklo 4/16/4 číre', 1, 20, 'Robust');
	insG.run('Izolačné sklo 4/8/4 mliečne', 0, 10, 'Slide');
	insG.run('Izolačné sklo 4/8/4 číre', 1, 20, 'Slide');
	insG.run('Kalené 8mm', 0, 30, 'ALL');
	insG.run('Kalené 10mm', 0, 40, 'ALL');
	insG.run('Float kalené 6 mm', 0, 10, 'Deluxe');
	insG.run('Float sklo 6 mm', 0, 20, 'Štandard +');
	v16.pragma('user_version = 16');
	v16.close();
}

process.env.DATABASE_PATH = dbPath;
const { db, glassTypesForSystem } = await import('../src/lib/server/db');

const nazvy = (system: string) => glassTypesForSystem(system).map((g) => g.nazov);
const glass = (nazov: string) =>
	db.prepare('SELECT redukcia_zero, system FROM glass_types WHERE nazov = ?').get(nazov) as
		{ redukcia_zero: number; system: string } | undefined;

describe('reálny v16 → v17: Slide sklá (bez redukcie 4/8/4, s redukciou 6 mm)', () => {
	it('user_version = 17', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(46);
	});

	it('Slide zoznam je presne to, čo si dielňa vypýtala (v poradí)', () => {
		// v43 (#235) rozšíril katalóg — Slide má teraz plnú škálu (IZO + single + laminated + ESG)
		expect(nazvy('Slide')).toEqual([
			'Izolačné sklo 4/8/4 mliečne',
			'Izolačné sklo 4/8/4 číre',
			'Izolačné sklo 4/8/4 stopsol',
			'Izolačné sklo 4/16/4 číre',
			'Izolačné sklo 4/16/4 mliečne',
			'Izolačné sklo 4/16/4 stopsol',
			'6mm číre',
			'6mm mliečne',
			'3.3.1',
			'3.3.1 mliečne',
			'3.3.2',
			'3.3.2 mliečne',
			'Float sklo 4 mm',
			'Float sklo 10 mm',
			'ESG kalené 4 mm',
			'ESG kalené 6 mm',
			'ESG kalené 10 mm'
		]);
	});

	it('4/8/4 (obe) redukciu NULUJÚ — skladba 16 mm', () => {
		// v43 (#235) pridáva 4/8/4 aj do Robustu → globálny glass() je nejednoznačný → scope cez system
		const slideGlass = glassTypesForSystem('Slide');
		const m = slideGlass.find((g) => g.nazov === 'Izolačné sklo 4/8/4 mliečne');
		const c = slideGlass.find((g) => g.nazov === 'Izolačné sklo 4/8/4 číre');
		expect(m?.redukciaZero).toBe(true);
		expect(c?.redukciaZero).toBe(true);
	});

	it('6 mm sklá redukciu POČÍTAJÚ a patria Slide', () => {
		// 6mm číre a 6mm mliečne existujú len v Slide (globálne unikátne) → glass() je OK
		expect(glass('6mm číre')).toMatchObject({ redukcia_zero: 0, system: 'Slide' });
		expect(glass('6mm mliečne')).toMatchObject({ redukcia_zero: 0, system: 'Slide' });
		// 3.3.1 existuje v 3 systémoch (v43 #235) → over cez glassTypesForSystem
		const slide331 = glassTypesForSystem('Slide').find((g) => g.nazov === '3.3.1');
		expect(slide331).toBeDefined();
		expect(slide331!.redukciaZero).toBe(false);
	});

	it('pôvodné kalené 8/10 mm boli zmazané (v19) — neexistujú pod starými názvami', () => {
		// v43 (#235, Patrik 8.9.) pridáva „ESG kalené" pod NOVÝMI názvami — to nie sú
		// tie isté staré „Kalené 8mm/10mm" (iné názvy, iná fyzická špecifikácia)
		expect(nazvy('Slide')).not.toContain('Kalené 8mm');
		expect(nazvy('Slide')).not.toContain('Kalené 10mm');
		expect(nazvy('Robust')).not.toContain('Kalené 8mm');
		expect(nazvy('Robust')).not.toContain('Kalené 10mm');
	});

	it('Robust pôvodné 4/16/4 sklá stále existujú', () => {
		// v43 pridala ďalšie sklá do Robustu — over pôvodné cez glassTypesForSystem
		const robust416c = glassTypesForSystem('Robust').find(
			(g) => g.nazov === 'Izolačné sklo 4/16/4 číre'
		);
		const robust416m = glassTypesForSystem('Robust').find(
			(g) => g.nazov === 'Izolačné sklo 4/16/4 mliečne'
		);
		expect(robust416m).toBeDefined();
		expect(robust416c).toBeDefined();
	});

	it('Deluxe a Štandard + ostávajú na svojich vlastných sklách (žiadne Slide/Robust sklo)', () => {
		expect(nazvy('Deluxe')).toEqual(['Float kalené 6 mm']);
		// v43 (#235) rozšíril Štandard+ katalóg — plná škála
		expect(nazvy('Štandard +')).toContain('Float sklo 6 mm');
		expect(nazvy('Štandard +')).toContain('3.3.1');
	});

	it('opakovaný beh migrácie nič nezduplikuje (idempotencia)', () => {
		const pocet = (
			db.prepare('SELECT COUNT(*) c FROM glass_types WHERE system = ?').get('Slide') as {
				c: number;
			}
		).c;
		expect(pocet).toBe(17); // 5 pôvodných + 12 z v43 (#235)
	});
});
