import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-usersadmin-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'u.db');
const db = await import('../src/lib/server/db');

describe('user-admin helpery', () => {
	it('addUser vytvorí b2b, listUsers ho vráti, duplicitný meno chyba', () => {
		expect(db.addUser('velkoobchod1', 'tajneheslo', 'b2b')).toEqual({ error: null });
		const users = db.listUsers();
		const u = users.find((x) => x.username === 'velkoobchod1');
		expect(u?.role).toBe('b2b');
		expect(db.addUser('velkoobchod1', 'ine', 'b2b').error).toBeTruthy(); // duplicitný
		expect(db.addUser('  ', 'heslo', 'b2b').error).toBeTruthy(); // prázdny username
		expect(db.addUser('kratke', '123', 'b2b').error).toBeTruthy(); // heslo < 6
	});

	it('deleteB2BUser zmaže b2b, odmietne internal', () => {
		db.addUser('vo2', 'tajneheslo', 'b2b');
		const vo2 = db.listUsers().find((x) => x.username === 'vo2')!;
		expect(db.deleteB2BUser(vo2.id)).toEqual({ error: null });
		expect(db.listUsers().find((x) => x.username === 'vo2')).toBeUndefined();

		db.db
			.prepare(
				"INSERT INTO users (username, pass_hash, role) VALUES ('interny', 'x:y', 'internal')"
			)
			.run();
		const interny = db.listUsers().find((x) => x.username === 'interny')!;
		expect(db.deleteB2BUser(interny.id).error).toBeTruthy(); // nezmaže internal
		expect(db.listUsers().find((x) => x.username === 'interny')).toBeDefined();
	});
});
