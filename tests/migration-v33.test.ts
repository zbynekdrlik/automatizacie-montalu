// Reálny prod upgrade path v32 → v33: záväzná objednávka z konfigurátora (#319) — objednávkové
// stĺpce na tabuľke `dopyt` (`je_objednavka` + fakturačné údaje + súhlas). Postav DB v stave v32
// (base tabuľky s ≥1 riadkom → seedData/seedUsers no-opnú; + `dopyt` s plnou v32 schémou a jedným
// riadkom), import db.ts spustí SKUTOČNÝ v33 blok (staršie sa preskočia). Overuje: user_version=33,
// žiadna strata dát (existujúci dopyt prežije), nové stĺpce + NULL defaulty, objednávka zapisovateľná.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v33-test-'));
const dbPath = path.join(tmpRoot, 'v32.db');

{
	const v32 = new Database(dbPath);
	v32.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		-- plná v32 schéma dopyt (v25 base + v26 Odoo + v30 cena + v32 hladina)
		CREATE TABLE dopyt (
			id INTEGER PRIMARY KEY,
			konfiguracia TEXT NOT NULL,
			meno TEXT NOT NULL,
			email TEXT NOT NULL,
			telefon TEXT NOT NULL DEFAULT '',
			miesto TEXT NOT NULL DEFAULT '',
			poznamka TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			odoo_lead_id INTEGER,
			odoo_attempts INTEGER NOT NULL DEFAULT 0,
			odoo_last_error TEXT NOT NULL DEFAULT '',
			cena_druh TEXT,
			cena_bez_dph REAL,
			cena_s_dph REAL,
			cena_hlbka_grid_m REAL,
			cena_sirka_grid_m REAL,
			cena_model TEXT,
			cennik_verzia TEXT,
			cena_hladina TEXT
		);
	`);
	// ≥1 riadok do každej seed-čítanej tabuľky → seedData/seedUsers no-op
	v32
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v32.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 0)").run();
	v32.prepare("INSERT INTO glass_types (nazov, system) VALUES ('X', 'ALL')").run();
	// existujúci dopyt (pred migráciou) → dôkaz, že ALTER nestratí dáta
	v32
		.prepare(
			"INSERT INTO dopyt (konfiguracia, meno, email, miesto) VALUES ('{\"system\":\"Robust\"}', 'Eva', 'eva@x.sk', 'Nitra')"
		)
		.run();
	v32.pragma('user_version = 32');
	v32.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v32 → v33: objednávkové stĺpce na dopyt (#319)', () => {
	it('user_version === 33 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(33);
	});

	it('existujúci dopyt (Eva) prežil migráciu (žiadna strata dát)', () => {
		const row = db.prepare("SELECT meno, email, miesto FROM dopyt WHERE email = 'eva@x.sk'").get();
		expect(row).toEqual({ meno: 'Eva', email: 'eva@x.sk', miesto: 'Nitra' });
	});

	it('tabuľka dopyt má nové objednávkové stĺpce', () => {
		const cols = (db.prepare('PRAGMA table_info(dopyt)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toEqual(
			expect.arrayContaining([
				'je_objednavka',
				'fakt_meno',
				'fakt_adresa',
				'fakt_ico',
				'fakt_dic',
				'suhlas_podmienky'
			])
		);
	});

	it('nové stĺpce sú NULL na existujúcom (dopyt) riadku — starý riadok ostáva dopyt, nie objednávka', () => {
		const row = db
			.prepare(
				'SELECT je_objednavka, fakt_meno, fakt_adresa, fakt_ico, fakt_dic, suhlas_podmienky FROM dopyt WHERE email = ?'
			)
			.get('eva@x.sk') as Record<string, unknown>;
		expect(row.je_objednavka).toBeNull();
		expect(row.fakt_meno).toBeNull();
		expect(row.fakt_adresa).toBeNull();
		expect(row.fakt_ico).toBeNull();
		expect(row.fakt_dic).toBeNull();
		expect(row.suhlas_podmienky).toBeNull();
	});

	it('objednávka je zapisovateľná (je_objednavka=1 + fakturačné + súhlas)', () => {
		db.prepare(
			`INSERT INTO dopyt (konfiguracia, meno, email, je_objednavka, fakt_meno, fakt_adresa, suhlas_podmienky)
			 VALUES ('{}', 'Ján', 'j@x.sk', 1, 'Ján Novák', 'Hlavná 1, 010 01 Žilina', 1)`
		).run();
		const row = db
			.prepare(
				'SELECT je_objednavka, fakt_meno, fakt_adresa, suhlas_podmienky FROM dopyt WHERE email = ?'
			)
			.get('j@x.sk') as {
			je_objednavka: number;
			fakt_meno: string;
			fakt_adresa: string;
			suhlas_podmienky: number;
		};
		expect(row.je_objednavka).toBe(1);
		expect(row.fakt_meno).toBe('Ján Novák');
		expect(row.fakt_adresa).toBe('Hlavná 1, 010 01 Žilina');
		expect(row.suhlas_podmienky).toBe(1);
	});
});
