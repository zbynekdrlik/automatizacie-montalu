// #5823: SSO cez Odoo session v `hooks.server.ts` `handle` — integračný test. Overuje SSO-first
// precedenciu, env-gating (vypnuté ⇒ byte-identické s dneškom, SSO sa NEvolá), a fallback na lokálnu
// session pri neplatnej/vypadnutej Odoo session. Odoo HTTP hranica je mocknutá (`setSsoTransport`),
// `$app/paths` mock (base='') je legitímny (framework modul). Vzor `hooks-base-path.test.ts`.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { SsoResponse } from '../src/lib/server/odoo-sso';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-hooks-sso-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'hooks-sso.db');
process.env.MONEY_LIVE = '0';

vi.mock('$app/paths', () => ({ base: '' }));

const { handle } = await import('../src/hooks.server');
const { addUser } = await import('../src/lib/server/db');
const { login, SESSION_COOKIE } = await import('../src/lib/server/auth');
const { setSsoTransport, ODOO_SESSION_COOKIE, _clearSsoCacheForTests } =
	await import('../src/lib/server/odoo-sso');

const SID = 'sess1234567890abcdef';

let internalToken: string;
let b2bToken: string;
beforeAll(() => {
	addUser('lokalny', 'heslo-1234', 'internal', 'test');
	addUser('b2buser', 'heslo-1234', 'b2b', 'test');
	internalToken = login('lokalny', 'heslo-1234') ?? '';
	b2bToken = login('b2buser', 'heslo-1234') ?? '';
});

function enableSso() {
	process.env.ODOO_SSO_ENABLED = '1';
	process.env.ODOO_INTERNAL_URL = 'http://odoo-test:8069';
	process.env.ODOO_SSO_HOST = 'erp.montalu.cloud';
}
function disableSso() {
	delete process.env.ODOO_SSO_ENABLED;
	delete process.env.ODOO_INTERNAL_URL;
	delete process.env.ODOO_SSO_HOST;
}
function mock(resp: SsoResponse) {
	const calls: string[] = [];
	setSsoTransport(async (_url, _host, sid) => {
		calls.push(sid);
		return resp;
	});
	return calls;
}
const okInternal = (uid: number, username: string): SsoResponse => ({
	status: 200,
	text: JSON.stringify({ result: { uid, is_internal_user: true, username } })
});

beforeEach(() => {
	_clearSsoCacheForTests();
	enableSso();
});
afterEach(() => {
	setSsoTransport(null);
	disableSso();
	_clearSsoCacheForTests();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeEvent(pathname: string, cookies: { am?: string; sid?: string }): any {
	return {
		url: new URL('http://localhost' + pathname),
		request: new Request('http://localhost' + pathname),
		cookies: {
			get: (n: string) =>
				n === SESSION_COOKIE ? cookies.am : n === ODOO_SESSION_COOKIE ? cookies.sid : undefined
		},
		locals: {}
	};
}
const okResolve = async () =>
	new Response('ok', { status: 200, headers: { 'content-type': 'text/html' } });

/** Spustí handle na (public) `/health` (žiadny auth redirect) a vráti výsledné `locals.user`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function userAfterHandle(cookies: { am?: string; sid?: string }): Promise<any> {
	const event = fakeEvent('/health', cookies);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	await handle({ event, resolve: okResolve } as any);
	return event.locals.user;
}

describe('handle — SSO cez Odoo session', () => {
	it('SSO-first: platná Odoo session → efemérna Odoo identita (source=odoo), aj popri am_session', async () => {
		const calls = mock(okInternal(7, 'marek@montalu.sk'));
		const user = await userAfterHandle({ am: internalToken, sid: SID });
		expect(user).toEqual({
			id: -7,
			username: 'marek@montalu.sk',
			role: 'internal',
			source: 'odoo'
		});
		expect(calls).toEqual([SID]); // Odoo overená
	});

	it('fallback: neplatná/vypadnutá Odoo session → lokálna am_session identita', async () => {
		mock({ status: 200, text: JSON.stringify({ error: { message: 'expired' } }) });
		const user = await userAfterHandle({ am: internalToken, sid: SID });
		expect(user).toMatchObject({ username: 'lokalny', role: 'internal' });
		expect(user.source).toBeUndefined(); // lokálna identita, nie SSO
	});

	it('žiadna Odoo cookie → lokálny login nedotknutý (SSO sa NEvolá)', async () => {
		const calls = mock(okInternal(7, 'x'));
		const user = await userAfterHandle({ am: internalToken });
		expect(user).toMatchObject({ username: 'lokalny', role: 'internal' });
		expect(user.source).toBeUndefined();
		expect(calls).toHaveLength(0);
	});

	it('b2b lokálny login nedotknutý pri SSO zapnutom (bez Odoo cookie)', async () => {
		const user = await userAfterHandle({ am: b2bToken });
		expect(user).toMatchObject({ username: 'b2buser', role: 'b2b' });
	});

	it('ENV-GATE: SSO vypnuté + session_id cookie → SSO sa NEvolá, len lokálna identita (byte-identické)', async () => {
		disableSso();
		const calls = mock(okInternal(7, 'x'));
		const user = await userAfterHandle({ am: internalToken, sid: SID });
		expect(user).toMatchObject({ username: 'lokalny', role: 'internal' });
		expect(user.source).toBeUndefined();
		expect(calls).toHaveLength(0); // SSO cesta sa vôbec nevykonala
	});

	it('neautentikovaný (SSO zlyhá, žiadna am_session) → locals.user null', async () => {
		mock({ status: 500, text: 'boom' });
		const user = await userAfterHandle({ sid: SID });
		expect(user).toBeNull();
	});
});
