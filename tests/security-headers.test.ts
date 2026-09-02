// #251 SEC-3: appka sama nastavuje obranné response hlavičky (Caddy config je
// mimo repa → defense-in-depth). `handle` po resolve() pridá X-Frame-Options,
// X-Content-Type-Options, Referrer-Policy a minimálny Permissions-Policy —
// ale ZÁMERNE ŽIADNE CSP (three.js/inline štýly, riziko rozbitia — per ticket).
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// #5822: iframe povolenie je env-gated (`APP_FRAME_ANCESTORS`, čítané v handle za behu) —
// každý test si ho nastaví/zmaže; default (unset) = dnešné X-Frame-Options: DENY.
afterEach(() => {
	delete process.env.APP_FRAME_ANCESTORS;
});

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-sec-headers-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'headers.db');
process.env.MONEY_LIVE = '0';

const { handle } = await import('../src/hooks.server');

function fakeEvent(pathname: string) {
	return {
		url: new URL('http://localhost' + pathname),
		request: new Request('http://localhost' + pathname),
		cookies: { get: () => undefined },
		locals: {}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

const resolve = async () =>
	new Response('ok', { status: 200, headers: { 'content-type': 'text/html' } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callHandle = (pathname: string) => handle({ event: fakeEvent(pathname), resolve } as any);

describe('bezpečnostné hlavičky (SEC-3)', () => {
	it('handle nastaví obranné hlavičky na verejnej ceste (/health)', async () => {
		const res = await callHandle('/health');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		const pp = res.headers.get('permissions-policy') || '';
		expect(pp).toContain('camera=()');
		expect(pp).toContain('microphone=()');
		expect(pp).toContain('geolocation=()');
	});

	it('rovnaké hlavičky aj na /login', async () => {
		const res = await callHandle('/login');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('bez APP_FRAME_ANCESTORS (default): žiadne CSP + X-Frame-Options: DENY (dnešný stav)', async () => {
		const res = await callHandle('/login');
		expect(res.headers.get('content-security-policy')).toBeNull();
		expect(res.headers.get('x-frame-options')).toBe('DENY');
	});
});

// #5822: keď je APP_FRAME_ANCESTORS nastavené, iframe z Odoo je povolený cez CSP
// frame-ancestors a X-Frame-Options ZMIZNE (práve jedna z hlavičiek naraz).
describe('#5822 iframe povolenie cez APP_FRAME_ANCESTORS', () => {
	it('set → Content-Security-Policy: frame-ancestors <hodnota>, ŽIADNE X-Frame-Options', async () => {
		process.env.APP_FRAME_ANCESTORS = "'self' https://erp.montalu.cloud https://*.newlevel.media";
		// verejná cesta (/login) — neredirectuje, takže sa dostaneme k hlavičkám (rovnako ako
		// ostatné testy vyššie); frame-guard je aplikovaný na KAŽDÚ vyrenderovanú odpoveď.
		const res = await callHandle('/login');
		expect(res.headers.get('content-security-policy')).toBe(
			"frame-ancestors 'self' https://erp.montalu.cloud https://*.newlevel.media"
		);
		expect(res.headers.get('x-frame-options')).toBeNull();
		// ostatné obranné hlavičky ostávajú
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('prázdna/whitespace hodnota → naspäť X-Frame-Options: DENY (žiadne CSP)', async () => {
		process.env.APP_FRAME_ANCESTORS = '   ';
		const res = await callHandle('/login');
		expect(res.headers.get('x-frame-options')).toBe('DENY');
		expect(res.headers.get('content-security-policy')).toBeNull();
	});
});
