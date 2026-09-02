// #5824: `/json/2` bearer klient — request shape (URL/body/hlavička), error mapping (4xx/5xx),
// return handling. Mock transport na HTTP hranici (žiadny reálny Odoo). Plus jeden test cez
// DEFAULT transport so stubnutým `fetch`, ktorý uzamyká `Authorization: bearer <key>` hlavičku.
import { describe, it, expect, afterEach } from 'vitest';
import {
	odooJson2,
	json2Config,
	setJson2Transport,
	OdooJson2Error,
	type Json2Config,
	type Json2Response
} from '../src/lib/server/odoo-json2';

const CFG: Json2Config = { url: 'https://erp.example.test/', apiKey: 'the-key' };

interface Captured {
	url: string;
	body: unknown;
	apiKey: string;
}

/** Nastaví mock transport, ktorý zaloguje volanie a vráti dané `resp`. */
function mockTransport(resp: Json2Response): Captured[] {
	const calls: Captured[] = [];
	setJson2Transport(async (url, bodyJson, apiKey) => {
		calls.push({ url, body: JSON.parse(bodyJson), apiKey });
		return resp;
	});
	return calls;
}

afterEach(() => {
	setJson2Transport(null);
	delete process.env.ODOO_URL;
	delete process.env.ODOO_API_KEY;
});

describe('#5824 odooJson2 — request shape', () => {
	it('POST na /json/2/<model>/<method>, trailing slash z url sa oreže, apiKey ide do transportu', async () => {
		const calls = mockTransport({ status: 200, text: '42' });
		const res = await odooJson2(CFG, 'crm.lead', 'create', { vals_list: [{ name: 'x' }] });
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toBe('https://erp.example.test/json/2/crm.lead/create');
		expect(calls[0]!.apiKey).toBe('the-key');
		expect(calls[0]!.body).toEqual({ vals_list: [{ name: 'x' }] });
		expect(res).toBe(42); // priamo return value, žiadna {result} obálka
	});

	it('search: domain + limit v tele, vráti pole idčiek', async () => {
		const calls = mockTransport({ status: 200, text: '[1,2,3]' });
		const res = await odooJson2(CFG, 'sale.order', 'search', {
			domain: [['name', '=', 'OP1']],
			limit: 10
		});
		expect(calls[0]!.body).toEqual({ domain: [['name', '=', 'OP1']], limit: 10 });
		expect(res).toEqual([1, 2, 3]);
	});

	it('message_post: ids + pomenované kwargs v tele', async () => {
		const calls = mockTransport({ status: 200, text: 'true' });
		await odooJson2(CFG, 'sale.order', 'message_post', {
			ids: [5],
			body: '<p>x</p>',
			subtype_xmlid: 'mail.mt_note',
			message_type: 'comment',
			partner_ids: []
		});
		expect(calls[0]!.body).toEqual({
			ids: [5],
			body: '<p>x</p>',
			subtype_xmlid: 'mail.mt_note',
			message_type: 'comment',
			partner_ids: []
		});
	});

	it('prázdna 200 odpoveď → null', async () => {
		mockTransport({ status: 200, text: '' });
		expect(await odooJson2(CFG, 'x', 'y', {})).toBeNull();
	});
});

describe('#5824 odooJson2 — error mapping', () => {
	it('4xx s Odoo JSON error → OdooJson2Error s name + message', async () => {
		mockTransport({
			status: 403,
			text: JSON.stringify({ name: 'odoo.exceptions.AccessError', message: 'denied' })
		});
		await expect(odooJson2(CFG, 'crm.lead', 'create', {})).rejects.toMatchObject({
			name: 'OdooJson2Error',
			odooName: 'odoo.exceptions.AccessError'
		});
		await expect(odooJson2(CFG, 'crm.lead', 'create', {})).rejects.toThrow(/denied/);
	});

	it('5xx bez JSON tela → OdooJson2Error so surovým textom', async () => {
		mockTransport({ status: 500, text: 'Internal Server Error' });
		await expect(odooJson2(CFG, 'x', 'y', {})).rejects.toThrow(/Internal Server Error/);
	});

	it('OdooJson2Error je Error inštancia (retry vrstva ju chytí)', async () => {
		mockTransport({ status: 500, text: 'boom' });
		const e = await odooJson2(CFG, 'x', 'y', {}).catch((err) => err);
		expect(e).toBeInstanceOf(OdooJson2Error);
		expect(e).toBeInstanceOf(Error);
	});
});

