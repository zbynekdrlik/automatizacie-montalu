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

// #551 HOTFIX: Odoo JSON-2 `search_read` vracia pre NEVYPLNENÉ char polia `false` (nie `null`/`''`).
// `String(false ?? '')` = `"false"` (truthy po `.trim()`) → každý typ bez `cennik_code` dostal
// `value === "false"` → ≥ 2 také riadky = duplicitný `{#each … as t (t.value)}` kľúč → Svelte
// client-side `each_key_duplicate` → hydratácia PROD picker-a padla (0.25.32–0.25.33). Tieto testy
// reprodukujú presný Odoo drôtový tvar (booleany), ktorý CI/E2E fallback nikdy nevideli.
describe('fetchGlassTypes — Odoo `false` pre prázdne polia (#551)', () => {
	it('false cennik_code/composition/category → value = presný name, žiadny label „false", unikátne kľúče', async () => {
		enableEnv();
		setJson2Transport(
			async () =>
				new Response(
					JSON.stringify([
						// Odoo pre NEVYPLNENÉ char polia posiela boolean `false`, nie '' ani null
						{ name: 'Kalené 6 mm', category: false, cennik_code: false, composition: false },
						{ name: 'Kalené 8 mm', category: false, cennik_code: false, composition: false },
						{ name: 'Lepené 33.1', category: false, cennik_code: false, composition: false },
						{
							name: 'Izolačné 4/16/4',
							category: 'IZO',
							cennik_code: '4/16/4',
							composition: '4-16-4'
						},
						{ name: 'VSG 3.3.1', category: 'VSG', cennik_code: '3.3.1', composition: false }
					]),
					{ status: 200 }
				)
		);
		const res = await fetchGlassTypes();
		const values = res.items.map((i) => i.value);
		// riadky bez cennik_code → value = presný name (nie „false")
		expect(values).toContain('Kalené 6 mm');
		expect(values).toContain('Kalené 8 mm');
		expect(values).toContain('Lepené 33.1');
		const codeless = res.items.filter((i) =>
			['Kalené 6 mm', 'Kalené 8 mm', 'Lepené 33.1'].includes(i.value)
		);
		for (const it of codeless) {
			expect(it.value).toBe(it.label); // label = name, žiadne ' · false'
			expect(it.category).toBe(''); // false → prázdna kategória
		}
		// žiadny label nesmie obsahovať reťazec „false" (composition/name nikdy)
		for (const it of res.items) expect(it.label).not.toContain('false');
		// žiadna category nesmie byť reťazec „false"
		for (const it of res.items) expect(it.category).not.toBe('false');
		// KĽÚČOVÁ invarianta pickera: value je unikátny kľúč pre {#each … (t.value)}
		expect(new Set(values).size).toBe(res.items.length);
	});

	it('28-riadková Odoo-tvarová sada (mix false/kódy) → 28 unikátnych kľúčov, žiadne „false"', async () => {
		enableEnv();
		const rows = Array.from({ length: 28 }, (_, i) => {
			const hasCode = i % 3 === 0; // ~tretina má reálny kód, zvyšok Odoo `false`
			return {
				name: `Sklo typ ${String(i).padStart(2, '0')}`,
				category: i % 2 === 0 ? 'IZO' : false,
				cennik_code: hasCode ? `C-${i}` : false,
				composition: i % 4 === 0 ? `${i}-16-${i}` : false
			};
		});
		setJson2Transport(async () => new Response(JSON.stringify(rows), { status: 200 }));
		const res = await fetchGlassTypes();
		expect(res.source).toBe('odoo');
		expect(res.items).toHaveLength(28);
		const values = res.items.map((i) => i.value);
		expect(new Set(values).size).toBe(28); // žiadny duplicitný kľúč → žiadny each_key_duplicate
		for (const it of res.items) {
			expect(it.value).not.toBe('false');
			expect(it.label).not.toContain('false');
			expect(it.category).not.toBe('false');
		}
	});

	it('dva riadky rovnaký cennik_code → jedna položka + warn RAZ za fetch', async () => {
		vi.stubEnv('LOG_LEVEL', 'warn');
		enableEnv();
		const lines: string[] = [];
		const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
			lines.push(String(chunk));
			return true;
		});
		setJson2Transport(
			async () =>
				new Response(
					JSON.stringify([
						{ name: 'Sklo A', category: 'IZO', cennik_code: 'DUP', composition: '' },
						{ name: 'Sklo B', category: 'IZO', cennik_code: 'DUP', composition: '' },
						{ name: 'Sklo C', category: 'VSG', cennik_code: 'UNI', composition: '' }
					]),
					{ status: 200 }
				)
		);
		const res = await fetchGlassTypes();
		writeSpy.mockRestore();
		// duplicitný value 'DUP' sa deduplikuje → 2 položky (DUP raz + UNI)
		expect(res.items).toHaveLength(2);
		const values = res.items.map((i) => i.value);
		expect(new Set(values).size).toBe(res.items.length);
		expect(values).toContain('DUP');
		expect(values).toContain('UNI');
		// warn o duplicite RAZ za fetch, s uvedením duplikovanej hodnoty
		const warnLines = lines.filter(
			(l) => l.includes('odoo-glass-types') && l.includes('"level":"warn"') && l.includes('DUP')
		);
		expect(warnLines).toHaveLength(1);
	});
});
