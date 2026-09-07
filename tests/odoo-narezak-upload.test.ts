import { describe, it, expect, afterEach, vi } from 'vitest';

// Mocks na top-level — vitest ich hoistuje automaticky, no tu sú explicitne navrchu.
// Obchádzajú transitive import money.ts → db.ts → better-sqlite3 (native modul,
// nedostupný bez --ignore-scripts).
vi.mock('../src/lib/server/money', () => ({
	normOp: (s: string) => s.toUpperCase().replace(/\s+/g, '')
}));
vi.mock('../src/lib/server/zakazka-ceny', () => ({
	zakazkaPrehlad: () => null
}));
vi.mock('../src/lib/server/ceny', () => ({
	enrichPolozky: () => null
}));
vi.mock('../src/lib/server/odoo-zakazka', () => ({
	buildZakazkaNote: () => ({})
}));
vi.mock('../src/lib/server/zakazka-pdf', () => ({
	generateZakazkaPdfBase64: async () => '',
	zakazkaPdfFilename: () => 'test.pdf'
}));

import {
	buildDocId,
	uploadNarezakToOdoo,
	queueNarezakUpload
} from '../src/lib/server/odoo-narezak-upload';

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('buildDocId', () => {
	it('builds a stable doc_id from zákazka číslo', () => {
		expect(buildDocId('ZAK2024-001')).toBe('rozpis-zak2024_001');
	});

	it('handles plain numeric input', () => {
		expect(buildDocId('12345')).toBe('rozpis-12345');
	});

	it('strips leading/trailing underscores from slug', () => {
		expect(buildDocId('--ZAK--')).toBe('rozpis-zak');
	});

	it('returns fallback for empty input', () => {
		expect(buildDocId('')).toBe('rozpis-x');
	});

	it('truncates long inputs to fit doc_id limit', () => {
		const long = 'A'.repeat(100);
		const result = buildDocId(long);
		expect(result.length).toBeLessThanOrEqual(40);
		expect(result).toMatch(/^rozpis-[a-z0-9_]+$/);
	});

	it('always matches the Odoo doc_id regex [a-z0-9_-]{1,40}', () => {
		const cases = ['ZAK2024-001', '', 'A'.repeat(100), 'x/y\\z', 'abc'];
		for (const c of cases) {
			const id = buildDocId(c);
			expect(id).toMatch(/^[a-z0-9_-]{1,40}$/);
		}
	});
});

describe('uploadNarezakToOdoo', () => {
	it('returns disabled when feature flag is off', async () => {
		vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '');
		vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
		vi.stubEnv('ODOO_JSON2_API_KEY', 'key');

		const result = await uploadNarezakToOdoo('ZAK001', 'OP001');
		expect(result.result).toBe('disabled');
	});

	it('returns disabled when json2 config is missing', async () => {
		vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '1');
		vi.stubEnv('ODOO_JSON2_URL', '');
		vi.stubEnv('ODOO_JSON2_API_KEY', '');

		const result = await uploadNarezakToOdoo('ZAK001', 'OP001');
		expect(result.result).toBe('disabled');
	});

	it('returns missing when zákazka has no odpis', async () => {
		vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '1');
		vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
		vi.stubEnv('ODOO_JSON2_API_KEY', 'key');

		const result = await uploadNarezakToOdoo('NONEXISTENT', 'OP999');
		expect(result.result).toBe('missing');
	});
});

describe('queueNarezakUpload (fire-and-forget contract)', () => {
	it('never throws synchronously', () => {
		vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '');
		expect(() => queueNarezakUpload('', '')).not.toThrow();
		expect(() => queueNarezakUpload('ZAK', 'OP')).not.toThrow();
	});
});
