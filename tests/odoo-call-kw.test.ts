// #5960: PER-USER call_kw transport — request shape (URL/Host/Cookie/body, `Authorization` ABSENT),
// JSON-RPC obálka + klasifikácia chýb (code-100 re-login, UserError doslovne, generic → transport),
// Set-Cookie rotácia. Mock transport na HTTP hranici + jeden test cez DEFAULT `node:http` transport
// so skutočným lokálnym serverom (uzamyká Host + Cookie prítomné, Authorization neprítomné).
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';
import { type AddressInfo } from 'node:net';
import {
	createQuoteAsUser,
	callKwConfig,
	setCallKwTransport,
	QuoteAuthError,
	QuoteUserError,
	QuoteTransportError,
	type CallKwResponse,
	type OdooJson
} from '../src/lib/server/odoo-call-kw';

const SID = 'sess1234567890abcdef';

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

interface Captured {
	url: string;
	host: string;
	sid: string;
	body: { params?: { model?: string; method?: string; args?: unknown; kwargs?: unknown } };
}
function mockTransport(resp: CallKwResponse | (() => Promise<CallKwResponse>)): Captured[] {
	const calls: Captured[] = [];
	setCallKwTransport(async (url, host, sid, bodyJson) => {
		calls.push({ url, host, sid, body: JSON.parse(bodyJson) });
		return typeof resp === 'function' ? resp() : resp;
	});
	return calls;
}
const ok = (result: OdooJson, setCookie: string[] = []): CallKwResponse => ({
	status: 200,
	text: JSON.stringify({ jsonrpc: '2.0', id: 1, result }),
	setCookie
});
const rpcErr = (data: Record<string, unknown>, code = 200): CallKwResponse => ({
	status: 200,
	text: JSON.stringify({
		jsonrpc: '2.0',
		id: 1,
		error: { code, message: 'Odoo Server Error', data }
	}),
	setCookie: []
});

beforeEach(() => enableSso());
afterEach(() => {
	setCallKwTransport(null);
	disableSso();
});

describe('callKwConfig — env gating (zrkadlo SSO)', () => {
	it('null keď SSO vypnuté', () => {
		disableSso();
		expect(callKwConfig()).toBeNull();
	});
	it('config keď SSO zapnuté', () => {
		expect(callKwConfig()).toEqual({
			internalUrl: 'http://odoo-test:8069',
			host: 'erp.montalu.cloud'
		});
	});
});

describe('createQuoteAsUser — request shape', () => {
	it('POST na /web/dataset/call_kw/sale.order/create_quote_from_app, Host+sid, fixné model/method', async () => {
		const calls = mockTransport(ok({ id: 42, name: 'AUT0001', created: true }));
		const res = await createQuoteAsUser({ modul: 'zasklenia', quote_id: 'q1' }, SID);
		expect(calls).toHaveLength(1);
		const c = calls[0]!;
		expect(c.url).toBe(
			'http://odoo-test:8069/web/dataset/call_kw/sale.order/create_quote_from_app'
		);
		expect(c.host).toBe('erp.montalu.cloud');
		expect(c.sid).toBe(SID);
		expect(c.body.params?.model).toBe('sale.order');
		expect(c.body.params?.method).toBe('create_quote_from_app');
		expect(c.body.params?.args).toEqual([]);
		expect(c.body.params?.kwargs).toEqual({ modul: 'zasklenia', quote_id: 'q1' });
		expect(res).toEqual({
			id: 42,
			name: 'AUT0001',
			created: true,
			odooUrl: undefined,
			rotatedSid: undefined
		});
	});
	it('SSO vypnuté → QuoteAuthError bez transportu', async () => {
		disableSso();
		const calls = mockTransport(ok({ id: 1, name: 'X', created: true }));
		await expect(createQuoteAsUser({}, SID)).rejects.toBeInstanceOf(QuoteAuthError);
		expect(calls).toHaveLength(0);
	});
	it('created:false + Odoo url sa surface-ne', async () => {
		mockTransport(
			ok({ id: 7, name: 'AUT0007', created: false, url: 'https://x/odoo/sale.order/7' })
		);
		const res = await createQuoteAsUser({}, SID);
		expect(res.created).toBe(false);
		expect(res.odooUrl).toBe('https://x/odoo/sale.order/7');
	});
	it('rotované session_id z Set-Cookie sa vytiahne (iné cookie sa ignorujú)', async () => {
		mockTransport(
			ok({ id: 1, name: 'A', created: true }, [
				'frontend_lang=sk; Path=/',
				'session_id=NEW123; HttpOnly; Path=/'
			])
		);
		const res = await createQuoteAsUser({}, SID);
		expect(res.rotatedSid).toBe('NEW123');
	});
	it('žiadne session_id v Set-Cookie → rotatedSid undefined', async () => {
		mockTransport(ok({ id: 1, name: 'A', created: true }, ['frontend_lang=sk']));
		const res = await createQuoteAsUser({}, SID);
		expect(res.rotatedSid).toBeUndefined();
	});
	it('Max-Age rotovaného cookie sa zachová (persistencia)', async () => {
		mockTransport(
			ok({ id: 1, name: 'A', created: true }, ['session_id=NEW; Max-Age=604800; HttpOnly'])
		);
		const res = await createQuoteAsUser({}, SID);
		expect(res.rotatedSid).toBe('NEW');
		expect(res.rotatedMaxAge).toBe(604800);
	});
});

