// #5960 review 🟡-4: POST /ulozit-ponuku endpoint — same-origin (CSRF) gate, 401/403 auth vrstvy,
// error→status mapping, rotované session cookie, app-side deep-link (nie Odoo-echo). Volá `POST`
// handler priamo s fake RequestEvent (vzor tests/dopyt-pdf-endpoint-auth.test.ts). Odoo transport je
// mocknutý (`setCallKwTransport`) — žiadny reálny Odoo.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST } from '../src/routes/ulozit-ponuku/+server';
import { setCallKwTransport, type CallKwResponse } from '../src/lib/server/odoo-call-kw';
import type { SessionUser } from '../src/lib/server/auth';

type PostEvent = Parameters<typeof POST>[0];

const odooUser: SessionUser = {
	id: -7,
	username: 'marek@montalu.sk',
	role: 'internal',
	source: 'odoo'
};
const localUser: SessionUser = { id: 5, username: 'local', role: 'internal' };
const b2bUser: SessionUser = { id: 9, username: 'b2b', role: 'b2b' };
const SID = 'sess1234567890abcdef';
const ORIGIN = 'https://erp.montalu.cloud';
const VALID_BODY = { modul: 'zasklenia', lines: [{ kod: 'A', nazov: 'B', qty: 1, priceUnit: 10 }] };

interface EvOpts {
	origin?: string | null;
	secFetchSite?: string | null;
	body?: unknown;
	user?: SessionUser | null;
	sid?: string;
}
function makeEvent(o: EvOpts = {}) {
	const headers = new Headers({ 'content-type': 'application/json' });
	if (o.origin !== null) headers.set('origin', o.origin ?? ORIGIN);
	if (o.secFetchSite !== null) headers.set('sec-fetch-site', o.secFetchSite ?? 'same-origin');
	const request = new Request(`${ORIGIN}/automatizacie/ulozit-ponuku`, {
		method: 'POST',
		headers,
		body: JSON.stringify(o.body ?? VALID_BODY)
	});
	const url = new URL(request.url);
	const sid = 'sid' in o ? o.sid : SID;
	const setCookies: { name: string; value: string; opts: Record<string, unknown> }[] = [];
	const cookies = {
		get: (n: string) => (n === 'session_id' ? sid : undefined),
		set: (name: string, value: string, opts: Record<string, unknown>) =>
			setCookies.push({ name, value, opts })
	};
	const user = 'user' in o ? o.user : odooUser;
	const event = { request, url, locals: { user }, cookies } as unknown as PostEvent;
	return { event, setCookies };
}

function mockOk(result: Record<string, unknown>, setCookie: string[] = []): void {
	setCallKwTransport(async (): Promise<CallKwResponse> => ({
		status: 200,
		text: JSON.stringify({ jsonrpc: '2.0', result }),
		setCookie
	}));
}
function mockRpcErr(data: Record<string, unknown>, code = 200): void {
	setCallKwTransport(async (): Promise<CallKwResponse> => ({
		status: 200,
		text: JSON.stringify({ jsonrpc: '2.0', error: { code, message: 'x', data } }),
		setCookie: []
	}));
}

beforeEach(() => {
	process.env.ODOO_SSO_ENABLED = '1';
	process.env.ODOO_INTERNAL_URL = 'http://odoo-test:8069';
	process.env.ODOO_SSO_HOST = 'erp.montalu.cloud';
});
afterEach(() => {
	setCallKwTransport(null);
	delete process.env.ODOO_SSO_ENABLED;
	delete process.env.ODOO_INTERNAL_URL;
	delete process.env.ODOO_SSO_HOST;
});

