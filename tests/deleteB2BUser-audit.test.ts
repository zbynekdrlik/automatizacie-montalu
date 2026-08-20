// deleteB2BUser MUSÍ zapísať user_audit riadok (actor, action='delete', target) —
// dohľadateľnosť „kto koho zmazal", rovnako ako addUser/changeUserRole (#246, LOG-9).
// Fresh DB → migrate() 0 → v24 (seedUsers no-op, SEED_USERS prázdny), potom cez verejné
// API založíme b2b účet a zmažeme ho, over že vznikol práve jeden 'delete' audit riadok
// a že mazanie + audit sú atomické (jedna transakcia).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-del-audit-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'fresh.db');

const { addUser, deleteB2BUser, listUsers, db } = await import('../src/lib/server/db');

describe('deleteB2BUser — audit trail (#246)', () => {
	it("zmazanie b2b účtu zapíše práve jeden 'delete' audit riadok (actor, target)", () => {
		expect(addUser('obchod@x', 'heslo123', 'b2b', 'boss').error).toBeNull();
		const u = listUsers().find((x) => x.username === 'obchod@x')!;
		expect(u).toBeDefined();

		const res = deleteB2BUser(u.id, 'boss');
		expect(res.error).toBeNull();

		const audit = db
			.prepare(
				"SELECT actor, action, target_username FROM user_audit WHERE action = 'delete'"
			)
			.all();
		expect(audit).toEqual([{ actor: 'boss', action: 'delete', target_username: 'obchod@x' }]);

		// účet je naozaj preč
		expect(listUsers().find((x) => x.username === 'obchod@x')).toBeUndefined();
	});

	it('neexistujúce id → chyba, žiadny audit riadok navyše', () => {
		const before = (
			db.prepare("SELECT COUNT(*) c FROM user_audit WHERE action = 'delete'").get() as {
				c: number;
			}
		).c;
		const res = deleteB2BUser(999999, 'boss');
		expect(res.error).not.toBeNull();
		const after = (
			db.prepare("SELECT COUNT(*) c FROM user_audit WHERE action = 'delete'").get() as {
				c: number;
			}
		).c;
		expect(after).toBe(before);
	});

	it('interný účet sa nezmaže a nezapíše audit', () => {
		expect(addUser('admin@x', 'heslo123', 'internal', 'boss').error).toBeNull();
		const u = listUsers().find((x) => x.username === 'admin@x')!;
		const res = deleteB2BUser(u.id, 'boss');
		expect(res.error).not.toBeNull();
		expect(listUsers().find((x) => x.username === 'admin@x')).toBeDefined();
	});
});