describe('createQuoteAsUser — klasifikácia chýb', () => {
	it('code 100 → QuoteAuthError so sessionExpired=true (živá session vypršala)', async () => {
		mockTransport(
			rpcErr({ name: 'odoo.http.SessionExpiredException', message: 'Session expired' }, 100)
		);
		const e = await createQuoteAsUser({}, SID).catch((x) => x);
		expect(e).toBeInstanceOf(QuoteAuthError);
		expect((e as QuoteAuthError).sessionExpired).toBe(true);
	});
	it('SSO vypnuté gate → QuoteAuthError so sessionExpired=false (žiaden reload nepomôže)', async () => {
		disableSso();
		const e = await createQuoteAsUser({}, SID).catch((x) => x);
		expect(e).toBeInstanceOf(QuoteAuthError);
		expect((e as QuoteAuthError).sessionExpired).toBe(false);
	});
	it('SessionExpiredException podľa name (aj bez code 100) → QuoteAuthError', async () => {
		mockTransport(rpcErr({ name: 'odoo.http.SessionExpiredException' }, 200));
		await expect(createQuoteAsUser({}, SID)).rejects.toBeInstanceOf(QuoteAuthError);
	});
	it('UserError → QuoteUserError s doslovnou data.message', async () => {
		mockTransport(
			rpcErr({
				name: 'odoo.exceptions.UserError',
				message: 'Objednávka AUT0007 už existuje a obsah sa zmenil.',
				debug: 'TRACEBACK secret path'
			})
		);
		await expect(createQuoteAsUser({}, SID)).rejects.toMatchObject({
			name: 'QuoteUserError',
			message: 'Objednávka AUT0007 už existuje a obsah sa zmenil.'
		});
	});
	it('ValidationError → QuoteUserError', async () => {
		mockTransport(rpcErr({ name: 'odoo.exceptions.ValidationError', message: 'Neplatné IČO.' }));
		const e = await createQuoteAsUser({}, SID).catch((x) => x);
		expect(e).toBeInstanceOf(QuoteUserError);
		expect((e as QuoteUserError).odooName).toContain('ValidationError');
	});
	it('AccessError → QuoteUserError (bearer nie je obchodník)', async () => {
		mockTransport(rpcErr({ name: 'odoo.exceptions.AccessError', message: 'Nemáte oprávnenie.' }));
		await expect(createQuoteAsUser({}, SID)).rejects.toBeInstanceOf(QuoteUserError);
	});
	it('prázdna data.message → fallback na arguments[0]', async () => {
		mockTransport(
			rpcErr({ name: 'odoo.exceptions.UserError', message: '', arguments: ['Z argumentu'] })
		);
		await expect(createQuoteAsUser({}, SID)).rejects.toMatchObject({ message: 'Z argumentu' });
	});
	it('generická Odoo chyba → QuoteTransportError (debug sa NEukáže)', async () => {
		mockTransport(rpcErr({ name: 'ZeroDivisionError', debug: 'File "server.py", line 42' }));
		const e = await createQuoteAsUser({}, SID).catch((x) => x);
		expect(e).toBeInstanceOf(QuoteTransportError);
		expect((e as Error).message).not.toContain('server.py');
	});
	it('non-200 → QuoteTransportError', async () => {
		mockTransport({ status: 502, text: '<html>Bad Gateway</html>', setCookie: [] });
		await expect(createQuoteAsUser({}, SID)).rejects.toBeInstanceOf(QuoteTransportError);
	});
	it('413 → QuoteTransportError s hláškou o veľkosti', async () => {
		mockTransport({ status: 413, text: '', setCookie: [] });
		await expect(createQuoteAsUser({}, SID)).rejects.toMatchObject({
			message: expect.stringContaining('veľké')
		});
	});
	it('neplatný JSON → QuoteTransportError', async () => {
		mockTransport({ status: 200, text: 'not json', setCookie: [] });
		await expect(createQuoteAsUser({}, SID)).rejects.toBeInstanceOf(QuoteTransportError);
	});
	it('prázdne telo 200 → QuoteTransportError', async () => {
		mockTransport({ status: 200, text: '', setCookie: [] });
		await expect(createQuoteAsUser({}, SID)).rejects.toBeInstanceOf(QuoteTransportError);
	});
	it('result bez id/name → QuoteTransportError', async () => {
		mockTransport(ok({ created: true }));
		await expect(createQuoteAsUser({}, SID)).rejects.toBeInstanceOf(QuoteTransportError);
	});
	it('result nie je objekt → QuoteTransportError', async () => {
		mockTransport(ok(false));
		await expect(createQuoteAsUser({}, SID)).rejects.toBeInstanceOf(QuoteTransportError);
	});
	it('transport hodí (sieť) → QuoteTransportError', async () => {
		setCallKwTransport(async () => {
			throw new Error('ECONNREFUSED');
		});
		await expect(createQuoteAsUser({}, SID)).rejects.toBeInstanceOf(QuoteTransportError);
	});
});

