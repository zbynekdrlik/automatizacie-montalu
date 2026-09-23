// #563 (d): typ skla na podklade objednávky = REÁLNY Money názov (Patrik: „Typ skla musí byť podľa
// reálneho názvu !!!", vzor „Izolačné sklo 4/16/4- číre (Ug=1,1)"). LEN zobrazenie — `money_kod`
// sa NEMENÍ, Money odpis byte-identický. Reťazec: lokálny názov → `glass_types.money_kod` →
// Odoo `product.product` (katalóg syncovaný z Money) `default_code` → `name`; Odoo cenníková
// hodnota → `montalu.glass.type.name`; inak lokálny názov. Mockuje sa LEN sieťová hranica
// (`setJson2Transport`); DB je reálna (temp SQLite so seedovaným katalógom).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-money-nazov-563-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');

const { setJson2Transport } = await import('../src/lib/server/odoo-json2');
const { moneyNazvySkiel, moneyNazovSkla, _resetMoneyNazvyCache } =
	await import('../src/lib/server/money-nazov-skla');
const { _resetGlassTypesCache, _resetGlassTypesWarn } =
	await import('../src/lib/server/odoo-glass-types');

function enableEnv() {
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
}

// Money katalóg (fixture — názvy z Money dokladu v prílohe úlohy 625)
const PRODUKTY = [
	{ default_code: 'TS00016', name: 'Izolačné sklo 4/16/4- číre (Ug=1,1)' },
	{ default_code: 'TS00017', name: 'Izolačné sklo 4/16/4 mliečne' },
	{ default_code: 'TS00021', name: 'Izolačné sklo 4/8/4- číre (Ug=1,1)' },
	{ default_code: 'TS00022', name: 'Izolačné sklo 4/8/4- mliečne' }
];
const GLASS_TYPES = [
	{
		name: 'IZOS DOUBLE 4-16-4 AL',
		category: 'IZO',
		cennik_code: 'IZO-4-16-4-AL',
		composition: '4/16/4',
		active: true
	}
];

interface Captured {
	model: string;
	body: Record<string, unknown>;
}

function mockOdoo(opts: { failProducts?: boolean; hangProducts?: boolean } = {}): Captured[] {
	const calls: Captured[] = [];
	setJson2Transport(async (url, init) => {
		const u = String(url);
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		const model = u.split('/json/2/')[1]!.split('/')[0]!;
		calls.push({ model, body });
		if (model === 'product.product') {
			if (opts.hangProducts) {
				// visí, kým ho neukončí AbortController (timeout) — pomalé-ale-nepadajúce Odoo
				return await new Promise<Response>((_, reject) => {
					init?.signal?.addEventListener('abort', () =>
						reject(new DOMException('aborted', 'AbortError'))
					);
				});
			}
			if (opts.failProducts) return new Response('boom', { status: 500 });
			const domain = body.domain as [string, string, string[]][];
			const kody = domain[0]![2];
			return new Response(JSON.stringify(PRODUKTY.filter((p) => kody.includes(p.default_code))), {
				status: 200
			});
		}
		if (model === 'montalu.glass.type')
			return new Response(JSON.stringify(GLASS_TYPES), { status: 200 });
		return new Response('[]', { status: 200 });
	});
	return calls;
}

beforeEach(() => {
	_resetMoneyNazvyCache();
	_resetGlassTypesCache();
	_resetGlassTypesWarn();
});

afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
});

