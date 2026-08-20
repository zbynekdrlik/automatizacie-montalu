// #251 SEC-3: appka sama nastavuje obranné response hlavičky (Caddy config je
// mimo repa → defense-in-depth). `handle` po resolve() pridá X-Frame-Options,
// X-Content-Type-Options, Referrer-Policy a minimálny Permissions-Policy —
// ale ZÁMERNE ŽIADNE CSP (three.js/inline štýly, riziko rozbitia — per ticket).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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

	it('ZÁMERNE bez Content-Security-Policy (per #251 — CSP riešené samostatne)', async () => {
		const res = await callHandle('/login');
		expect(res.headers.get('content-security-policy')).toBeNull();
	});
});
