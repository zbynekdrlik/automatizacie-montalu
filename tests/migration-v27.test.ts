// Reálny prod upgrade path v26 → v28 (v27 ledger #294 + v28 cfg no-op #296): ochrany proti dvojitému importu do Money —
// append-only ledger `odpis_imported` + normalizované stĺpce `odpis_log.zak_norm`/`op_norm`.
// Postav DB v stave v26 (base tabuľky + `dopyt` s Odoo stĺpcami + `odpis_log` s riadkom), import
// db.ts spustí SKUTOČNÝ v27 blok. Overuje: user_version=27, nová tabuľka + jej CHECK, nové stĺpce
// backfillnuté z RAW hodnôt (existujúci riadok prežije, „stay as-is"), Money-neutrálne (žiadny odpis).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v27-test-'));
const dbPath = path.join(tmpRoot, 'v26.db');

{
	const v26 = new Database(dbPath);
	v26.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
		-- reálna DB má cfg_rez od v1; migrácia v28 (#296) ho UPDATE-uje (Deluxe 5K vrchná koľajnica), prázdna tabuľka = no-op
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE dopyt (id INTEGER PRIMARY KEY, konfiguracia TEXT NOT NULL, meno TEXT NOT NULL, email TEXT NOT NULL, telefon TEXT NOT NULL DEFAULT '', miesto TEXT NOT NULL DEFAULT '', poznamka TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), odoo_lead_id INTEGER, odoo_attempts INTEGER NOT NULL DEFAULT 0, odoo_last_error TEXT NOT NULL DEFAULT '');
		CREATE TABLE odpis_log (id INTEGER PRIMARY KEY, modul TEXT NOT NULL, zak TEXT NOT NULL, op TEXT NOT NULL, zakaznik TEXT NOT NULL, caka INTEGER NOT NULL DEFAULT 0, live INTEGER NOT NULL, target TEXT NOT NULL, filename TEXT NOT NULL, content_hash TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (modul, zak, op, live));
	`);
	// ≥1 riadok do tabuliek čítaných seedom → seedData/seedUsers no-op
	v26
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v26.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 0)").run();
	v26.prepare("INSERT INTO glass_types (nazov, system) VALUES ('X', 'ALL')").run();
	// existujúci odpis (pred migráciou) — RAW zak/op, malé písmená + medzery, aby sa dal overiť backfill
	v26
		.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, created_by)
			 VALUES ('zasklenia', 'ZAK2026273', 'OP260233', 'Rovný', 0, 1, '/x/a.xlsx', 'a.xlsx', 'deadbeef', 'vyroba')`
		)
		.run();
	v26.pragma('user_version = 26');
	v26.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v26 → v27: ochrany proti dvojitému importu (#294)', () => {
	it('user_version === 28 po migrácii (v27 ledger + v28 cfg no-op na prázdnom cfg_rez)', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(39);
	});

	it('nová append-only tabuľka odpis_imported existuje s kind CHECK', () => {
		const cols = (db.prepare('PRAGMA table_info(odpis_imported)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toEqual([
			'id',
			'modul',
			'zak_norm',
			'op_norm',
			'live',
			'content_hash',
			'kind',
			'filename',
			'actor',
			'reason',
			'created_at'
		]);
		// CHECK (kind IN ('import','override')) — neplatná hodnota padne
		expect(() =>
			db
				.prepare(
					"INSERT INTO odpis_imported (modul, zak_norm, op_norm, live, content_hash, kind) VALUES ('zasklenia','Z','O',1,'h','nezmysel')"
				)
				.run()
		).toThrow();
	});

	it('odpis_log má nové stĺpce zak_norm/op_norm', () => {
		const cols = (db.prepare('PRAGMA table_info(odpis_log)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toContain('zak_norm');
		expect(cols).toContain('op_norm');
	});

	it('existujúci odpis prežil migráciu a norm stĺpce sú backfillnuté z RAW (stay as-is)', () => {
		const row = db
			.prepare("SELECT zak, op, zak_norm, op_norm FROM odpis_log WHERE zak = 'ZAK2026273'")
			.get() as { zak: string; op: string; zak_norm: string; op_norm: string };
		expect(row.zak).toBe('ZAK2026273'); // RAW nedotknuté
		expect(row.op).toBe('OP260233');
		expect(row.zak_norm).toBe('ZAK2026273'); // backfill = raw copy (verdikt: existing rows stay as-is)
		expect(row.op_norm).toBe('OP260233');
	});

	it('dopyt (v26) prežil — migrácia je aditívna, nič nestráca', () => {
		const cols = (db.prepare('PRAGMA table_info(dopyt)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toContain('odoo_lead_id');
	});

	// review #294: ledger sa backfillne z existujúcich odpisov, inak by historické importy ostali
	// nechránené (uvoľnenie + identický re-send starého odpisu → dvojitý import).
	it('ledger je backfillnutý z existujúcich odpisov (historické importy chránené)', () => {
		const row = db
			.prepare(
				"SELECT modul, zak_norm, op_norm, live, content_hash, kind, filename, actor FROM odpis_imported WHERE zak_norm = 'ZAK2026273'"
			)
			.get() as {
			modul: string;
			zak_norm: string;
			op_norm: string;
			live: number;
			content_hash: string;
			kind: string;
			filename: string;
			actor: string;
		};
		expect(row).toBeTruthy();
		expect(row.kind).toBe('import');
		expect(row.op_norm).toBe('OP260233'); // raw copy (existujúci riadok „as-is")
		expect(row.content_hash).toBe('deadbeef');
		expect(row.filename).toBe('a.xlsx');
		expect(row.actor).toBe('vyroba');
		// backfill = práve 1 riadok na 1 existujúci odpis (žiadne zdvojenie)
		const n = (
			db.prepare("SELECT COUNT(*) c FROM odpis_imported WHERE kind = 'import'").get() as {
				c: number;
			}
		).c;
		expect(n).toBe(1);
	});
});
