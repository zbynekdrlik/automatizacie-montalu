import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	callJson2,
	odooJson2Config,
	isNarezUploadEnabled,
	setJson2Transport,
	OdooJson2Error,
	type OdooJson2Config
} from '../src/lib/server/odoo-json2';

const CFG: OdooJson2Config = { url: 'https://erp.test', apiKey: 'test-key-123' };

afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
});

describe('odooJson2Config', () => {
	it('returns null when env vars are missing', () => {
		vi.stubEnv('ODOO_JSON2_URL', '');
		vi.stubEnv('ODOO_JSON2_API_KEY', '');
		expect(odooJson2Config()).toBeNull();
	});

	it('returns config when both env vars are set', () => {
		vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
		vi.stubEnv('ODOO_JSON2_API_KEY', 'my-key');
		const cfg = odooJson2Config();
		expect(cfg).toEqual({ url: 'https://erp.test', apiKey: 'my-key' });
	});

	it('returns null when only URL is set', () => {
		vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
		vi.stubEnv('ODOO_JSON2_API_KEY', '');
		expect(odooJson2Config()).toBeNull();
	});
});

describe('isNarezUploadEnabled', () => {
	it('returns false by default', () => {
		vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '');
		expect(isNarezUploadEnabled()).toBe(false);
	});

	it('returns true when set to "1"', () => {
		vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '1');
		expect(isNarezUploadEnabled()).toBe(true);
	});

	it('returns false for any other value', () => {
		vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', 'true');
		expect(isNarezUploadEnabled()).toBe(false);
	});
});

describe('callJson2', () => {
	it('sends correct request shape (model, method, bearer auth)', async () => {
		let capturedUrl = '';
		let capturedHeaders: Record<string, string> = {};
		let capturedBody = '';

		setJson2Transport(async (input, init) => {
			capturedUrl = typeof input === 'string' ? input : (input as Request).url;
			const h = init?.headers;
			if (h && typeof h === 'object' && !Array.isArray(h)) {
				capturedHeaders = h as Record<string, string>;
			}
			capturedBody = init?.body as string;
			return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		});

		await callJson2(CFG, 'sale.order', 'montalu_narezak_upload', {
			order_number: 'OP2024001',
			doc_id: 'plan-1',
			kind: 'narezak'
		});

		expect(capturedUrl).toBe('https://erp.test/json/2/sale.order/montalu_narezak_upload');
		expect(capturedHeaders['Authorization']).toBe('bearer test-key-123');
		expect(capturedHeaders['Content-Type']).toBe('application/json');

		const body = JSON.parse(capturedBody);
		expect(body.jsonrpc).toBe('2.0');
		expect(body.method).toBe('call');
		expect(body.params.order_number).toBe('OP2024001');
		expect(body.params.doc_id).toBe('plan-1');
		expect(body.params.kind).toBe('narezak');
	});

	it('returns result on success', async () => {
		setJson2Transport(async () =>
			new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					result: { attachment_id: 42, order_id: 7, version: 1, replaced: false }
				}),
				{ status: 200 }
			)
		);

		const result = await callJson2(CFG, 'sale.order', 'montalu_narezak_upload', {});
		expect(result).toEqual({ attachment_id: 42, order_id: 7, version: 1, replaced: false });
	});

	it('throws OdooJson2Error on HTTP error', async () => {
		setJson2Transport(async () =>
			new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
		);

		await expect(callJson2(CFG, 'sale.order', 'test', {})).rejects.toThrow(OdooJson2Error);
		await expect(callJson2(CFG, 'sale.order', 'test', {})).rejects.toThrow(/HTTP 401/);
	});

	it('throws OdooJson2Error on JSON-RPC error response', async () => {
		setJson2Transport(async () =>
			new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					error: { code: 200, message: 'montalu_order_not_found: objednavka nie je v Odoo' }
				}),
				{ status: 200 }
			)
		);

		await expect(callJson2(CFG, 'sale.order', 'montalu_narezak_upload', {})).rejects.toThrow(
			/montalu_order_not_found/
		);
	});

	it('strips trailing slash from URL', async () => {
		let capturedUrl = '';
		setJson2Transport(async (input) => {
			capturedUrl = typeof input === 'string' ? input : (input as Request).url;
			return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }), { status: 200 });
		});

		await callJson2({ url: 'https://erp.test/', apiKey: 'k' }, 'res.partner', 'read', {});
		expect(capturedUrl).toBe('https://erp.test/json/2/res.partner/read');
	});

	it('throws on invalid JSON response', async () => {
		setJson2Transport(async () => new Response('not json at all', { status: 200 }));
		await expect(callJson2(CFG, 'sale.order', 'test', {})).rejects.toThrow(/nevalidný JSON/);
	});
});
