// #599 krok 1: `odoo-katalog.ts` — Odoo `product.product` (JSON-2 `search_read`) ako katalóg
// artiklov appky podľa `default_code` (= Money kód; Odoo katalóg je syncovaný z Money). Vzor
// `odoo-glass-types.ts` (`.claude/rules/glass-catalog.md` „NIKDY neblokuj page load na Odoo"):
// krátky per-volanie timeout (3 s), cache úspech 5 min / nedostupnosť 60 s, single-flight, warn
// LEN RAZ za proces; nenakonfigurovaná integrácia (dev/test/CI) = bez volania, bez warnu.
// Mockuje sa LEN sieťová hranica (`setJson2Transport`). Kódy/názvy = reálne PROD artikly
// (read-only sonda 30.9.), BEZ cien (repo je verejné).
//
// Pozn. (PROD sonda 30.9.): pole `qty_available` technický účet NEČÍTA (403 mrp.bom) — katalóg ho
// preto NEŽIADA (inak by padol celý read); stav skladu ostáva na Money snapshote (#599 nález).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setJson2Transport } from '../src/lib/server/odoo-json2';
import { odooProduktyPreKody, _resetOdooKatalogCache } from '../src/lib/server/odoo-katalog';

function enableEnv() {
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
}

// reálne PROD artikly (default_code, name, uom) — bez cien
const PRODUKTY = [
	{
		id: 20557,
		default_code: 'ZASP00014',
		name: 'Koľajnica 2K Surový 7500 mm',
		uom_id: [9, 'm'],
		is_storable: true,
		active: true
	},
	{
		id: 1,
		default_code: 'BPK202535',
		name: 'Krytka',
		uom_id: [1, 'Units'],
		is_storable: true,
		active: true
	}
];

interface Call {
	url: string;
	body: Record<string, unknown>;
}

function mockOdoo(opts: { status?: number; hang?: boolean; rows?: unknown[] } = {}): Call[] {
	const calls: Call[] = [];
	setJson2Transport(async (url, init) => {
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		calls.push({ url: String(url), body });
		if (opts.hang) {
			return await new Promise<Response>((_, reject) => {
				init?.signal?.addEventListener('abort', () =>
					reject(new DOMException('aborted', 'AbortError'))
				);
			});
		}
		if (opts.status && opts.status !== 200)
			return new Response('{"name":"odoo.exceptions.AccessError"}', { status: opts.status });
		const kody = (body.domain as [string, string, string[]][])[0]![2];
		const rows = (opts.rows ?? PRODUKTY) as { default_code: unknown }[];
		return new Response(
			JSON.stringify(rows.filter((p) => kody.includes(p.default_code as string))),
			{ status: 200 }
		);
	});
	return calls;
}

beforeEach(() => {
	_resetOdooKatalogCache();
});

afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe('odooProduktyPreKody (#599)', () => {
	it('volá product.product search_read: domain default_code in kódy, polia BEZ qty_available', async () => {
		enableEnv();
		const calls = mockOdoo();
		await odooProduktyPreKody(['ZASP00014', 'BPK202535']);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toContain('/json/2/product.product/search_read');
		const domain = calls[0]!.body.domain as [string, string, string[]][];
		expect(domain[0]![0]).toBe('default_code');
		expect(domain[0]![1]).toBe('in');
		expect([...domain[0]![2]].sort()).toEqual(['BPK202535', 'ZASP00014']);
		expect(calls[0]!.body.fields).toEqual(['default_code', 'name', 'uom_id', 'is_storable', 'active']);
		expect(calls[0]!.body.fields).not.toContain('qty_available');
	});

	it('mapuje nájdené produkty {kod, nazov, mj, skladovy}; kód mimo Odoo v mape NIE JE', async () => {
		enableEnv();
		mockOdoo();
		const r = await odooProduktyPreKody(['ZASP00014', 'ZASP99999']);
		expect(r.zdroj).toBe('odoo');
		if (r.zdroj !== 'odoo') return;
		expect(r.produkty.get('ZASP00014')).toEqual({
			kod: 'ZASP00014',
			nazov: 'Koľajnica 2K Surový 7500 mm',
			mj: 'm',
			skladovy: true
		});
		expect(r.produkty.has('ZASP99999')).toBe(false);
	});

	it('Odoo `false` v char/many2one poliach → prázdny reťazec, nikdy „false"', async () => {
		enableEnv();
		mockOdoo({
			rows: [
				{ default_code: 'TS00016', name: false, uom_id: false, is_storable: false, active: true }
			]
		});
		const r = await odooProduktyPreKody(['TS00016']);
		if (r.zdroj !== 'odoo') throw new Error('čakal som zdroj odoo');
		expect(r.produkty.get('TS00016')).toEqual({ kod: 'TS00016', nazov: '', mj: '', skladovy: false });
	});

	it('cache: druhé volanie v TTL (aj pre kód, ktorý Odoo nepozná) nevolá Odoo znova', async () => {
		enableEnv();
		const calls = mockOdoo();
		await odooProduktyPreKody(['ZASP00014', 'ZASP99999']);
		const r = await odooProduktyPreKody(['ZASP99999', 'ZASP00014']);
		expect(calls).toHaveLength(1);
		if (r.zdroj !== 'odoo') throw new Error('čakal som zdroj odoo');
		expect(r.produkty.has('ZASP00014')).toBe(true);
		expect(r.produkty.has('ZASP99999')).toBe(false);
	});

	it('dotiahne LEN chýbajúce kódy (cachované sa znova nepýtajú)', async () => {
		enableEnv();
		const calls = mockOdoo();
		await odooProduktyPreKody(['ZASP00014']);
		await odooProduktyPreKody(['ZASP00014', 'BPK202535']);
		expect(calls).toHaveLength(2);
		expect((calls[1]!.body.domain as [string, string, string[]][])[0]![2]).toEqual(['BPK202535']);
	});

	it('úspech sa cachuje 5 min — po expirácii sa Odoo pýta znova', async () => {
		enableEnv();
		vi.useFakeTimers({ toFake: ['Date'] });
		const calls = mockOdoo();
		await odooProduktyPreKody(['ZASP00014']);
		vi.setSystemTime(Date.now() + 4 * 60 * 1000);
		await odooProduktyPreKody(['ZASP00014']);
		expect(calls).toHaveLength(1);
		vi.setSystemTime(Date.now() + 2 * 60 * 1000);
		await odooProduktyPreKody(['ZASP00014']);
		expect(calls).toHaveLength(2);
	});

	it('single-flight: súbežní volajúci zdieľajú JEDEN read', async () => {
		enableEnv();
		const calls = mockOdoo();
		const [a, b] = await Promise.all([
			odooProduktyPreKody(['ZASP00014']),
			odooProduktyPreKody(['ZASP00014'])
		]);
		expect(a.zdroj).toBe('odoo');
		expect(b.zdroj).toBe('odoo');
		expect(calls).toHaveLength(1);
	});

	it('Odoo 403 → nedostupné (dôvod chyba); 60 s sa Odoo NEvolá znova, potom áno', async () => {
		enableEnv();
		vi.useFakeTimers({ toFake: ['Date'] });
		const calls = mockOdoo({ status: 403 });
		const r = await odooProduktyPreKody(['ZASP00014']);
		expect(r).toEqual({ zdroj: 'nedostupne', dovod: 'chyba' });
		vi.setSystemTime(Date.now() + 30 * 1000);
		expect((await odooProduktyPreKody(['BPK202535'])).zdroj).toBe('nedostupne');
		expect(calls).toHaveLength(1); // žiadny fan-out počas výpadku
		vi.setSystemTime(Date.now() + 31 * 1000);
		mockOdoo();
		expect((await odooProduktyPreKody(['ZASP00014'])).zdroj).toBe('odoo'); // auto-heal
	});

	it('timeout (Odoo visí) → nedostupné v rámci timeoutu (default 3 s, tu 50 ms)', async () => {
		enableEnv();
		mockOdoo({ hang: true });
		const t0 = Date.now();
		const r = await odooProduktyPreKody(['ZASP00014'], { timeoutMs: 50 });
		expect(r).toEqual({ zdroj: 'nedostupne', dovod: 'chyba' });
		expect(Date.now() - t0).toBeLessThan(2000);
	});

	it('integrácia nenakonfigurovaná (dev/test/CI) → nedostupné (config) bez volania Odoo', async () => {
		const calls = mockOdoo();
		expect(await odooProduktyPreKody(['ZASP00014'])).toEqual({
			zdroj: 'nedostupne',
			dovod: 'config'
		});
		expect(calls).toHaveLength(0);
	});

	it('prázdny zoznam / prázdne kódy → nevolá Odoo, zdroj odoo s prázdnou mapou', async () => {
		enableEnv();
		const calls = mockOdoo();
		const r = await odooProduktyPreKody(['', '  ']);
		expect(calls).toHaveLength(0);
		expect(r.zdroj).toBe('odoo');
	});
});
