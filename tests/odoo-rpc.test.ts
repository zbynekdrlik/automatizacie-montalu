import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	encodeValue,
	methodCall,
	xmlEscape,
	xmlUnescape,
	parseResponse,
	OdooRpcError,
	setOdooTransport,
	authenticate,
	executeKw,
	createRecord,
	odooConfig,
	type OdooConfig
} from '../src/lib/server/odoo-rpc';

const CFG: OdooConfig = { url: 'https://odoo.test', db: 'odoo', login: 'web', apiKey: 'k' };

afterEach(() => {
	setOdooTransport(null);
	vi.unstubAllEnvs();
});

describe('encoder', () => {
	it('encodes scalars', () => {
		expect(encodeValue('a')).toBe('<value><string>a</string></value>');
		expect(encodeValue(7)).toBe('<value><int>7</int></value>');
		expect(encodeValue(1.5)).toBe('<value><double>1.5</double></value>');
		expect(encodeValue(true)).toBe('<value><boolean>1</boolean></value>');
		expect(encodeValue(false)).toBe('<value><boolean>0</boolean></value>');
	});
	it('encodes empty array (partner_ids: [])', () => {
		expect(encodeValue([])).toBe('<value><array><data></data></array></value>');
	});
	it('encodes array + nested struct (message_post kwargs shape)', () => {
		const s = encodeValue({ body: '<b>x</b>', partner_ids: [] });
		expect(s).toContain('<struct>');
		expect(s).toContain('<member><name>body</name>');
		// body value is XML-escaped on the wire
		expect(s).toContain('&lt;b&gt;x&lt;/b&gt;');
		expect(s).toContain(
			'<member><name>partner_ids</name><value><array><data></data></array></value>'
		);
	});
	it('xmlEscape strips C0 control chars but keeps tab/newline handling to caller', () => {
		expect(xmlEscape('a\x0bb')).toBe('ab');
		expect(xmlEscape('<&>"\'')).toBe('&lt;&amp;&gt;&quot;&apos;');
	});
	it('xmlUnescape round-trips entities', () => {
		expect(xmlUnescape('&lt;a&gt;&amp;&quot;&apos;')).toBe('<a>&"\'');
	});
	it('methodCall wraps params', () => {
		expect(methodCall('m', [1])).toContain('<methodName>m</methodName>');
		expect(methodCall('m', [1])).toContain('<param><value><int>1</int></value></param>');
	});
});

describe('parseResponse', () => {
	const wrapScalar = (inner: string) =>
		`<?xml version="1.0"?><methodResponse><params><param><value>${inner}</value></param></params></methodResponse>`;
	it('parses int scalar', () => {
		expect(parseResponse(wrapScalar('<int>42</int>'))).toBe(42);
	});
	it('parses boolean scalar', () => {
		expect(parseResponse(wrapScalar('<boolean>1</boolean>'))).toBe(true);
	});
	it('parses string scalar with unescape', () => {
		expect(parseResponse(wrapScalar('<string>a&amp;b</string>'))).toBe('a&b');
	});
	it('parses array of ints (search result)', () => {
		const xml = wrapScalar(
			'<array><data><value><int>53051</int></value><value><int>53046</int></value></data></array>'
		);
		expect(parseResponse(xml)).toEqual([53051, 53046]);
	});
	it('parses empty array (no match) as []', () => {
		const xml = wrapScalar('<array><data></data></array>');
		expect(parseResponse(xml)).toEqual([]);
	});
	it('throws OdooRpcError on <fault>', () => {
		const xml =
			'<?xml version="1.0"?><methodResponse><fault><value><struct>' +
			'<member><name>faultCode</name><value><int>2</int></value></member>' +
			'<member><name>faultString</name><value><string>boom</string></value></member>' +
			'</struct></value></fault></methodResponse>';
		expect(() => parseResponse(xml)).toThrow(OdooRpcError);
		expect(() => parseResponse(xml)).toThrow(/boom/);
	});
	it('throws on unreadable response', () => {
		expect(() => parseResponse('<methodResponse><params></params></methodResponse>')).toThrow(
			OdooRpcError
		);
	});
});

describe('authenticate + executeKw (mock transport)', () => {
	const okInt = (n: number) =>
		`<methodResponse><params><param><value><int>${n}</int></value></param></params></methodResponse>`;

	it('authenticate returns uid', async () => {
		setOdooTransport(async () => okInt(252));
		expect(await authenticate(CFG)).toBe(252);
	});
	it('authenticate throws on uid<=0', async () => {
		setOdooTransport(async () => okInt(0));
		await expect(authenticate(CFG)).rejects.toThrow(OdooRpcError);
	});
	it('executeKw sends url/db/uid/apiKey/model/method/args/kwargs and returns parsed result', async () => {
		let seenUrl = '';
		let seenBody = '';
		setOdooTransport(async (url, body) => {
			seenUrl = url;
			seenBody = body;
			return `<methodResponse><params><param><value><array><data><value><int>9</int></value></data></array></value></param></params></methodResponse>`;
		});
		const res = await executeKw(CFG, 252, 'sale.order', 'search', [[['name', '=', 'OP1']]], {
			limit: 1
		});
		expect(res).toEqual([9]);
		expect(seenUrl).toBe('https://odoo.test/xmlrpc/2/object');
		expect(seenBody).toContain('<methodName>execute_kw</methodName>');
		expect(seenBody).toContain('<string>sale.order</string>');
		expect(seenBody).toContain('<string>search</string>');
		expect(seenBody).toContain('<member><name>limit</name><value><int>1</int></value></member>');
	});
	it('createRecord returns new id', async () => {
		setOdooTransport(async () => okInt(555));
		expect(await createRecord(CFG, 1, 'crm.lead', { name: 'x' })).toBe(555);
	});
	it('createRecord throws when no id', async () => {
		setOdooTransport(
			async () =>
				'<methodResponse><params><param><value><boolean>0</boolean></value></param></params></methodResponse>'
		);
		await expect(createRecord(CFG, 1, 'crm.lead', {})).rejects.toThrow(OdooRpcError);
	});
});

describe('odooConfig', () => {
	it('returns null when any ODOO_LEAD_* is missing', () => {
		vi.stubEnv('ODOO_LEAD_URL', 'https://x');
		vi.stubEnv('ODOO_LEAD_DB', '');
		vi.stubEnv('ODOO_LEAD_LOGIN', 'l');
		vi.stubEnv('ODOO_LEAD_API_KEY', 'k');
		expect(odooConfig()).toBeNull();
	});
	it('returns config when all present', () => {
		vi.stubEnv('ODOO_LEAD_URL', 'https://x');
		vi.stubEnv('ODOO_LEAD_DB', 'odoo');
		vi.stubEnv('ODOO_LEAD_LOGIN', 'l');
		vi.stubEnv('ODOO_LEAD_API_KEY', 'k');
		expect(odooConfig()).toEqual({ url: 'https://x', db: 'odoo', login: 'l', apiKey: 'k' });
	});
});
