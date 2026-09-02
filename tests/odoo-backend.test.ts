// #5824: backend seam — env-gated výber json2 vs XML-RPC fallback, správne smerovanie operácií,
// lazy uid v XML-RPC backende. Oba transporty mockované na HTTP hranici.
import { describe, it, expect, afterEach } from 'vitest';
import { odooBackend, odooBackendConfigured } from '../src/lib/server/odoo-backend';
import { setJson2Transport, type Json2Response } from '../src/lib/server/odoo-json2';
import { setOdooTransport } from '../src/lib/server/odoo-rpc';

function setJson2Env() {
	process.env.ODOO_URL = 'https://json2.test';
	process.env.ODOO_API_KEY = 'k';
	delete process.env.ODOO_LEAD_URL;
	delete process.env.ODOO_LEAD_DB;
	delete process.env.ODOO_LEAD_LOGIN;
	delete process.env.ODOO_LEAD_API_KEY;
}
function setXmlrpcEnv() {
	delete process.env.ODOO_URL;
	delete process.env.ODOO_API_KEY;
	process.env.ODOO_LEAD_URL = 'https://xmlrpc.test';
	process.env.ODOO_LEAD_DB = 'odoo';
	process.env.ODOO_LEAD_LOGIN = 'web';
	process.env.ODOO_LEAD_API_KEY = 'legacy';
}

interface J2Call {
	url: string;
	body: Record<string, unknown>;
}
function mockJson2(resp: Json2Response): J2Call[] {
	const calls: J2Call[] = [];
	setJson2Transport(async (url, bodyJson) => {
		calls.push({ url, body: JSON.parse(bodyJson) });
		return resp;
	});
	return calls;
}
const xmlResp = (inner: string) =>
	`<?xml version="1.0"?><methodResponse><params><param><value>${inner}</value></param></params></methodResponse>`;

afterEach(() => {
	setJson2Transport(null);
	setOdooTransport(null);
	for (const k of [
		'ODOO_URL',
		'ODOO_API_KEY',
		'ODOO_LEAD_URL',
		'ODOO_LEAD_DB',
		'ODOO_LEAD_LOGIN',
		'ODOO_LEAD_API_KEY'
	])
		delete process.env[k];
});

describe('#5824 selektor', () => {
	it('ODOO_URL+ODOO_API_KEY → json2 backend (operácia ide cez json2 transport)', async () => {
		setJson2Env();
		const calls = mockJson2({ status: 200, text: '99' });
		expect(odooBackendConfigured()).toBe(true);
		const be = odooBackend();
		expect(be).not.toBeNull();
		const id = await be!.create('crm.lead', { name: 'x' });
		expect(id).toBe(99);
		expect(calls[0]!.url).toBe('https://json2.test/json/2/crm.lead/create');
		expect(calls[0]!.body).toEqual({ vals_list: [{ name: 'x' }] });
	});

	it('len ODOO_LEAD_* → XML-RPC fallback (operácia ide cez xmlrpc transport)', async () => {
		setXmlrpcEnv();
		let created = 0;
		setOdooTransport(async (_url, xml) => {
			if (xml.includes('<methodName>authenticate</methodName>')) return xmlResp('<int>7</int>');
			created++;
			return xmlResp('<int>555</int>');
		});
		expect(odooBackendConfigured()).toBe(true);
		const be = odooBackend();
		const id = await be!.create('crm.lead', { name: 'x' });
		expect(id).toBe(555);
		expect(created).toBe(1);
	});

	it('žiadny env → null (integrácia vypnutá)', () => {
		expect(odooBackendConfigured()).toBe(false);
		expect(odooBackend()).toBeNull();
	});
});

describe('#5824 Json2Backend operácie', () => {
	it('search: domain + limit; message_post: ids + kwargs', async () => {
		setJson2Env();
		const searchCalls = mockJson2({ status: 200, text: '[11,22]' });
		const be = odooBackend()!;
		const ids = await be.search('sale.order', [['name', '=', 'OP1']], 10);
		expect(ids).toEqual([11, 22]);
		expect(searchCalls[0]!.body).toEqual({ domain: [['name', '=', 'OP1']], limit: 10 });

		const postCalls = mockJson2({ status: 200, text: 'true' });
		await be.messagePost('sale.order', 22, {
			body: '<p>h</p>',
			subtype_xmlid: 'mail.mt_note',
			message_type: 'comment',
			partner_ids: []
		});
		expect(postCalls[0]!.body).toEqual({
			ids: [22],
			body: '<p>h</p>',
			subtype_xmlid: 'mail.mt_note',
			message_type: 'comment',
			partner_ids: []
		});
	});

	it('create extractId: skalár / [id] / {id}', async () => {
		setJson2Env();
		mockJson2({ status: 200, text: '5' });
		expect(await odooBackend()!.create('m', {})).toBe(5);
		mockJson2({ status: 200, text: '[6]' });
		expect(await odooBackend()!.create('m', {})).toBe(6);
		mockJson2({ status: 200, text: '{"id":7}' });
		expect(await odooBackend()!.create('m', {})).toBe(7);
	});

	it('create bez id → hodí (fail-loud, nie tichý success)', async () => {
		setJson2Env();
		mockJson2({ status: 200, text: 'false' });
		await expect(odooBackend()!.create('m', {})).rejects.toThrow(/nevrátil id/);
	});
});

describe('#5824 XmlRpcBackend lazy uid', () => {
	it('authenticate LEN raz naprieč viacerými operáciami na tej istej inštancii', async () => {
		setXmlrpcEnv();
		let auths = 0;
		setOdooTransport(async (_url, xml) => {
			if (xml.includes('<methodName>authenticate</methodName>')) {
				auths++;
				return xmlResp('<int>7</int>');
			}
			return xmlResp('<int>100</int>');
		});
		const be = odooBackend()!;
		await be.create('crm.lead', { name: 'a' });
		await be.create('ir.attachment', { name: 'b' });
		expect(auths).toBe(1); // jedna operačná skupina = jedna authenticate
	});
});