describe('moneyNazvySkiel (#563)', () => {
	it('lokálny názov s money_kod → Money názov z Odoo product.product (s Ug)', async () => {
		enableEnv();
		mockOdoo();
		expect(await moneyNazovSkla('Izolačné sklo 4/16/4 číre')).toBe(
			'Izolačné sklo 4/16/4- číre (Ug=1,1)'
		);
		expect(await moneyNazovSkla('Izolačné sklo 4/8/4 číre')).toBe(
			'Izolačné sklo 4/8/4- číre (Ug=1,1)'
		);
	});

	it('dávka: JEDEN product.product read pre všetky kódy riadkov (domain default_code in …)', async () => {
		enableEnv();
		const calls = mockOdoo();
		const m = await moneyNazvySkiel([
			'Izolačné sklo 4/16/4 číre',
			'Izolačné sklo 4/16/4 mliečne',
			'Izolačné sklo 4/16/4 číre'
		]);
		expect(m['Izolačné sklo 4/16/4 číre']).toBe('Izolačné sklo 4/16/4- číre (Ug=1,1)');
		expect(m['Izolačné sklo 4/16/4 mliečne']).toBe('Izolačné sklo 4/16/4 mliečne');
		const prod = calls.filter((c) => c.model === 'product.product');
		expect(prod).toHaveLength(1);
		expect(prod[0]!.body.fields).toEqual(['default_code', 'name']);
		const domain = prod[0]!.body.domain as [string, string, string[]][];
		expect(domain[0]![0]).toBe('default_code');
		expect(domain[0]![1]).toBe('in');
		expect([...domain[0]![2]].sort()).toEqual(['TS00016', 'TS00017']);
	});

	it('cache: druhé volanie v TTL nevolá Odoo znova', async () => {
		enableEnv();
		const calls = mockOdoo();
		await moneyNazovSkla('Izolačné sklo 4/16/4 číre');
		await moneyNazovSkla('Izolačné sklo 4/16/4 číre');
		expect(calls.filter((c) => c.model === 'product.product')).toHaveLength(1);
	});

	it('Odoo cenníková hodnota (typ z pickera) → montalu.glass.type name', async () => {
		enableEnv();
		mockOdoo();
		expect(await moneyNazovSkla('IZO-4-16-4-AL')).toBe('IZOS DOUBLE 4-16-4 AL');
	});

	it('sklo bez money_kod a mimo Odoo cenníka → lokálny názov (fallback, nikdy chyba)', async () => {
		enableEnv();
		mockOdoo();
		expect(await moneyNazovSkla('Float sklo 4 mm')).toBe('Float sklo 4 mm');
		expect(await moneyNazovSkla('')).toBe('');
	});

	it('Odoo product.product 500 → lokálny názov (fallback)', async () => {
		enableEnv();
		mockOdoo({ failProducts: true });
		expect(await moneyNazovSkla('Izolačné sklo 4/16/4 číre')).toBe('Izolačné sklo 4/16/4 číre');
	});

	it('timeout (Odoo visí) → lokálny názov v rámci timeoutu (neblokuje page load)', async () => {
		enableEnv();
		mockOdoo({ hangProducts: true });
		const t0 = Date.now();
		const m = await moneyNazvySkiel(['Izolačné sklo 4/16/4 číre'], { timeoutMs: 50 });
		expect(m['Izolačné sklo 4/16/4 číre']).toBe('Izolačné sklo 4/16/4 číre');
		expect(Date.now() - t0).toBeLessThan(2000);
	});

	it('single-flight: súbežné loady zdieľajú JEDEN product.product read', async () => {
		enableEnv();
		const calls = mockOdoo();
		const [a, b] = await Promise.all([
			moneyNazovSkla('Izolačné sklo 4/16/4 číre'),
			moneyNazovSkla('Izolačné sklo 4/16/4 číre')
		]);
		expect(a).toBe('Izolačné sklo 4/16/4- číre (Ug=1,1)');
		expect(b).toBe('Izolačné sklo 4/16/4- číre (Ug=1,1)');
		expect(calls.filter((c) => c.model === 'product.product')).toHaveLength(1);
	});

	it('Odoo `false` v name (prázdne char pole) → lokálny názov, nikdy reťazec „false"', async () => {
		enableEnv();
		setJson2Transport(async (url) => {
			if (String(url).includes('/product.product/'))
				return new Response(JSON.stringify([{ default_code: 'TS00016', name: false }]), {
					status: 200
				});
			return new Response('[]', { status: 200 });
		});
		expect(await moneyNazovSkla('Izolačné sklo 4/16/4 číre')).toBe('Izolačné sklo 4/16/4 číre');
	});

	it('prázdne / medzerové typy sa vrátia bezo zmeny a nevolajú Odoo', async () => {
		enableEnv();
		const calls = mockOdoo();
		const m = await moneyNazvySkiel(['', '  ']);
		expect(m).toEqual({ '': '', '  ': '  ' });
		expect(calls).toHaveLength(0);
	});

	it('integrácia nenakonfigurovaná (dev/test) → lokálny názov bez volania Odoo', async () => {
		const calls = mockOdoo();
		expect(await moneyNazovSkla('Izolačné sklo 4/16/4 číre')).toBe('Izolačné sklo 4/16/4 číre');
		expect(calls).toHaveLength(0);
	});
});