describe('POST /ulozit-ponuku — same-origin (CSRF) gate', () => {
	it('žiadny Origin ani Sec-Fetch-Site → 403', async () => {
		const { event } = makeEvent({ origin: null, secFetchSite: null });
		await expect(POST(event)).rejects.toMatchObject({ status: 403 });
	});
	it('cross-origin Origin (bez Sec-Fetch-Site) → 403', async () => {
		const { event } = makeEvent({ origin: 'https://evil.example', secFetchSite: null });
		await expect(POST(event)).rejects.toMatchObject({ status: 403 });
	});
	it('Sec-Fetch-Site: same-site (nie same-origin) + cudzí Origin → 403', async () => {
		const { event } = makeEvent({ origin: 'https://evil.example', secFetchSite: 'same-site' });
		await expect(POST(event)).rejects.toMatchObject({ status: 403 });
	});
	it('same-origin (Sec-Fetch-Site) → prejde k uloženiu', async () => {
		mockOk({ id: 1, name: 'AUT1', created: true });
		const { event } = makeEvent({ secFetchSite: 'same-origin', origin: null });
		const res = await POST(event);
		expect(res.status).toBe(200);
	});
	it('Origin === naša origin (bez Sec-Fetch-Site) → prejde', async () => {
		mockOk({ id: 1, name: 'AUT1', created: true });
		const { event } = makeEvent({ origin: ORIGIN, secFetchSite: null });
		const res = await POST(event);
		expect(res.status).toBe(200);
	});
});

describe('POST /ulozit-ponuku — auth vrstvy', () => {
	it('neprihlásený (user=null) → 401', async () => {
		const { event } = makeEvent({ user: null });
		await expect(POST(event)).rejects.toMatchObject({ status: 401 });
	});
	it('b2b používateľ → 403', async () => {
		const { event } = makeEvent({ user: b2bUser });
		await expect(POST(event)).rejects.toMatchObject({ status: 403 });
	});
	it('lokálny (nie odoo) používateľ → 401 auth (early gate, telo sa neparsuje)', async () => {
		const { event } = makeEvent({ user: localUser });
		const res = await POST(event);
		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ ok: false, code: 'auth' });
	});
	it('odoo user bez session cookie → 401 auth', async () => {
		const { event } = makeEvent({ sid: undefined });
		const res = await POST(event);
		expect(res.status).toBe(401);
	});
});

describe('POST /ulozit-ponuku — úspech + cookie + deep-link', () => {
	it('úspech → 200 + app-side deep-link (nie Odoo-echo)', async () => {
		mockOk({ id: 42, name: 'AUT0042', created: true, url: 'https://ODOO-ECHO-WRONG/x' });
		const { event } = makeEvent();
		const res = await POST(event);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; name: string; url: string; created: boolean };
		expect(body).toMatchObject({ ok: true, name: 'AUT0042', created: true });
		expect(body.url).toBe('https://erp.montalu.cloud/odoo/sale.order/42'); // app-side, nie echo
	});
	it('rotované session_id z Odoo → cookies.set(session_id, NEW)', async () => {
		mockOk({ id: 1, name: 'AUT1', created: true }, ['session_id=NEWSID; HttpOnly']);
		const { event, setCookies } = makeEvent();
		await POST(event);
		expect(setCookies).toHaveLength(1);
		expect(setCookies[0]).toMatchObject({ name: 'session_id', value: 'NEWSID' });
		expect(setCookies[0]!.opts).toMatchObject({ httpOnly: true, path: '/' });
	});
	it('nezmenené session_id → cookie sa NEnastaví', async () => {
		mockOk({ id: 1, name: 'AUT1', created: true }, [`session_id=${SID}; HttpOnly`]);
		const { event, setCookies } = makeEvent();
		await POST(event);
		expect(setCookies).toHaveLength(0);
	});
});

describe('POST /ulozit-ponuku — error → status mapping', () => {
	it('UserError → 409 s doslovnou hláškou', async () => {
		mockRpcErr({ name: 'odoo.exceptions.UserError', message: 'Obsah sa zmenil.' });
		const res = await POST(makeEvent().event);
		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({ ok: false, code: 'odoo', error: 'Obsah sa zmenil.' });
	});
	it('session expirovaná (code 100) → 401 code session-expired', async () => {
		mockRpcErr({ name: 'odoo.http.SessionExpiredException' }, 100);
		const res = await POST(makeEvent().event);
		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ ok: false, code: 'session-expired' });
	});
	it('transport chyba (non-200) → 502', async () => {
		setCallKwTransport(async () => ({ status: 502, text: 'bad gw', setCookie: [] }));
		const res = await POST(makeEvent().event);
		expect(res.status).toBe(502);
		expect(await res.json()).toMatchObject({ ok: false, code: 'transport' });
	});
	it('neplatný vstup (nekladné qty) → 400', async () => {
		const { event } = makeEvent({
			body: { modul: 'z', lines: [{ kod: 'A', qty: 0, priceUnit: 1 }] }
		});
		const res = await POST(event);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ ok: false, code: 'input' });
	});
});
