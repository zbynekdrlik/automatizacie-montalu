// #5960: „Uložiť ponuku" credential-resolution + payload mapping + deterministické user-scoped quote_id.
// Mock transport na HTTP hranici (`setCallKwTransport`) zachytáva presné volanie do Odoo — tak overíme,
// že: (a) bez per-user kredenciálu je NULA Odoo callov a QuoteAuthError (nikdy zdieľaný kľúč); (b) payload
// sedí; (c) quote_id je deterministický + user-scoped.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
	setCallKwTransport,
	QuoteAuthError,
	type CallKwResponse
} from '../src/lib/server/odoo-call-kw';
import {
	saveQuoteToOdoo,
	deriveQuoteId,
	buildQuotePayload,
	QuoteInputError,
	type SaveQuoteInput
} from '../src/lib/server/odoo-quote';
import type { SessionUser } from '../src/lib/server/auth';

const odooUser: SessionUser = {
	id: -7,
	username: 'marek@montalu.sk',
	role: 'internal',
	source: 'odoo'
};
const localUser: SessionUser = { id: 5, username: 'local@x', role: 'internal' };
const SID = 'sess1234567890abcdef';

function enableSso() {
	process.env.ODOO_SSO_ENABLED = '1';
	process.env.ODOO_INTERNAL_URL = 'http://odoo-test:8069';
	process.env.ODOO_SSO_HOST = 'erp.montalu.cloud';
}
function disableSso() {
	delete process.env.ODOO_SSO_ENABLED;
	delete process.env.ODOO_INTERNAL_URL;
	delete process.env.ODOO_SSO_HOST;
}

interface Captured {
	sid: string;
	kwargs: Record<string, unknown>;
}
function mockTransport(
	result: Record<string, unknown> = { id: 42, name: 'AUT0001', created: true }
): Captured[] {
	const calls: Captured[] = [];
	setCallKwTransport(async (_url, _host, sid, bodyJson): Promise<CallKwResponse> => {
		const body = JSON.parse(bodyJson);
		calls.push({ sid, kwargs: body.params.kwargs });
		return { status: 200, text: JSON.stringify({ jsonrpc: '2.0', result }), setCookie: [] };
	});
	return calls;
}

function validInput(over: Partial<SaveQuoteInput> = {}): SaveQuoteInput {
	return {
		modul: 'zasklenia',
		url: '/automatizacie/zasklenia/1',
		cenaHladina: 'mo',
		zakaznik: { meno: 'Ján Novák', email: 'jan@x.sk', telefon: '0900', ico: '12345678' },
		lines: [{ kod: 'ZAS-01', nazov: 'Zasklenie', qty: 2, mj: 'ks', priceUnit: 100, discount: 5 }],
		...over
	};
}

beforeEach(() => enableSso());
afterEach(() => {
	setCallKwTransport(null);
	disableSso();
});

describe('saveQuoteToOdoo — credential resolution (per-user only, nikdy zdieľaný kľúč)', () => {
	it('SSO vypnuté → QuoteAuthError, NULA Odoo callov', async () => {
		disableSso();
		const calls = mockTransport();
		await expect(saveQuoteToOdoo(validInput(), SID, odooUser)).rejects.toBeInstanceOf(
			QuoteAuthError
		);
		expect(calls).toHaveLength(0);
	});
	it('user null → QuoteAuthError, NULA callov', async () => {
		const calls = mockTransport();
		await expect(saveQuoteToOdoo(validInput(), SID, null)).rejects.toBeInstanceOf(QuoteAuthError);
		expect(calls).toHaveLength(0);
	});
	it('lokálny (nie odoo) user → QuoteAuthError, NULA callov', async () => {
		const calls = mockTransport();
		await expect(saveQuoteToOdoo(validInput(), SID, localUser)).rejects.toBeInstanceOf(
			QuoteAuthError
		);
		expect(calls).toHaveLength(0);
	});
	it('odoo user ale chýba sid → QuoteAuthError, NULA callov', async () => {
		const calls = mockTransport();
		await expect(saveQuoteToOdoo(validInput(), undefined, odooUser)).rejects.toBeInstanceOf(
			QuoteAuthError
		);
		expect(calls).toHaveLength(0);
	});
	it('odoo user + sid → uloží (1 call, sid forwardnutý)', async () => {
		const calls = mockTransport();
		const res = await saveQuoteToOdoo(validInput(), SID, odooUser);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.sid).toBe(SID);
		expect(res).toMatchObject({ id: 42, name: 'AUT0001', created: true });
		expect(res.quoteId).toHaveLength(64); // sha256 hex
	});
});

