// #540: fetchGlassTypes — zoznam typov skla z Odoo `montalu.glass.type` pre OBJEDNÁVKOVÝ picker.
// Money-NEUTRÁLNE: len ordering zoznam, výpočtový `glass_types` katalóg (sklo → skloHrubka →
// profily → Money) je NEDOTKNUTÝ. Overuje: search_read tvar (model/domain/fields/order), in-process
// cache (druhé volanie nefetchne), Odoo chyba (403) → lokálny fallback + warn LEN RAZ + source
// 'local', config chýba (dev/test) → lokálny fallback bez volania Odoo.
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

describe('fetchGlassTypes (#540)', () => {
	it('volá montalu.glass.type search_read s domain active + fields + order name', async () => {
		enableEnv();
		let captured: { url: string; body: Record<string, unknown> } | null = null;
		setJson2Transport(async (url, init) => {
			captured = { url: String(url), body: JSON.parse(String(init?.body)) };
			return new Response(
				JSON.stringify([
					{ code: '4/16/4', name: 'Izolačné 4/16/4', composition_spec: '4-16-4' },
					{ code: '3.3.1', name: 'VSG 3.3.1', composition_spec: '' }
				]),
				{ status: 200 }
			);
		});
		const res = await fetchGlassTypes();
		expect(captured!.url).toContain('/json/2/montalu.glass.type/search_read');
		expect(captured!.body.domain).toEqual([['active', '=', true]]);
		expect(captured!.body.fields).toEqual(['code', 'name', 'composition_spec']);
		expect(captured!.body.order).toBe('name');
		expect(res.source).toBe('odoo');
		expect(res.items).toHaveLength(2);
		expect(res.items[0]).toEqual({
			code: '4/16/4',
			name: 'Izolačné 4/16/4',
			composition_spec: '4-16-4'
		});
	});

	it('vynechá riadky bez code (prázdny code = nepoužiteľný pre glass_order.type)', async () => {
		enableEnv();
		setJson2Transport(
			async () =>
				new Response(
					JSON.stringify([
						{ code: '', name: 'Bez kódu', composition_spec: '' },
						{ code: '6mm', name: 'Číre 6 mm', composition_spec: '6' }
					]),
					{ status: 200 }
				)
		);
		const res = await fetchGlassTypes();
		expect(res.items).toHaveLength(1);
		expect(res.items[0]!.code).toBe('6mm');
	});

	it('cache hit — druhé volanie NEfetchne znova (do 5 min)', async () => {
		enableEnv();
		let calls = 0;
		setJson2Transport(async () => {
			calls++;
			return new Response(JSON.stringify([{ code: 'x', name: 'X', composition_spec: '' }]), {
				status: 200
			});
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
