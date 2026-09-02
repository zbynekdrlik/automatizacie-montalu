// Reálny prod upgrade path v35 → v36 (#5825): durable APPEND-ONLY log pushov odpisu do Odoo modelu
// `montalu.material.odpis`. Postav DB v stave v35 (base tabuľky s ≥1 riadkom → seedData/seedUsers
// no-opnú; bez tabuľky `odoo_odpis_push`), import db.ts spustí SKUTOČNÝ v36 blok. Overuje:
// user_version=36, nová tabuľka + stĺpce + indexy, APPEND-ONLY (dva riadky rovnaký content_hash+action
// → dve distinctné monotónne id), defaulty, žiadna strata iných dát.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v36-test-'));
const dbPath = path.join(tmpRoot, 'v35.db');

{
	const v35 = new Database(dbPath);
	// Minimálne base tabuľky, aby seedData/seedUsers po migrácii no-opli (≥1 riadok v každej).
	v35.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), role TEXT NOT NULL DEFAULT 'internal');
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0, UNIQUE(nazov, system));
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	v35
		.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('palo', 'x:y', 'internal')")
		.run();
	v35.prepare("INSERT INTO cfg_sys (sys_styl, n, sklo_offset) VALUES ('X', 1, 0)").run();
	v35.prepare("INSERT INTO glass_types (nazov, system) VALUES ('X', 'ALL')").run();
	v35.pragma('user_version = 35');
	v35.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v35 → v36: durable append-only push-log pre odpis → Odoo (#5825)', () => {
	it('user_version === 36 po migrácii', () => {
		expect(db.pragma('user_version', { simple: true })).toBe(36);
	});

	it('vznikla tabuľka odoo_odpis_push s očakávanými stĺpcami', () => {
		const cols = (db.prepare('PRAGMA table_info(odoo_odpis_push)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toEqual([
			'id',
			'content_hash',
			'action',
			'payload',
			'payload_version',
			'pending',
			'attempts',
			'next_attempt_at',
			'last_error',
			'odoo_id',
			'sale_order_id',
			'posted_at',
			'created_at',
			'updated_at'
		]);
	});

	it('APPEND-ONLY: dva riadky s rovnakým content_hash+action → DVA distinctné monotónne id (žiaden UNIQUE)', () => {
		const ins = db.prepare(
			"INSERT INTO odoo_odpis_push (content_hash, action, payload) VALUES ('H1', 'import', '{}')"
		);
		const id1 = ins.run().lastInsertRowid as number;
		const id2 = ins.run().lastInsertRowid as number; // rovnaký hash+action — NESMIE hodiť
		expect(id2).toBeGreaterThan(id1);
		const n = (
			db.prepare("SELECT COUNT(*) c FROM odoo_odpis_push WHERE content_hash='H1'").get() as {
				c: number;
			}
		).c;
		expect(n).toBe(2);
	});

	it('existujú indexy idx_odoo_odpis_push_pending a idx_odoo_odpis_push_hash', () => {
		const names = (
			db
				.prepare(
					"SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_odoo_odpis_push%'"
				)
				.all() as { name: string }[]
		).map((r) => r.name);
		expect(names).toContain('idx_odoo_odpis_push_pending');
		expect(names).toContain('idx_odoo_odpis_push_hash');
	});

	it('defaulty: pending=1, attempts=0, payload_version=1, next_attempt_at/odoo_id/posted_at NULL, created_at set', () => {
		db.prepare(
			"INSERT INTO odoo_odpis_push (content_hash, action, payload) VALUES ('H2', 'release', '{}')"
		).run();
		const row = db
			.prepare(
				'SELECT pending, attempts, payload_version, next_attempt_at, odoo_id, posted_at, last_error, created_at, updated_at FROM odoo_odpis_push WHERE content_hash = ?'
			)
			.get('H2') as Record<string, unknown>;
		expect(row.pending).toBe(1);
		expect(row.attempts).toBe(0);
		expect(row.payload_version).toBe(1);
		expect(row.next_attempt_at).toBeNull();
		expect(row.odoo_id).toBeNull();
		expect(row.posted_at).toBeNull();
		expect(row.last_error).toBe('');
		expect(row.created_at).toBeTruthy();
		expect(row.updated_at).toBeTruthy();
	});

	it('base dáta (users) prežili migráciu (žiadna strata)', () => {
		const row = db.prepare("SELECT username FROM users WHERE username = 'palo'").get();
		expect(row).toEqual({ username: 'palo' });
	});
});
