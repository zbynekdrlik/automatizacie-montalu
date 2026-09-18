// #540/#546: fetchGlassTypes — zoznam typov skla z Odoo `montalu.glass.type` pre OBJEDNÁVKOVÝ
// picker. Money-NEUTRÁLNE: len ordering zoznam, výpočtový `glass_types` katalóg (sklo → skloHrubka →
// profily → Money) je NEDOTKNUTÝ. #546: SKUTOČNÉ názvy polí `montalu.glass.type` (relay #540):
// `name,category,cennik_code,composition,active` (nie `code`/`composition_spec` → dnes 500 → fallback
// na PROD). Picker položka `{ value: cennik_code || name, label: name (+ ' · ' + composition),
// category }`; `value` = to, čo sa uloží ako `glass_order.items[].glass_type` (Odoo `resolve_glass_type`
// páruje kód → presný názov → zloženie). Overuje: search_read tvar (model/domain/fields/order),
// value/label mapping (aj chýbajúci cennik_code → presný name), in-process cache, Odoo chyba (403) →
// lokálny fallback + warn LEN RAZ + source 'local', config chýba (dev/test) → fallback bez volania Odoo.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setJson2Transport } from '../src/lib/server/odoo-json2';
import {
	fetchGlassTypes,
	_resetGlassTypesCache,
	_resetGlassTypesWarn
} from '../src/lib/server/odoo-glass-types';

function enableEnv() {
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
}

beforeEach(() => {
	_resetGlassTypesCache();
	_resetGlassTypesWarn();
});

afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
});

describe('fetchGlassTypes (#540/#546)', () => {
	it('volá montalu.glass.type search_read s domain active + SPRÁVNE polia + order name', async () => {
		enableEnv();
		let captured: { url: string; body: Record<string, unknown> } | null = null;
		setJson2Transport(async (url, init) => {
			captured = { url: String(url), body: JSON.parse(String(init?.body)) };
			return new Response(
				JSON.stringify([
					{
						name: 'Izolačné 4/16/4',
						category: 'IZO',
						cennik_code: '4/16/4',
						composition: '4-16-4'
					},
					{ name: 'VSG 3.3.1', category: 'VSG', cennik_code: '3.3.1', composition: '' }
				]),
				{ status: 200 }
			);
		});
		const res = await fetchGlassTypes();
		expect(captured!.url).toContain('/json/2/montalu.glass.type/search_read');
		expect(captured!.body.domain).toEqual([['active', '=', true]]);
		expect(captured!.body.fields).toEqual([
			'name',
			'category',
			'cennik_code',
			'composition',
			'active'
		]);
		expect(captured!.body.order).toBe('name');
		expect(res.source).toBe('odoo');
		expect(res.items).toHaveLength(2);
		// cennik_code prítomný → value = cennik_code; composition prítomné → label má ' · '
		expect(res.items[0]).toEqual({
			value: '4/16/4',
			label: 'Izolačné 4/16/4 · 4-16-4',
			category: 'IZO'
		});
		// composition prázdne → label = name (bez ' · ')
		expect(res.items[1]).toEqual({ value: '3.3.1', label: 'VSG 3.3.1', category: 'VSG' });
	});

	it('chýbajúci cennik_code → value = presný name (Odoo páruje názov)', async () => {
		enableEnv();
		setJson2Transport(
			async () =>
				new Response(
					JSON.stringify([
						{ name: 'Číre 6 mm', category: 'jednosklo', cennik_code: '', composition: '6' },
						// bez cennik_code aj bez name → nepoužiteľné, vynechá sa
						{ name: '', category: '', cennik_code: '', composition: '' }
					]),
					{ status: 200 }
				)
		);
		const res = await fetchGlassTypes();
		expect(res.items).toHaveLength(1);
		expect(res.items[0]).toEqual({
			value: 'Číre 6 mm',
			label: 'Číre 6 mm · 6',
			category: 'jednosklo'
		});
	});

	it('cache hit — druhé volanie NEfetchne znova (do 5 min)', async () => {
		enableEnv();
		let calls = 0;
		setJson2Transport(async () => {
			calls++;
			return new Response(
				JSON.stringify([{ name: 'X', category: 'c', cennik_code: 'x', composition: '' }]),
				{ status: 200 }
			);
		});
		await fetchGlassTypes();
		const second = await fetchGlassTypes();
		expect(calls).toBe(1);
		expect(second.source).toBe('odoo');
	});

	it('403 → lokálny fallback (source local, položky > 0) + warn LEN RAZ za proces', async () => {
		vi.stubEnv('LOG_LEVEL', 'warn');
		enableEnv();
		const lines: string[] = [];
		const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
			lines.push(String(chunk));
			return true;
		});
		setJson2Transport(async () => new Response('forbidden', { status: 403 }));
		const r1 = await fetchGlassTypes();
		_resetGlassTypesCache(); // vynúť druhý pokus (cache je fallback) — warn už NEMÁ padnúť
		const r2 = await fetchGlassTypes();
		writeSpy.mockRestore();
		expect(r1.source).toBe('local');
		expect(r2.source).toBe('local');
		expect(r1.items.length).toBeGreaterThan(0);
		// fallback položka má value=label=name, category prázdna
		expect(r1.items[0]!.value).toBe(r1.items[0]!.label);
		const warnLines = lines.filter(
			(l) => l.includes('odoo-glass-types') && l.includes('"level":"warn"')
		);
		expect(warnLines).toHaveLength(1);
	});

	it('config chýba (dev/test) → lokálny fallback bez volania Odoo', async () => {
		vi.stubEnv('ODOO_JSON2_URL', '');
		vi.stubEnv('ODOO_JSON2_API_KEY', '');
		let calls = 0;
		setJson2Transport(async () => {
			calls++;
			return new Response('[]', { status: 200 });
		});
		const r = await fetchGlassTypes();
		expect(r.source).toBe('local');
		expect(calls).toBe(0);
		expect(r.items.length).toBeGreaterThan(0);
	});
});
