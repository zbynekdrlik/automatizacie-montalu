// #5823: SSO resolver (`resolveOdooSso`) — gate, sid-regex, cache (hit/negatív/LRU/in-flight-dedup),
// evict, a DEFAULT transport (node:http) forwardne LEN `Cookie: session_id=<sid>` + konfigurovateľný
// `Host` (dbfilter-logout míľa). HTTP hranica je injektovateľná (`setSsoTransport`) — rovnaká
// disciplína ako `odoo-json2.ts`. env sa nastavuje za behu (ssoConfig číta lazy).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	resolveOdooSso,
	evictSsoCache,
	setSsoTransport,
	ssoConfig,
	ssoEnabled,
	_clearSsoCacheForTests,
	type SsoResponse
} from '../src/lib/server/odoo-sso';

const SID = 'sess1234567890abcdef'; // 20 znakov, matchne SID_RE

function enableSso(url = 'http://odoo-test:8069', host = 'erp.montalu.cloud') {
	process.env.ODOO_SSO_ENABLED = '1';
	process.env.ODOO_INTERNAL_URL = url;
	process.env.ODOO_SSO_HOST = host;
}
function disableSso() {
	delete process.env.ODOO_SSO_ENABLED;
	delete process.env.ODOO_INTERNAL_URL;
	delete process.env.ODOO_SSO_HOST;
}

/** Mock transport, ktorý zaznamená volania a vráti kanonickú odpoveď. */
function mockTransport(resp: SsoResponse | (() => Promise<SsoResponse>)) {
	const calls: { url: string; host: string; sid: string }[] = [];
	setSsoTransport(async (url, host, sid) => {
		calls.push({ url, host, sid });
		return typeof resp === 'function' ? resp() : resp;
	});
	return calls;
}
const ok = (result: unknown): SsoResponse => ({ status: 200, text: JSON.stringify({ result }) });

beforeEach(() => {
	_clearSsoCacheForTests();
	enableSso();
});
afterEach(() => {
	setSsoTransport(null);
	disableSso();
	_clearSsoCacheForTests();
});

describe('ssoConfig / ssoEnabled — env gating', () => {
	it('vypnuté keď ODOO_SSO_ENABLED != 1', () => {
		delete process.env.ODOO_SSO_ENABLED;
		expect(ssoConfig()).toBeNull();
		expect(ssoEnabled()).toBe(false);
	});
	it('vypnuté keď chýba ODOO_INTERNAL_URL', () => {
		process.env.ODOO_SSO_ENABLED = '1';
		delete process.env.ODOO_INTERNAL_URL;
		expect(ssoConfig()).toBeNull();
	});
	it('zapnuté + default host keď ODOO_SSO_HOST chýba', () => {
		process.env.ODOO_SSO_ENABLED = '1';
		process.env.ODOO_INTERNAL_URL = 'http://odoo:8069';
		delete process.env.ODOO_SSO_HOST;
		expect(ssoConfig()).toEqual({ internalUrl: 'http://odoo:8069', host: 'erp.montalu.cloud' });
	});
});

describe('resolveOdooSso — acceptance gate', () => {
	it('platná interná session → efemérna identita {id:-uid, username, role:internal, source:odoo}', async () => {
		const calls = mockTransport(
			ok({ uid: 7, is_internal_user: true, username: 'marek@montalu.sk' })
		);
		const u = await resolveOdooSso(SID);
		expect(u).toEqual({ id: -7, username: 'marek@montalu.sk', role: 'internal', source: 'odoo' });
		expect(calls).toHaveLength(1);
		const c0 = calls[0]!;
		expect(c0.url).toBe('http://odoo-test:8069/web/session/get_session_info');
		expect(c0.host).toBe('erp.montalu.cloud');
		expect(c0.sid).toBe(SID);
	});
	it('expirovaná session (HTTP 200 + JSON-RPC error) → null (NORMÁLNA cesta)', async () => {
		mockTransport({
			status: 200,
			text: JSON.stringify({ error: { code: 100, message: 'Session expired' } })
		});
		expect(await resolveOdooSso(SID)).toBeNull();
	});
	it('portál / verejný Odoo používateľ (is_internal_user=false) → null', async () => {
		mockTransport(ok({ uid: 9, is_internal_user: false, username: 'portal@x.sk' }));
		expect(await resolveOdooSso(SID)).toBeNull();
	});
	it('uid falsy/0/nekladné → null', async () => {
		mockTransport(ok({ uid: 0, is_internal_user: true, username: 'x' }));
		expect(await resolveOdooSso(SID)).toBeNull();
		_clearSsoCacheForTests();
		mockTransport(ok({ uid: false, is_internal_user: true, username: 'x' }));
		expect(await resolveOdooSso(SID)).toBeNull();
	});
	it('prázdny/nestringový username → null', async () => {
		mockTransport(ok({ uid: 3, is_internal_user: true, username: '' }));
		expect(await resolveOdooSso(SID)).toBeNull();
	});
	it('non-200 → null', async () => {
		mockTransport({ status: 500, text: 'boom' });
		expect(await resolveOdooSso(SID)).toBeNull();
	});
	it('neplatný JSON v 200 odpovedi → null', async () => {
		mockTransport({ status: 200, text: '<html>proxy</html>' });
		expect(await resolveOdooSso(SID)).toBeNull();
	});
	it('transport hodí (timeout/sieť) → null (NIKDY nehádže)', async () => {
		mockTransport(async () => {
			throw new Error('sso timeout');
		});
		await expect(resolveOdooSso(SID)).resolves.toBeNull();
	});
});

