import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-authrole-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'a.db');

const db = await import('../src/lib/server/db');
const auth = await import('../src/lib/server/auth');

describe('rola v session + helpery', () => {
	it('isB2B/isInternal', () => {
		expect(auth.isB2B({ id: 1, username: 'x', role: 'b2b' })).toBe(true);
		expect(auth.isB2B({ id: 1, username: 'x', role: 'internal' })).toBe(false);
		expect(auth.isB2B(null)).toBe(false);
		expect(auth.isInternal({ id: 1, username: 'x', role: 'internal' })).toBe(true);
		expect(auth.isInternal(null)).toBe(false);
	});

	it('getSessionUser vracia role', () => {
		db.db
			.prepare("INSERT INTO users (username, pass_hash, role) VALUES ('b2buser', 'x:y', 'b2b')")
			.run();
		const uid = (
			db.db.prepare("SELECT id FROM users WHERE username='b2buser'").get() as { id: number }
		).id;
		db.db
			.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
			.run('tok1', uid, Date.now() + 100000);
		const u = auth.getSessionUser('tok1');
		expect(u).toEqual({ id: uid, username: 'b2buser', role: 'b2b' });
	});
});
