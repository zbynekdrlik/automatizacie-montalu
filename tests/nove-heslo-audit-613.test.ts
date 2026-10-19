// #613 (druhá časť): zmena hesla administrátorom má TRVALÝ audit — `setPassword` zapíše riadok
// `user_audit` (action `password_reset`: admin, cieľový účet, čas — NIKDY heslo ani hash) v TEJ ISTEJ
// transakcii ako nový hash a zrušenie relácií. Dovtedy bol jediný záznam `auth` stdout log, ktorý
// každý redeploy zahodí. Zlyhanie zápisu auditu = nič sa nezmení (ani heslo, ani relácie).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { login, getSessionUser, setPassword } from '../src/lib/server/auth';
import { addUser, db } from '../src/lib/server/db';
import {
	recordFailure,
	lockoutRemainingMs,
	_resetThrottle,
	MAX_FAILURES
} from '../src/lib/server/login-throttle';

interface AuditRiadok {
	id: number;
	ts: string;
	actor: string;
	action: string;
	target_username: string;
	detail: string;
}

const auditPre = (ucet: string) =>
	db
		.prepare(
			"SELECT id, ts, actor, action, target_username, detail FROM user_audit WHERE action = 'password_reset' AND target_username = ? ORDER BY id"
		)
		.all(ucet) as AuditRiadok[];

const hashUctu = (ucet: string) =>
	(db.prepare('SELECT pass_hash FROM users WHERE username = ?').get(ucet) as { pass_hash: string })
		.pass_hash;

afterEach(() => vi.restoreAllMocks());

describe('setPassword zapíše trvalý audit do user_audit (#613 druhá časť)', () => {
	beforeEach(() => _resetThrottle());

	it('presne JEDEN riadok password_reset: admin, kanonické meno účtu, čas, prázdny detail', () => {
		addUser('audit-t1', 'stare-heslo-a1', 'internal');
		const pred = (db.prepare('SELECT COUNT(*) c FROM user_audit').get() as { c: number }).c;
		// admin napíše meno inou veľkosťou písmen a s medzerami — audit nesie meno z DB
		expect(setPassword('  Audit-T1 ', 'nove-heslo-a1', 'spravca').error).toBeNull();
		const po = (db.prepare('SELECT COUNT(*) c FROM user_audit').get() as { c: number }).c;
		expect(po - pred).toBe(1);
		const riadky = auditPre('audit-t1');
		expect(riadky).toHaveLength(1);
		expect(riadky[0]).toMatchObject({
			actor: 'spravca',
			action: 'password_reset',
			target_username: 'audit-t1',
			detail: ''
		});
		expect(riadky[0].ts).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
	});

	it('audit riadok NEOBSAHUJE heslo (nové ani staré) ani hash/soľ', () => {
		addUser('audit-t2', 'stare-heslo-a2', 'b2b');
		expect(setPassword('audit-t2', 'nove-heslo-a2-tajne', 'spravca').error).toBeNull();
		const riadok = JSON.stringify(auditPre('audit-t2'));
		const [salt, hash] = hashUctu('audit-t2').split(':');
		expect(riadok).not.toContain('nove-heslo-a2-tajne');
		expect(riadok).not.toContain('stare-heslo-a2');
		expect(riadok).not.toContain(salt);
		expect(riadok).not.toContain(hash);
	});

	it('každá zmena = vlastný riadok (dve zmeny → dva riadky); vlastný účet má actor = účet', () => {
		addUser('audit-t3', 'stare-heslo-a3', 'internal');
		expect(setPassword('audit-t3', 'nove-heslo-a3', 'spravca').error).toBeNull();
		expect(setPassword('audit-t3', 'nove-heslo-a3b', 'audit-t3').error).toBeNull();
		expect(auditPre('audit-t3').map((r) => r.actor)).toEqual(['spravca', 'audit-t3']);
	});

	it.each([
		['prázdne meno', '   ', 'heslo-dost-dlhe'],
		['slabé heslo', 'audit-t4', '12345'],
		['neznámy účet', 'nikto-taky-a4', 'heslo-dost-dlhe']
	])('zamietnutie (%s) audit NEZAPÍŠE', (_popis, meno, heslo) => {
		addUser('audit-t4', 'stare-heslo-a4', 'internal');
		const pred = db.prepare('SELECT COUNT(*) c FROM user_audit').get();
		expect(setPassword(meno, heslo, 'spravca').error).toBeTruthy();
		expect(db.prepare('SELECT COUNT(*) c FROM user_audit').get()).toEqual(pred);
	});

	it('zlyhanie zápisu auditu = rollback: heslo, relácie aj lockout ostanú, nič sa nezapíše', () => {
		addUser('audit-t5', 'stare-heslo-a5', 'internal');
		const hashPred = hashUctu('audit-t5');
		const token = login('audit-t5', 'stare-heslo-a5')!;
		for (let i = 0; i < MAX_FAILURES; i++) recordFailure('audit-t5', '87.244.229.96');
		expect(lockoutRemainingMs('audit-t5', '87.244.229.96')).toBeGreaterThan(0);
		// zápis auditu pre tento účet zlyhá (simulácia poruchy DB) — UPDATE hesla a DELETE relácií
		// prebehnú v transakcii PRED ním, takže ich musí vrátiť rollback
		db.exec(`
			CREATE TRIGGER t613_audit_zlyha BEFORE INSERT ON user_audit
			WHEN NEW.target_username = 'audit-t5'
			BEGIN SELECT RAISE(ABORT, 'audit zlyhal (test)'); END;
		`);
		try {
			expect(() => setPassword('audit-t5', 'nove-heslo-a5', 'spravca')).toThrow(/audit zlyhal/);
		} finally {
			db.exec('DROP TRIGGER t613_audit_zlyha');
		}
		expect(hashUctu('audit-t5')).toBe(hashPred);
		expect(getSessionUser(token)?.username).toBe('audit-t5');
		expect(auditPre('audit-t5')).toEqual([]);
		// lockout sa nevynuloval — heslo sa nezmenilo, nemá čo odomknúť
		expect(lockoutRemainingMs('audit-t5', '87.244.229.96')).toBeGreaterThan(0);
		expect(login('audit-t5', 'nove-heslo-a5')).toBeNull();
	});
});