describe('saveQuoteToOdoo — payload mapping', () => {
	it('modul/quote_id/app_user/lines/url/cena_hladina + zakaznik', async () => {
		const calls = mockTransport();
		await saveQuoteToOdoo(validInput(), SID, odooUser);
		const k = calls[0]!.kwargs;
		expect(k.modul).toBe('zasklenia');
		expect(k.quote_id).toBe(deriveQuoteId(odooUser.username, validInput()));
		expect(k.app_user).toBe('marek@montalu.sk');
		expect(k.url).toBe('/automatizacie/zasklenia/1');
		expect(k.cena_hladina).toBe('MO'); // upper-cased
		expect(k.lines).toEqual([
			{ kod: 'ZAS-01', nazov: 'Zasklenie', qty: 2, price_unit: 100, mj: 'ks', discount: 5 }
		]);
		expect(k.zakaznik).toEqual({
			meno: 'Ján Novák',
			email: 'jan@x.sk',
			telefon: '0900',
			ico: '12345678'
		});
		expect(k.partner_id).toBeUndefined();
	});
	it('partner_id (overený) potláča zakaznik', async () => {
		const calls = mockTransport();
		await saveQuoteToOdoo(validInput({ partnerId: 314, zakaznik: { meno: 'X' } }), SID, odooUser);
		const k = calls[0]!.kwargs;
		expect(k.partner_id).toBe(314);
		expect(k.zakaznik).toBeUndefined();
	});
	it('voliteľné polia riadku (mj/discount) sa vynechajú keď prázdne/nulové', async () => {
		const calls = mockTransport();
		await saveQuoteToOdoo(
			validInput({ lines: [{ kod: 'A', nazov: 'B', qty: 1, priceUnit: 0 }] }),
			SID,
			odooUser
		);
		expect((calls[0]!.kwargs.lines as unknown[])[0]).toEqual({
			kod: 'A',
			nazov: 'B',
			qty: 1,
			price_unit: 0
		});
	});
	it('attachments → name/mimetype/datas(base64)', async () => {
		const calls = mockTransport();
		const bytes = new TextEncoder().encode('hello-pdf');
		await saveQuoteToOdoo(
			validInput({ attachments: [{ name: 'ponuka.pdf', mimetype: 'application/pdf', bytes }] }),
			SID,
			odooUser
		);
		const atts = calls[0]!.kwargs.attachments as {
			name: string;
			mimetype: string;
			datas: string;
		}[];
		expect(atts).toHaveLength(1);
		expect(atts[0]!.name).toBe('ponuka.pdf');
		expect(atts[0]!.mimetype).toBe('application/pdf');
		expect(Buffer.from(atts[0]!.datas, 'base64').toString('utf8')).toBe('hello-pdf');
	});
	it('created:false sa surface-ne + quoteId prítomné', async () => {
		mockTransport({ id: 9, name: 'AUT0009', created: false });
		const res = await saveQuoteToOdoo(validInput(), SID, odooUser);
		expect(res.created).toBe(false);
		expect(res.id).toBe(9);
		expect(res.quoteId).toHaveLength(64);
	});
});

describe('deriveQuoteId / buildQuotePayload — determinizmus + user-scoping', () => {
	it('rovnaký vstup od toho istého usera → rovnaké quote_id (idempotentný retry)', () => {
		expect(deriveQuoteId(odooUser.username, validInput())).toBe(
			deriveQuoteId(odooUser.username, validInput())
		);
	});
	it('iný username → iné quote_id (user-scoped, žiadna cross-user kolízia)', () => {
		expect(deriveQuoteId('a@x', validInput())).not.toBe(deriveQuoteId('b@x', validInput()));
	});
	it('zmena obsahu (qty) → iné quote_id', () => {
		const a = deriveQuoteId(odooUser.username, validInput());
		const b = deriveQuoteId(
			odooUser.username,
			validInput({
				lines: [
					{ kod: 'ZAS-01', nazov: 'Zasklenie', qty: 3, mj: 'ks', priceUnit: 100, discount: 5 }
				]
			})
		);
		expect(a).not.toBe(b);
	});
	it('buildQuotePayload je byte-identický pre rovnaký vstup 2× (žiaden now())', () => {
		const qid = deriveQuoteId(odooUser.username, validInput());
		const p1 = JSON.stringify(buildQuotePayload(validInput(), odooUser, qid));
		const p2 = JSON.stringify(buildQuotePayload(validInput(), odooUser, qid));
		expect(p1).toBe(p2);
	});
});

