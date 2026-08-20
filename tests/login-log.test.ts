// #245: login/logout logovanie. Neúspešné prihlásenie MUSÍ vytvoriť WARN záznam
// (s dôvodom a IP, NIKDY heslom); úspešné INFO. Spy na process.stdout.write.
import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-login-log-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');

// import PRV (LOG_LEVEL neni nastavený ⇒ migrácie pri importe ticho); level až potom,
// aby login ok (INFO) / fail (WARN) / logout (INFO) prešli captureom.
const { login, logout } = await import('../src/lib/server/auth');
const { addUser } = await import('../src/lib/server/db');
process.env.LOG_LEVEL = 'info';
afterAll(() => delete process.env.LOG_LEVEL);

function capture(fn: () => void): Record<string, unknown>[] {
	const lines: string[] = [];
	const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
		lines.push(String(chunk));
		return true;
	}) as typeof process.stdout.write);
	try {
		fn();
	} finally {
		spy.mockRestore();
	}
	return lines
		.join('')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('login/logout logovanie', () => {
	beforeAll(() => {
		addUser('tester', 'spravne-heslo', 'internal');
	});
	afterEach(() => vi.restoreAllMocks());

	it('zlé heslo → WARN reason=bad_password, s IP, bez hesla', () => {
		const recs = capture(() => {
			const t = login('tester', 'zle-heslo', '9.9.9.9');
			expect(t).toBeNull();
		});
		const warn = recs.find((r) => r.msg === 'login zlyhal');
		expect(warn).toBeDefined();
		expect(warn!.level).toBe('warn');
		expect(warn!.reason).toBe('bad_password');
		expect(warn!.username).toBe('tester');
		expect(warn!.ip).toBe('9.9.9.9');
		// heslo sa NIKDY nesmie objaviť v logu
		expect(JSON.stringify(recs)).not.toContain('zle-heslo');
	});

	it('neznáme meno → WARN reason=unknown_user', () => {
		const recs = capture(() => login('niktoTaky', 'x', '1.1.1.1'));
		const warn = recs.find((r) => r.msg === 'login zlyhal');
		expect(warn!.reason).toBe('unknown_user');
		expect(warn!.username).toBe('niktoTaky');
	});

	it('správne heslo → INFO login ok + logout INFO', () => {
		let token: string | null = null;
		const okRecs = capture(() => {
			token = login('tester', 'spravne-heslo', '2.2.2.2');
		});
		expect(token).not.toBeNull();
		const ok = okRecs.find((r) => r.msg === 'login ok');
		expect(ok!.level).toBe('info');
		expect(ok!.username).toBe('tester');

		const outRecs = capture(() => logout(token!));
		const out = outRecs.find((r) => r.msg === 'logout');
		expect(out!.level).toBe('info');
		expect(out!.username).toBe('tester');
	});
});