describe('#5824 json2Config — env gate', () => {
	it('ODOO_URL + ODOO_API_KEY → config', () => {
		process.env.ODOO_URL = 'https://a';
		process.env.ODOO_API_KEY = 'k';
		expect(json2Config()).toEqual({ url: 'https://a', apiKey: 'k' });
	});
	it('chýba ktorákoľvek → null (json2 vypnuté → fallback XML-RPC)', () => {
		process.env.ODOO_URL = 'https://a';
		expect(json2Config()).toBeNull();
		delete process.env.ODOO_URL;
		process.env.ODOO_API_KEY = 'k';
		expect(json2Config()).toBeNull();
	});
});

describe('#5824 default transport — Authorization: bearer', () => {
	it('stubnutý fetch dostane bearer hlavičku + POST + JSON telo', async () => {
		setJson2Transport(null); // default transport (fetch)
		const orig = globalThis.fetch;
		let captured: { url: string; init: RequestInit } | null = null;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		globalThis.fetch = (async (url: any, init: any) => {
			captured = { url: String(url), init };
			return new Response('7', { status: 200 });
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		}) as any;
		try {
			const res = await odooJson2(CFG, 'crm.lead', 'create', { vals_list: [{}] });
			expect(res).toBe(7);
			expect(captured!.url).toBe('https://erp.example.test/json/2/crm.lead/create');
			expect(captured!.init.method).toBe('POST');
			const headers = captured!.init.headers as Record<string, string>;
			expect(headers.Authorization).toBe('bearer the-key');
			expect(headers['Content-Type']).toMatch(/application\/json/);
		} finally {
			globalThis.fetch = orig;
		}
	});
});

describe('#5824 review W1 — C0 control-char scrub (#278 poison-pill parita)', () => {
	it('NUL/C0 znaky v string hodnotách tela sa vyčistia PRED odoslaním (tab ostáva)', async () => {
		const calls = mockTransport({ status: 200, text: '1' });
		const nul = String.fromCharCode(0);
		const bel = String.fromCharCode(7);
		const tab = String.fromCharCode(9);
		await odooJson2(CFG, 'crm.lead', 'create', {
			vals_list: [{ name: `J${nul}a${bel}n`, email_from: 'a@b', keep: `x${tab}y` }]
		});
		expect(calls[0]!.body).toEqual({
			vals_list: [{ name: 'Jan', email_from: 'a@b', keep: `x${tab}y` }]
		});
	});
});

describe('#5824 review S1 — error/parse robustnosť', () => {
	it('prázdny Odoo message → fallback na debug', async () => {
		mockTransport({
			status: 500,
			text: JSON.stringify({
				name: 'odoo.exceptions.ValidationError',
				message: '',
				debug: 'real trace here'
			})
		});
		await expect(odooJson2(CFG, 'crm.lead', 'create', {})).rejects.toThrow(/real trace here/);
	});
	it('200 s ne-JSON telom (proxy HTML) → OdooJson2Error, nie holý SyntaxError', async () => {
		mockTransport({ status: 200, text: '<html>502 bad gateway</html>' });
		const e = await odooJson2(CFG, 'x', 'y', {}).catch((err) => err);
		expect(e).toBeInstanceOf(OdooJson2Error);
		expect(String(e)).toMatch(/neplatný JSON/);
	});
});
