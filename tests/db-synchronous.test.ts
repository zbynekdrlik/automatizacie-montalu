// #246: durability guard — DB pripojenie MUSÍ bežať s `synchronous = FULL` (2), aby bol
// commitnutý dedup záznam v odpis_log fsync-ovaný pri každom commite (nie až pri
// checkpointe, ako pri NORMAL). Toto NIE je RED regresný test — na súčasnom
// better-sqlite3 builde je default už 2, takže test drží hodnotu ako PIN: keby niekto
// pridal `PRAGMA synchronous = NORMAL`, alebo by upgrade better-sqlite3 znížil WAL
// default, tento test padne.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-sync-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'sync.db');

const { db } = await import('../src/lib/server/db');

describe('db pripojenie — durability pragmas (#246)', () => {
	it('synchronous = FULL (2)', () => {
		expect(db.pragma('synchronous', { simple: true })).toBe(2);
	});

	it('journal_mode = WAL (existujúci kontrakt ostáva)', () => {
		expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
	});
});
