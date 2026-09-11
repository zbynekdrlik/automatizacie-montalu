// #511: upload skutočného plánu rezov na kiosk (sale.order) cez montalu_narezak_upload.
// Mock Odoo transport (setJson2Transport) ZACHYTÍ upload — overuje kontrakt: kind='narezak',
// doc_id 'plan-rezov-<zak>-<op>', filename 'Plan-rezov-…', PDF prítomné. Money-neutrálne.
//
// Mocky obchádzajú native better-sqlite3 (money.ts → db.ts, zakazka-ceny.ts → db.ts) — plan-rezov
// compute + plan-rezov-pdf + odoo-json2 sú čisté, bežia naostro (vzor odoo-narezak-upload.test.ts).
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../src/lib/server/money', () => ({
	normOp: (s: string) => s.toUpperCase().replace(/\s+/g, ''),
	normZak: (s: string) => s.toUpperCase().replace(/\s+/g, '')
}));
vi.mock('../src/lib/server/zakazka-ceny', () => ({
	zakazkaPrehlad: vi.fn()
}));

import { zakazkaPrehlad } from '../src/lib/server/zakazka-ceny';
import { setJson2Transport } from '../src/lib/server/odoo-json2';
import {
	buildPlanRezovDocId,
	uploadPlanRezovToOdoo,
	queuePlanRezovUpload
} from '../src/lib/server/odoo-plan-rezov-upload';

const CAD = 'STABILIZAČNÝ PROFIL 100X50\t3\t2000\nLAT 80x19\t4\t1865';

function baseInput(over: Partial<Parameters<typeof uploadPlanRezovToOdoo>[0]> = {}) {
	return { zak: 'ZAK123', cadText: CAD, dlzkaTyce: 6000, reznaMedzera: 4, ...over };
}

function enableEnv() {
	vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '1');
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
}

afterEach(() => {
	vi.unstubAllEnvs();
	setJson2Transport(null);
	vi.mocked(zakazkaPrehlad).mockReset();
});

describe('buildPlanRezovDocId', () => {
	it('spája zak + op do stabilného plan-rezov doc_id', () => {
		expect(buildPlanRezovDocId('ZAK2026553', 'OP260466')).toBe('plan-rezov-zak2026553-op260466');
	});
	it('nekoliduje s rozpis- doc_id (iný prefix)', () => {
		expect(buildPlanRezovDocId('ZAK1', 'OP1')).toMatch(/^plan-rezov-/);
	});
	it('vždy matchuje Odoo doc_id regex [a-z0-9_-]{1,40}', () => {
		const cases: [string, string][] = [
			['ZAK2026553', 'OP260466'],
			['A'.repeat(100), 'B'.repeat(100)],
			['x/y\\z', 'o p#q'],
			['', '']
		];
		for (const [z, o] of cases) {
			const id = buildPlanRezovDocId(z, o);
			expect(id).toMatch(/^[a-z0-9_-]{1,40}$/);
			expect(id.length).toBeLessThanOrEqual(40);
		}
	});
});

describe('uploadPlanRezovToOdoo', () => {
	it('returns disabled when feature flag is off', async () => {
		vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '');
		vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
		vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
		expect((await uploadPlanRezovToOdoo(baseInput())).result).toBe('disabled');
	});

	it('returns disabled when json2 config is missing', async () => {
		vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '1');
		vi.stubEnv('ODOO_JSON2_URL', '');
		vi.stubEnv('ODOO_JSON2_API_KEY', '');
		expect((await uploadPlanRezovToOdoo(baseInput())).result).toBe('disabled');
	});

	it('skips (no-zak) when zákazka pole je prázdne / whitespace', async () => {
		enableEnv();
		expect((await uploadPlanRezovToOdoo(baseInput({ zak: '' }))).result).toBe('no-zak');
		expect((await uploadPlanRezovToOdoo(baseInput({ zak: '   ' }))).result).toBe('no-zak');
		expect(zakazkaPrehlad).not.toHaveBeenCalled();
	});

	it('returns missing when zákazka nemá odpis (žiadny order na priradenie)', async () => {
		enableEnv();
		vi.mocked(zakazkaPrehlad).mockReturnValue(null);
		expect((await uploadPlanRezovToOdoo(baseInput())).result).toBe('missing');
	});

	it('returns missing when prehlad nemá op', async () => {
		enableEnv();
		vi.mocked(zakazkaPrehlad).mockReturnValue({
			zak: 'ZAK123',
			zakaznik: 'Firma',
			odpisy: [{ op: '' }]
		} as never);
		expect((await uploadPlanRezovToOdoo(baseInput())).result).toBe('missing');
	});

	it('uploaded — mock transport zachytí narezak upload s plan-rezov doc_id + Plan-rezov filename + PDF', async () => {
		enableEnv();
		vi.mocked(zakazkaPrehlad).mockReturnValue({
			zak: 'ZAK123',
			zakaznik: 'Firma s.r.o.',
			odpisy: [{ op: 'OP260439' }]
		} as never);

		let captured: { url: string; body: Record<string, unknown> } | null = null;
		setJson2Transport(async (url, opts) => {
			captured = { url: String(url), body: JSON.parse(String((opts as RequestInit).body)) };
			return new Response(JSON.stringify({}), { status: 200 });
		});

		const r = await uploadPlanRezovToOdoo(baseInput({ now: new Date('2026-09-02T08:30:00Z') }));
		expect(r.result).toBe('uploaded');
		expect(captured).not.toBeNull();
		const cap = captured!;
		expect(cap.url).toMatch(/\/json\/2\/sale\.order\/montalu_narezak_upload$/);
		expect(cap.body.order_number).toBe('OP260439');
		expect(cap.body.kind).toBe('narezak');
		expect(cap.body.doc_id).toBe('plan-rezov-zak123-op260439');
		expect(String(cap.body.filename)).toMatch(/^Plan-rezov-ZAK123-\d{8}-\d{4}\.pdf$/);
		// PDF prítomné a je to naozaj PDF (base64 → %PDF)
		const pdf = Buffer.from(String(cap.body.pdf_base64), 'base64');
		expect(pdf.slice(0, 5).toString('latin1')).toBe('%PDF-');
		// žiadna cena neprešla ani ako `lines` — tento upload žiadne lines neposiela
		expect('lines' in cap.body).toBe(false);
	});

	it('failed (nie throw) keď transport zlyhá — best-effort kontrakt', async () => {
		enableEnv();
		vi.mocked(zakazkaPrehlad).mockReturnValue({
			zak: 'ZAK123',
			zakaznik: 'Firma',
			odpisy: [{ op: 'OP260439' }]
		} as never);
		setJson2Transport(async () => new Response('boom', { status: 500 }));
		const r = await uploadPlanRezovToOdoo(baseInput());
		expect(r.result).toBe('failed');
		expect(r.error).toBeTruthy();
	});
});

describe('queuePlanRezovUpload (fire-and-forget contract)', () => {
	it('never throws synchronously', () => {
		vi.stubEnv('ODOO_NAREZ_UPLOAD_ENABLED', '');
		expect(() => queuePlanRezovUpload(baseInput({ zak: '' }))).not.toThrow();
		expect(() => queuePlanRezovUpload(baseInput())).not.toThrow();
	});
});
