// #5960: browser-side `saveQuoteRequest` — POST tvar (endpoint/telo), passthrough odpovede, NIKDY-hádže
// (sieťová chyba / nevalídny JSON / chýbajúce `ok` → bezpečné `{ok:false}`).
import { describe, it, expect } from 'vitest';
import { saveQuoteRequest, type SaveQuoteClientInput } from '../src/lib/ulozit-ponuku-client';

const input: SaveQuoteClientInput = {
	modul: 'zasklenia',
	lines: [{ kod: 'A', nazov: 'B', qty: 1, priceUnit: 10 }]
};

function fetchStub(resp: { status?: number; json?: () => Promise<unknown>; throws?: boolean }) {
	const calls: { url: string; init: RequestInit }[] = [];
	const f = (async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		if (resp.throws) throw new Error('offline');
		return {
			status: resp.status ?? 200,
			json:
				resp.json ?? (async () => ({ ok: true, created: true, name: 'AUT1', url: 'https://x/1' }))
		} as unknown as Response;
	}) as unknown as typeof fetch;
	return { f, calls };
}

describe('saveQuoteRequest', () => {
	it('POST na default endpoint /ulozit-ponuku s JSON telom', async () => {
		const { f, calls } = fetchStub({});
		await saveQuoteRequest(input, { fetchImpl: f });
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toBe('/ulozit-ponuku');
		expect(calls[0]!.init.method).toBe('POST');
		expect(JSON.parse(String(calls[0]!.init.body))).toEqual(input);
	});
	it('vlastný endpoint (${base}/ulozit-ponuku)', async () => {
		const { f, calls } = fetchStub({});
		await saveQuoteRequest(input, { fetchImpl: f, endpoint: '/automatizacie/ulozit-ponuku' });
		expect(calls[0]!.url).toBe('/automatizacie/ulozit-ponuku');
	});
	it('ok:true sa vráti nezmenené', async () => {
		const { f } = fetchStub({
			json: async () => ({ ok: true, created: false, name: 'AUT9', url: 'https://x/9' })
		});
		const r = await saveQuoteRequest(input, { fetchImpl: f });
		expect(r).toEqual({ ok: true, created: false, name: 'AUT9', url: 'https://x/9' });
	});
	it('ok:false sa vráti nezmenené (doslovná Odoo hláška)', async () => {
		const { f } = fetchStub({
			status: 409,
			json: async () => ({ ok: false, code: 'odoo', error: 'Obsah sa zmenil.' })
		});
		const r = await saveQuoteRequest(input, { fetchImpl: f });
		expect(r).toEqual({ ok: false, code: 'odoo', error: 'Obsah sa zmenil.' });
	});
	it('sieťová chyba (fetch hodí) → {ok:false, code:network}', async () => {
		const { f } = fetchStub({ throws: true });
		const r = await saveQuoteRequest(input, { fetchImpl: f });
		expect(r).toMatchObject({ ok: false, code: 'network' });
	});
	it('nevalídny JSON → {ok:false, code:network}', async () => {
		const { f } = fetchStub({
			status: 502,
			json: async () => {
				throw new Error('bad json');
			}
		});
		const r = await saveQuoteRequest(input, { fetchImpl: f });
		expect(r).toMatchObject({ ok: false, code: 'network' });
	});
	it('odpoveď bez `ok` → {ok:false, code:network}', async () => {
		const { f } = fetchStub({ json: async () => ({ weird: true }) });
		const r = await saveQuoteRequest(input, { fetchImpl: f });
		expect(r).toMatchObject({ ok: false, code: 'network' });
	});
	it('413 (adapter-node BODY_SIZE_LIMIT, holé telo) → {ok:false, code:toobig}', async () => {
		const { f } = fetchStub({
			status: 413,
			json: async () => {
				throw new Error('not json');
			}
		});
		const r = await saveQuoteRequest(input, { fetchImpl: f });
		expect(r).toMatchObject({ ok: false, code: 'toobig' });
	});
});
