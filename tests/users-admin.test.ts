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

	it('addUser zapíše audit riadok (action=create) s aktorom a rolou v detail', () => {
		db.addUser('audituj-ma', 'tajneheslo', 'internal', 'zakladatel');
		const row = db.db
			.prepare(
				"SELECT actor, action, target_username, detail FROM user_audit WHERE target_username = 'audituj-ma'"
			)
			.get() as { actor: string; action: string; target_username: string; detail: string };
		expect(row).toEqual({
			actor: 'zakladatel',
			action: 'create',
			target_username: 'audituj-ma',
			detail: 'role=internal'
		});
	});
});

describe('role — voľba pri založení + zmena roly (#142)', () => {
	it('addUser vytvorí internal účet keď je rola zvolená explicitne', () => {
		expect(db.addUser('novy-interny', 'tajneheslo', 'internal')).toEqual({ error: null });
		expect(db.listUsers().find((x) => x.username === 'novy-interny')?.role).toBe('internal');
	});

	it('countInternalUsers počíta len internal (b2b sa neráta)', () => {
		const pred = db.countInternalUsers();
		db.addUser('pocitaj-b2b', 'tajneheslo', 'b2b');
		expect(db.countInternalUsers()).toBe(pred); // b2b nezvýši počet
		db.addUser('pocitaj-int', 'tajneheslo', 'internal');
		expect(db.countInternalUsers()).toBe(pred + 1);
	});

	it('changeUserRole zmení rolu a zapíše audit (role_change)', () => {
		db.addUser('rola-zmena', 'tajneheslo', 'b2b');
		const u = db.listUsers().find((x) => x.username === 'rola-zmena')!;
		const r = db.changeUserRole(u.id, 'internal', { id: 999999, username: 'sef' });
		expect(r).toEqual({ error: null });
		expect(db.listUsers().find((x) => x.id === u.id)?.role).toBe('internal');
		const audit = db.db
			.prepare(
				"SELECT actor, detail FROM user_audit WHERE target_username = 'rola-zmena' AND action = 'role_change'"
			)
			.get() as { actor: string; detail: string };
		expect(audit).toEqual({ actor: 'sef', detail: 'b2b→internal' });
	});

	it('changeUserRole odmietne zmenu VLASTNEJ roly (porovnáva id, nie username)', () => {
		db.addUser('vlastna-rola', 'tajneheslo', 'internal');
		const u = db.listUsers().find((x) => x.username === 'vlastna-rola')!;
		const r = db.changeUserRole(u.id, 'b2b', { id: u.id, username: u.username });
		expect(r.error).toMatch(/Vlastnú/);
		expect(db.listUsers().find((x) => x.id === u.id)?.role).toBe('internal'); // nezmenené
	});

	it('changeUserRole odmietne degradovať POSLEDNÉHO interného na B2B', () => {
		db.db
			.prepare(
				"INSERT INTO users (username, pass_hash, role) VALUES ('jediny-interny', 'x:y', 'internal')"
			)
			.run();
		// zmaž všetkých OSTATNÝCH interných nazbieraných predošlými testami v tomto
		// súbore (zdieľajú jednu DB v rámci modulu), nech je 'jediny-interny' naozaj
		// posledný — test overuje guard, nie počítanie z čistej DB.
		db.db
			.prepare("DELETE FROM users WHERE role = 'internal' AND username != 'jediny-interny'")
			.run();
		expect(db.countInternalUsers()).toBe(1);
		const posledny = db.listUsers().find((x) => x.username === 'jediny-interny')!;
		const r = db.changeUserRole(posledny.id, 'b2b', { id: 888888, username: 'iny-aktor' });
		expect(r.error).toMatch(/Posledný/);
		expect(db.listUsers().find((x) => x.id === posledny.id)?.role).toBe('internal');
	});

	it('changeUserRole na neexistujúci účet vráti chybu', () => {
		const r = db.changeUserRole(999999999, 'internal', { id: 1, username: 'x' });
		expect(r.error).toBeTruthy();
	});

	it('changeUserRole na rovnakú rolu je no-op — bez chyby, bez audit riadku', () => {
		db.addUser('noop-rola', 'tajneheslo', 'b2b');
		const u = db.listUsers().find((x) => x.username === 'noop-rola')!;
		const predAudit = (db.db.prepare('SELECT COUNT(*) c FROM user_audit').get() as { c: number }).c;
		const r = db.changeUserRole(u.id, 'b2b', { id: 999999, username: 'sef' });
		expect(r).toEqual({ error: null });
		const poAudit = (db.db.prepare('SELECT COUNT(*) c FROM user_audit').get() as { c: number }).c;
		expect(poAudit).toBe(predAudit); // žiadny nový riadok — nič sa nezmenilo
	});
});