describe('saveQuoteToOdoo — validácia vstupu (NULA Odoo callov)', () => {
	const cases: [string, Partial<SaveQuoteInput>][] = [
		['chýba modul', { modul: '' }],
		['prázdne lines', { lines: [] }],
		['nekladné qty', { lines: [{ kod: 'A', nazov: 'B', qty: 0, priceUnit: 1 }] }],
		['záporná cena', { lines: [{ kod: 'A', nazov: 'B', qty: 1, priceUnit: -1 }] }],
		// #446 „0 €" trieda — NaN sa NESMIE ticho scoercovať na 0
		['NaN qty', { lines: [{ kod: 'A', nazov: 'B', qty: NaN, priceUnit: 1 }] }],
		['NaN cena', { lines: [{ kod: 'A', nazov: 'B', qty: 1, priceUnit: NaN }] }],
		['NaN zľava', { lines: [{ kod: 'A', nazov: 'B', qty: 1, priceUnit: 1, discount: NaN }] }]
	];
	for (const [label, over] of cases) {
		it(`${label} → QuoteInputError, žiadny call`, async () => {
			const calls = mockTransport();
			await expect(saveQuoteToOdoo(validInput(over), SID, odooUser)).rejects.toBeInstanceOf(
				QuoteInputError
			);
			expect(calls).toHaveLength(0);
		});
	}
	it('nepovolený mimetype prílohy → QuoteInputError', async () => {
		const calls = mockTransport();
		const att = { name: 'x.exe', mimetype: 'application/x-msdownload', bytes: new Uint8Array([1]) };
		await expect(
			saveQuoteToOdoo(validInput({ attachments: [att] }), SID, odooUser)
		).rejects.toBeInstanceOf(QuoteInputError);
		expect(calls).toHaveLength(0);
	});
	it('prázdna príloha (0 bajtov) → QuoteInputError', async () => {
		mockTransport();
		const att = { name: 'x.pdf', mimetype: 'application/pdf', bytes: new Uint8Array(0) };
		await expect(
			saveQuoteToOdoo(validInput({ attachments: [att] }), SID, odooUser)
		).rejects.toBeInstanceOf(QuoteInputError);
	});
	it('príloha > 15 MB → QuoteInputError', async () => {
		mockTransport();
		const att = {
			name: 'big.pdf',
			mimetype: 'application/pdf',
			bytes: new Uint8Array(15 * 1024 * 1024 + 1)
		};
		await expect(
			saveQuoteToOdoo(validInput({ attachments: [att] }), SID, odooUser)
		).rejects.toBeInstanceOf(QuoteInputError);
	});
	it('> 12 príloh → QuoteInputError', async () => {
		mockTransport();
		const one = { name: 'a.pdf', mimetype: 'application/pdf', bytes: new Uint8Array([1]) };
		const atts = Array.from({ length: 13 }, () => one);
		await expect(
			saveQuoteToOdoo(validInput({ attachments: atts }), SID, odooUser)
		).rejects.toBeInstanceOf(QuoteInputError);
	});
	it('agregát > 90 MB → QuoteInputError (7 × 15 MB)', async () => {
		mockTransport();
		const big = new Uint8Array(15 * 1024 * 1024); // 15 MB, zdieľaná referencia = len 15 MB alokované
		const atts = Array.from({ length: 7 }, () => ({
			name: 'p.pdf',
			mimetype: 'application/pdf',
			bytes: big
		}));
		await expect(
			saveQuoteToOdoo(validInput({ attachments: atts }), SID, odooUser)
		).rejects.toBeInstanceOf(QuoteInputError);
	});
});

// #5960 review 🟡-5: mock-only testy nezachytia regresiu, ktorá pridá json2/shared-key fallback (má
// vlastný transport). Uzamkni invariant MECHANICKY nad zdrojom (vzor konfigurator-money-safety):
// per-user save cesta sa NESMIE viazať na `odoo-json2`/`odoo-rpc`/`odoo-backend`, `json2Config`, ani
// `ODOO_API_KEY`. Komentáre (kde je `ODOO_API_KEY` spomenutý v próze) sa pred kontrolou odstránia.
describe('shared-key invariant (mechanický zámok nad zdrojom)', () => {
	const stripComments = (src: string): string =>
		src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
	const files = [
		'src/lib/server/odoo-quote.ts',
		'src/lib/server/odoo-call-kw.ts',
		'src/routes/ulozit-ponuku/+server.ts'
	];
	for (const rel of files) {
		it(`${rel} sa neviaže na zdieľaný kľúč / json2 / xml-rpc`, () => {
			const code = stripComments(fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8'));
			expect(code).not.toMatch(/odoo-(json2|rpc|backend)/);
			expect(code).not.toMatch(/json2Config/);
			expect(code).not.toMatch(/ODOO_API_KEY/);
		});
	}
});
