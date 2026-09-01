import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-v8-test-'));
const dbPath = path.join(tmpRoot, 'v7.db');

// Build a DB in v7 state: users table with NO role column, one existing user.
{
	const v7 = new Database(dbPath);
	v7.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
		CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
		CREATE TABLE cfg_sys (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL UNIQUE, n INTEGER NOT NULL, sklo_offset REAL NOT NULL);
		CREATE TABLE cfg_rez (id INTEGER PRIMARY KEY, sys_styl TEXT NOT NULL, poradie INTEGER NOT NULL, typ TEXT NOT NULL, kod TEXT NOT NULL DEFAULT '', nazov TEXT NOT NULL, dim TEXT NOT NULL, koef REAL NOT NULL DEFAULT 1, offset REAL NOT NULL DEFAULT 0, delit_n INTEGER NOT NULL DEFAULT 0, kerf REAL NOT NULL DEFAULT 0, pocet_ks REAL NOT NULL DEFAULT 0, sklozavisle INTEGER NOT NULL DEFAULT 0, dlzka_tyce REAL NOT NULL DEFAULT 7500, sklo_hrubka INTEGER NOT NULL DEFAULT 0);
		CREATE TABLE glass_types (id INTEGER PRIMARY KEY, nazov TEXT NOT NULL UNIQUE, redukcia_zero INTEGER NOT NULL DEFAULT 0, poradie INTEGER NOT NULL DEFAULT 0, system TEXT NOT NULL DEFAULT 'ALL', hrubka INTEGER NOT NULL DEFAULT 0);
	`);
	v7.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)').run('palo', 'x:y');
	v7.pragma('user_version = 7');
	v7.close();
}

process.env.DATABASE_PATH = dbPath;
const { db } = await import('../src/lib/server/db');

describe('migrácia v7 → v8: role stĺpec', () => {
	it('pridá role default internal, existujúci user nedotknutý, user_version=9 (po v8+v9)', () => {
		// import db.ts spustí aj v9 (Štandard +) hneď po v8 — konečná verzia je 9.
		expect(db.pragma('user_version', { simple: true })).toBe(35);
		const cols = (db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toContain('role');
		expect(db.prepare("SELECT role FROM users WHERE username='palo'").get()).toEqual({
			role: 'internal'
		});
	});
});
