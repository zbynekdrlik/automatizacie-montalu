import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	isOdooPricesEnabled,
	fetchOdooPrices,
	_parseOdooPricesResponse
} from '../src/lib/server/odoo-prices';
import { setJson2Transport } from '../src/lib/server/odoo-json2';

afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
});

describe('isOdooPricesEnabled', () => {
	it('returns false when env is unset', () => {
		vi.stubEnv('ODOO_PRICES_ENABLED', '');
		expect(isOdooPricesEnabled()).toBe(false);
	});

	it('returns false when env is "0"', () => {
		vi.stubEnv('ODOO_PRICES_ENABLED', '0');
		expect(isOdooPricesEnabled()).toBe(false);
	});

	it('returns true when env is "1"', () => {
		vi.stubEnv('ODOO_PRICES_ENABLED', '1');
		expect(isOdooPricesEnabled()).toBe(true);
	});
});

describe('_parseOdooPricesResponse', () => {
	it('parses valid response with all fields', () => {
		const result = _parseOdooPricesResponse({
			generatedAt: '2026-09-07T10:00:00Z',
			rows: [
				{
					kod: 'ZASP00014',
					nakupCennik: 12.5,
					nakupPoslednaFaktura: 11.0,
					predajVo: 18.0,
					mena: 'EUR',
					sklad: 150.0
				},
				{
					kod: 'TS00002',
					nakupCennik: null,
					nakupPoslednaFaktura: null,
					predajVo: 25.5,
					mena: 'EUR',
					sklad: 0
				}
			],
			total: 2
		});

		expect(result.generatedAt).toBe('2026-09-07T10:00:00Z');
		expect(result.total).toBe(2);
		expect(result.rows).toHaveLength(2);
		expect(result.rows[0]).toEqual({
			kod: 'ZASP00014',
			nakupCennik: 12.5,
			nakupPoslednaFaktura: 11.0,
			predajVo: 18.0,
			mena: 'EUR',
			sklad: 150.0
		});
		expect(result.rows[1].nakupCennik).toBeNull();
		expect(result.rows[1].sklad).toBe(0);
	});

	it('normalizes Odoo False to null', () => {
		const result = _parseOdooPricesResponse({
			generatedAt: null,
			rows: [
				{
					kod: 'ZASP001',
					nakupCennik: false,
					nakupPoslednaFaktura: false,
					predajVo: false,
					mena: 'EUR',
					sklad: false
				}
			],
			total: 1
		});

		expect(result.rows[0].nakupCennik).toBeNull();
		expect(result.rows[0].nakupPoslednaFaktura).toBeNull();
		expect(result.rows[0].predajVo).toBeNull();
		expect(result.rows[0].sklad).toBeNull();
	});

	it('skips rows without kod', () => {
		const result = _parseOdooPricesResponse({
			generatedAt: null,
			rows: [
				{
					kod: '',
					nakupCennik: 1,
					nakupPoslednaFaktura: null,
					predajVo: null,
					mena: 'EUR',
					sklad: null
				},
				{
					kod: 'ZASP001',
					nakupCennik: 2,
					nakupPoslednaFaktura: null,
					predajVo: null,
					mena: 'EUR',
					sklad: null
				},
				null,
				42
			],
			total: 4
		});

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0].kod).toBe('ZASP001');
	});

	it('defaults mena to EUR when empty', () => {
		const result = _parseOdooPricesResponse({
			generatedAt: null,
			rows: [
				{
					kod: 'ZASP001',
					nakupCennik: null,
					nakupPoslednaFaktura: null,
					predajVo: null,
					mena: '',
					sklad: null
				}
			],
			total: 1
		});

		expect(result.rows[0].mena).toBe('EUR');
	});

	it('throws on non-object input', () => {
		expect(() => _parseOdooPricesResponse(null)).toThrow('nie je objekt');
		expect(() => _parseOdooPricesResponse('string')).toThrow('nie je objekt');
	});

	it('handles missing rows gracefully', () => {
		const result = _parseOdooPricesResponse({ generatedAt: null });
		expect(result.rows).toHaveLength(0);
		expect(result.total).toBe(0);
	});
});

describe('fetchOdooPrices', () => {
	it('returns null when json2 config is missing', async () => {
		vi.stubEnv('ODOO_JSON2_URL', '');
		vi.stubEnv('ODOO_JSON2_API_KEY', '');
		const result = await fetchOdooPrices();
		expect(result).toBeNull();
	});

	it('returns parsed prices on success', async () => {
		const mockResponse = {
			generatedAt: '2026-09-07T12:00:00Z',
			rows: [
				{
					kod: 'ZASP00014',
					nakupCennik: 10.0,
					nakupPoslednaFaktura: 9.5,
					predajVo: 15.0,
					mena: 'EUR',
					sklad: 100
				}
			],
			total: 1
		};

		setJson2Transport(
			async () =>
				new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: mockResponse }), {
					status: 200
				})
		);

		vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
		vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
		const result = await fetchOdooPrices({ url: 'https://erp.test', apiKey: 'key' });
		expect(result).not.toBeNull();
		expect(result!.rows).toHaveLength(1);
		expect(result!.rows[0].kod).toBe('ZASP00014');
	});

	it('returns null on fetch error (graceful fallback)', async () => {
		setJson2Transport(async () => {
			throw new Error('ECONNREFUSED');
		});

		const result = await fetchOdooPrices({ url: 'https://erp.test', apiKey: 'key' });
		expect(result).toBeNull();
	});

	it('returns null on Odoo error response (graceful fallback)', async () => {
		setJson2Transport(
			async () =>
				new Response(
					JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 403, message: 'AccessDenied' } }),
					{ status: 200 }
				)
		);

		const result = await fetchOdooPrices({ url: 'https://erp.test', apiKey: 'key' });
		expect(result).toBeNull();
	});
});
