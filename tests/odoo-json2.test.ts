import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	callJson2,
	json2Config,
	OdooJson2Error,
	setJson2Transport,
	type Json2Config
} from '../src/lib/server/odoo-json2';

const CFG: Json2Config = { url: 'https://erp.montalu.cloud', apiKey: 'test-key-123' };

afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
});

describe('json2Config', () => {
	it('returns null when env is missing', () => {
		vi.stubEnv('ODOO_JSON2_URL', '');
		vi.stubEnv('ODOO_JSON2_API_KEY', '');
		expect(json2Config()).toBeNull();
	});

	it('returns config when both env vars are set', () => {
		vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
		vi.stubEnv('ODOO_JSON2_API_KEY', 'abc');
		expect(json2Config()).toEqual({ url: 'https://erp.test', apiKey: 'abc' });
	});
});

describe('callJson2', () => {
	it('sends correct request shape and parses result', async () => {
		let capturedUrl = '';
		let capturedBody = '';
		let capturedHeaders: Record<string, string> = {};

		setJson2Transport(async (url, body, headers) => {
			capturedUrl = url;
			capturedBody = body;
			capturedHeaders = headers;
			return { status: 200, text: JSON.stringify({ result: { total: 42 } }) };
		});

		const result = await callJson2<{ total: number }>(
			CFG,
			'montalu.automatizacie.catalog',
			'get_prices',
			{ codes: ['ZASP001'] }
		);

		expect(capturedUrl).toBe(
			'https://erp.montalu.cloud/json/2/montalu.automatizacie.catalog/get_prices'
		);
		expect(JSON.parse(capturedBody)).toEqual({ kwargs: { codes: ['ZASP001'] } });
		expect(capturedHeaders.Authorization).toBe('bearer test-key-123');
		expect(result).toEqual({ total: 42 });
	});

	it('strips trailing slashes from base URL', async () => {
		let capturedUrl = '';
		setJson2Transport(async (url) => {
			capturedUrl = url;
			return { status: 200, text: JSON.stringify({ result: 'ok' }) };
		});

		await callJson2({ url: 'https://erp.test///', apiKey: 'k' }, 'model', 'method');
		expect(capturedUrl).toBe('https://erp.test/json/2/model/method');
	});

	it('throws on HTTP error', async () => {
		setJson2Transport(async () => ({
			status: 403,
			text: 'Forbidden'
		}));

		await expect(callJson2(CFG, 'model', 'method')).rejects.toThrow(OdooJson2Error);
		await expect(callJson2(CFG, 'model', 'method')).rejects.toThrow(/HTTP 403/);
	});

	it('throws on Odoo error response', async () => {
		setJson2Transport(async () => ({
			status: 200,
			text: JSON.stringify({
				error: {
					message: 'AccessError: not allowed',
					data: { name: 'odoo.exceptions.AccessError' }
				}
			})
		}));

		await expect(callJson2(CFG, 'model', 'method')).rejects.toThrow(OdooJson2Error);
		await expect(callJson2(CFG, 'model', 'method')).rejects.toThrow(/AccessError/);
	});

	it('throws on invalid JSON response', async () => {
		setJson2Transport(async () => ({
			status: 200,
			text: '<html>Not JSON</html>'
		}));

		await expect(callJson2(CFG, 'model', 'method')).rejects.toThrow(OdooJson2Error);
		await expect(callJson2(CFG, 'model', 'method')).rejects.toThrow(/neplatný JSON/);
	});

	it('throws on missing result key', async () => {
		setJson2Transport(async () => ({
			status: 200,
			text: JSON.stringify({ data: 'no result key' })
		}));

		await expect(callJson2(CFG, 'model', 'method')).rejects.toThrow(OdooJson2Error);
		await expect(callJson2(CFG, 'model', 'method')).rejects.toThrow(/nemá "result"/);
	});

	it('throws on network error', async () => {
		setJson2Transport(async () => {
			throw new Error('ECONNREFUSED');
		});

		await expect(callJson2(CFG, 'model', 'method')).rejects.toThrow(OdooJson2Error);
		await expect(callJson2(CFG, 'model', 'method')).rejects.toThrow(/sieťová chyba/);
	});
});