describe('DEFAULT node:http transport — uzamyká Host + Cookie prítomné, Authorization ABSENT', () => {
	it('forwardne session_id cookie + explicitný Host, žiadny Authorization/X-Forwarded-Host', async () => {
		let seen: Record<string, unknown> = {};
		const server = http.createServer((req, res) => {
			let body = '';
			req.on('data', (c) => (body += c));
			req.on('end', () => {
				const parsed = JSON.parse(body);
				seen = {
					host: req.headers.host,
					cookie: req.headers.cookie,
					auth: req.headers.authorization ?? null,
					xfh: req.headers['x-forwarded-host'] ?? null,
					model: parsed.params.model,
					method: parsed.params.method,
					kwargs: parsed.params.kwargs
				};
				res.setHeader('content-type', 'application/json');
				res.setHeader('set-cookie', 'session_id=ROT999; HttpOnly');
				res.end(
					JSON.stringify({ jsonrpc: '2.0', result: { id: 5, name: 'AUT0005', created: true } })
				);
			});
		});
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
		const port = (server.address() as AddressInfo).port;
		try {
			setCallKwTransport(null); // DEFAULT node:http
			process.env.ODOO_INTERNAL_URL = `http://127.0.0.1:${port}`;
			process.env.ODOO_SSO_HOST = 'erp.montalu.cloud';
			const res = await createQuoteAsUser({ modul: 'zasklenia', quote_id: 'q9' }, SID);
			expect(res.id).toBe(5);
			expect(res.rotatedSid).toBe('ROT999');
			expect(seen.host).toBe('erp.montalu.cloud'); // explicitný Host, nie 127.0.0.1
			expect(seen.cookie).toBe(`session_id=${SID}`);
			expect(seen.auth).toBeNull(); // NIKDY Authorization/bearer
			expect(seen.xfh).toBeNull(); // NIKDY X-Forwarded-Host
			expect(seen.model).toBe('sale.order');
			expect(seen.method).toBe('create_quote_from_app');
			expect(seen.kwargs).toEqual({ modul: 'zasklenia', quote_id: 'q9' });
		} finally {
			await new Promise<void>((r) => server.close(() => r()));
		}
	});
});
