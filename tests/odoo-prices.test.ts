// odoo-prices.ts — parsing of `montalu.automatizacie.catalog/get_prices` (#5808 / #599).
// The automatic price-source switch (no env flag), cache and fallback are covered in
// tests/odoo-ceny-599.test.ts. Prices are INVENTED (the repo is public).
import { describe, it, expect } from 'vitest';
import { _parseOdooPricesResponse } from '../src/lib/server/odoo-prices';

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
			sklad: 150.0,
			// rozvin not sent in this fixture → null (no longer stripped from the row type, #599)
			rozvin: null
		});
		expect(result.rows[1]!.nakupCennik).toBeNull();
		expect(result.rows[1]!.sklad).toBe(0);
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

		expect(result.rows[0]!.nakupCennik).toBeNull();
		expect(result.rows[0]!.nakupPoslednaFaktura).toBeNull();
		expect(result.rows[0]!.predajVo).toBeNull();
		expect(result.rows[0]!.sklad).toBeNull();
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
		expect(result.rows[0]!.kod).toBe('ZASP001');
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

		expect(result.rows[0]!.mena).toBe('EUR');
	});

	it('throws on non-object input', () => {
		expect(() => _parseOdooPricesResponse(null)).toThrow('nie je objekt');
		expect(() => _parseOdooPricesResponse('string')).toThrow('nie je objekt');
	});

	it('response without a `rows` array is NOT a valid answer (channel treated as unavailable)', () => {
		// #599: an empty/foreign 200 body must not read as "Odoo knows no prices" — that would
		// switch the price source to Odoo with every price unknown
		expect(() => _parseOdooPricesResponse({ generatedAt: null })).toThrow('rows');
		expect(() => _parseOdooPricesResponse([])).toThrow();
	});

	it('empty `rows` array is a valid answer (Odoo knows none of the codes)', () => {
		const result = _parseOdooPricesResponse({ generatedAt: null, rows: [], total: 0 });
		expect(result.rows).toHaveLength(0);
	});

	it('parses rozvin (montalu_rozvin) — #599: no longer forced to null', () => {
		const result = _parseOdooPricesResponse({
			generatedAt: null,
			rows: [{ kod: 'PRP00050', nakupCennik: 3, rozvin: 0.183, mena: 'EUR', sklad: 1 }],
			total: 1
		});
		expect(result.rows[0]!.rozvin).toBe(0.183);
		const r2 = _parseOdooPricesResponse({
			generatedAt: null,
			rows: [{ kod: 'ZASK00001', rozvin: false, mena: 'EUR', sklad: null }],
			total: 1
		});
		expect(r2.rows[0]!.rozvin).toBeNull();
	});
});
