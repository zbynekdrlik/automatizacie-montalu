// #5822: regresné uzamknutie base-path logiky v `hooks.server.ts` pri BAKOVANOM base
// (`APP_BASE_PATH=/automatizacie`) — doteraz len curl-proven, tu automatizované. `$app/paths`
// je framework modul (nie interný kód), takže jeho `vi.mock` na `base:'/automatizacie'` je
// legitímny — hoisted, takže predchádza module-scope `APP_BASE` zachyteniu v hooks. Overuje:
// auth brána redirect je base-prefixed + `next` base-LESS; verejné cesty pod base neredirectujú;
// b2b denylist funguje pod base (base-stripped appPath vs base-LESS konštanty) + loop-guard.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-hooks-base-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'hooks-base.db');
process.env.MONEY_LIVE = '0';

vi.mock('$app/paths', () => ({ base: '/automatizacie' }));

const { handle } = await import('../src/hooks.server');
const { addUser } = await import('../src/lib/server/db');
const { login, SESSION_COOKIE } = await import('../src/lib/server/auth');

// dôkaz, že `vi.mock` je aktívny — inak by celý súbor bežal proti base='' a falošne prešiel
const { base } = await import('$app/paths');

let b2bToken: string;
let internalToken: string;
beforeAll(() => {
	addUser('b2buser', 'heslo-1234', 'b2b', 'test');
	addUser('interny', 'heslo-1234', 'internal', 'test');
	b2bToken = login('b2buser', 'heslo-1234') ?? '';
	internalToken = login('interny', 'heslo-1234') ?? '';
});

function fakeEvent(pathname: string, search = '', token?: string) {
	return {
		url: new URL('http://localhost' + pathname + search),
		request: new Request('http://localhost' + pathname + search),
		cookies: { get: (n: string) => (n === SESSION_COOKIE ? token : undefined) },
		locals: {}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}
const okResolve = async () =>
	new Response('ok', { status: 200, headers: { 'content-type': 'text/html' } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (pathname: string, search = '', token?: string): Promise<any> =>
	// handle je async → vždy Promise; redirect() throw je REJECT (chytený v redirectOf).
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Promise.resolve(handle({ event: fakeEvent(pathname, search, token), resolve: okResolve } as any));

// zachytí throw z redirect() → {status, location}
async function redirectOf(p: string, s = '', token?: string) {
	try {
		await call(p, s, token);
		return null;
	} catch (e) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return { status: (e as any).status, location: (e as any).location };
	}
}

describe('#5822 hooks pod bakovaným base=/automatizacie', () => {
	it('vi.mock base je aktívny', () => {
		expect(base).toBe('/automatizacie');
	});

	it('neprihlásený /automatizacie/zasklenia?x=1 → 303 /automatizacie/login?next base-LESS', async () => {
		const r = await redirectOf('/automatizacie/zasklenia', '?x=1');
		expect(r?.status).toBe(303);
		expect(r?.location).toBe('/automatizacie/login?next=%2Fzasklenia%3Fx%3D1');
	});

	it('verejná /automatizacie/login neredirectuje (200 + hlavičky)', async () => {
		const res = await call('/automatizacie/login');
		expect(res.status).toBe(200);
		expect(res.headers.get('x-frame-options')).toBe('DENY'); // APP_FRAME_ANCESTORS unset
	});

	it('verejná /automatizacie/health neredirectuje', async () => {
		const res = await call('/automatizacie/health');
		expect(res.status).toBe(200);
	});

	it('b2b na /automatizacie/pergola → 303 /automatizacie/zasklenia (denylist pod base)', async () => {
		const r = await redirectOf('/automatizacie/pergola', '', b2bToken);
		expect(r?.status).toBe(303);
		expect(r?.location).toBe('/automatizacie/zasklenia');
	});

	it('b2b na /automatizacie/zasklenia NEredirectuje (loop-guard: appPath === target)', async () => {
		const res = await call('/automatizacie/zasklenia', '', b2bToken);
		expect(res.status).toBe(200);
	});

	it('interný na /automatizacie/zasklenia NEredirectuje (200)', async () => {
		const res = await call('/automatizacie/zasklenia', '', internalToken);
		expect(res.status).toBe(200);
	});
});