describe('resolveOdooSso — vstupná/gate hygiena (žiadny Odoo call)', () => {
	it('SSO vypnuté → null, transport sa NEvolá', async () => {
		disableSso();
		const calls = mockTransport(ok({ uid: 1, is_internal_user: true, username: 'x' }));
		expect(await resolveOdooSso(SID)).toBeNull();
		expect(calls).toHaveLength(0);
	});
	it('chýbajúca cookie → null, transport sa NEvolá', async () => {
		const calls = mockTransport(ok({ uid: 1, is_internal_user: true, username: 'x' }));
		expect(await resolveOdooSso(undefined)).toBeNull();
		expect(calls).toHaveLength(0);
	});
	it('malformed sid (krátky / zlé znaky) → null, transport sa NEvolá', async () => {
		const calls = mockTransport(ok({ uid: 1, is_internal_user: true, username: 'x' }));
		expect(await resolveOdooSso('short')).toBeNull();
		expect(await resolveOdooSso('has spaces!!!!!!!!!!!')).toBeNull();
		expect(await resolveOdooSso('a'.repeat(200))).toBeNull();
		expect(calls).toHaveLength(0);
	});
});

describe('resolveOdooSso — cache', () => {
	it('pozitívny hit: druhé volanie NEudrie Odoo', async () => {
		const calls = mockTransport(ok({ uid: 7, is_internal_user: true, username: 'marek' }));
		await resolveOdooSso(SID);
		await resolveOdooSso(SID);
		expect(calls).toHaveLength(1);
	});
	it('negatívny hit: opakovaná expirovaná session sa cachne (nehameruje Odoo)', async () => {
		const calls = mockTransport({
			status: 200,
			text: JSON.stringify({ error: { message: 'exp' } })
		});
		expect(await resolveOdooSso(SID)).toBeNull();
		expect(await resolveOdooSso(SID)).toBeNull();
		expect(calls).toHaveLength(1);
	});
	it('in-flight dedup: dva súbežné resolvy → JEDEN transport call', async () => {
		let resolveFn: (r: SsoResponse) => void = () => {};
		const gate = new Promise<SsoResponse>((res) => (resolveFn = res));
		const calls = mockTransport(() => gate);
		const p1 = resolveOdooSso(SID);
		const p2 = resolveOdooSso(SID);
		resolveFn(ok({ uid: 7, is_internal_user: true, username: 'marek' }));
		const [u1, u2] = await Promise.all([p1, p2]);
		expect(u1).toEqual(u2);
		expect(calls).toHaveLength(1);
	});
	it('evictSsoCache: po evikte sa znova udrie Odoo', async () => {
		const calls = mockTransport(ok({ uid: 7, is_internal_user: true, username: 'marek' }));
		await resolveOdooSso(SID);
		evictSsoCache(SID);
		await resolveOdooSso(SID);
		expect(calls).toHaveLength(2);
	});
	it('LRU strop: najstarší vstup sa evikuje po prekročení ~500', async () => {
		const calls = mockTransport(ok({ uid: 7, is_internal_user: true, username: 'u' }));
		const first = 'sidfirst000000000000';
		await resolveOdooSso(first); // vstup #1
		for (let i = 0; i < 505; i++) await resolveOdooSso(`sidfill${String(i).padStart(13, '0')}`);
		const last = 'sidfill0000000000504';
		const before = calls.length;
		await resolveOdooSso(last); // stále v cache → žiadny nový call
		expect(calls.length).toBe(before);
		await resolveOdooSso(first); // evikovaný → nový call
		expect(calls.length).toBe(before + 1);
	});
});

describe('DEFAULT transport (node:http) — forwardne LEN session_id + konfigurovaný Host', () => {
	it('probe request nesie Host=<ODOO_SSO_HOST> a Cookie=session_id=<sid> (žiadny am_session)', async () => {
		const seen: { host?: string; cookie?: string; url?: string; body?: string } = {};
		const server = http.createServer((req, res) => {
			seen.host = req.headers.host;
			seen.cookie = req.headers.cookie;
			seen.url = req.url;
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				seen.body = body;
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ result: { uid: 42, is_internal_user: true, username: 'marek' } }));
			});
		});
		await new Promise<void>((r) => server.listen(0, r));
		const port = (server.address() as AddressInfo).port;
		try {
			setSsoTransport(null); // reálny node:http default transport
			enableSso(`http://127.0.0.1:${port}`, 'erp.montalu.cloud');
			const u = await resolveOdooSso(SID);
			expect(u).toEqual({ id: -42, username: 'marek', role: 'internal', source: 'odoo' });
			expect(seen.host).toBe('erp.montalu.cloud'); // dbfilter-logout míľa
			expect(seen.cookie).toBe(`session_id=${SID}`); // LEN session_id, žiadny am_session
			expect(seen.url).toBe('/web/session/get_session_info');
			expect(seen.body).toBe(JSON.stringify({ jsonrpc: '2.0', method: 'call', params: {} }));
		} finally {
			server.close();
		}
	});
});

// dôkaz že mock je aktívny (inak by testy bežali proti reálnemu node:http a padli/viseli)
it('sanity: setSsoTransport mock je aktívny', async () => {
	const calls = mockTransport(ok({ uid: 1, is_internal_user: true, username: 'x' }));
	await resolveOdooSso(SID);
	expect(calls).toHaveLength(1);
	vi.clearAllMocks();
});
