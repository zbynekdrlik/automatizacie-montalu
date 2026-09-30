// #599 krok 3 (ROZHODNUTÉ main 30.9.): stav skladu z Odoo cez `stock.quant` — súčet `quantity` na
// INTERNÝCH lokáciách (`location_id.usage = 'internal'`) per produkt; technický účet `stock.quant`
// číta (`qty_available` = 403 cez mrp.bom). `odooSkladPreKody` rozširuje `odoo-katalog.ts` (ten istý
// vzor: 3 s timeout, cache, single-flight, výpadok 60 s, warn raz) a NIKDY nehádže.
//
// `skladoveVarovania` (#448) — sonda 30.9. ukázala, že Odoo sklad dnes NIE JE zrkadlo Money (Odoo
// väčšinou VYŠŠIE o nedávnu spotrebu), a Money pri nedostatku ticho zahodí celý doklad. Preto KÝM je
// Money snapshot použiteľný (≤ 7 dní), rozhoduje NIŽŠIA z hodnôt Odoo / snapshot; po cute (snapshot
// zastará) čisté Odoo; Odoo nedostupné → snapshot ako doteraz. Varovanie nesie `zdroj`.
//
// Mockuje sa LEN sieťová hranica (`setJson2Transport`). Kódy = reálne PROD artikly, množstvá
// VYMYSLENÉ (repo je verejné).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-odoo-sklad-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
const snapshotPath = path.join(tmpRoot, 'ceny.json');
process.env.CENY_SNAPSHOT_PATH = snapshotPath;

const { setJson2Transport } = await import('../src/lib/server/odoo-json2');
const { odooSkladPreKody, _resetOdooKatalogCache } = await import('../src/lib/server/odoo-katalog');
const { skladoveVarovania, maybeImportSnapshot } = await import('../src/lib/server/ceny');
const { db } = await import('../src/lib/server/db');

function enableEnv() {
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
}

interface Produkt {
	id: number;
	default_code: string;
	is_storable: boolean;
}
const PRODUKTY: Produkt[] = [
	{ id: 20557, default_code: 'ZASP00014', is_storable: true },
	{ id: 20995, default_code: 'ZASP00024', is_storable: true },
	{ id: 21001, default_code: 'PRP20256', is_storable: true },
	// Odoo ho skladom nesleduje (PROD: BPP00013 `is_storable=false`) → žiadne kvanty
	{ id: 30013, default_code: 'BPP00013', is_storable: false }
];
/** interné kvanty (PKO/Zásoby); ZASP00014 má dva riadky (súčet), PRP20256 žiadny (= 0) */
const KVANTY = [
	{ id: 1, product_id: [20557, '[ZASP00014] Koľajnica 2K'], quantity: 300.5 },
	{ id: 2, product_id: [20557, '[ZASP00014] Koľajnica 2K'], quantity: 164.5 },
	{ id: 3, product_id: [20995, '[ZASP00024] Rámový profil'], quantity: 470.35 }
];

interface Call {
	url: string;
	body: Record<string, unknown>;
}

function mockOdoo(
	opts: { quantStatus?: number; productStatus?: number; kvanty?: typeof KVANTY } = {}
): Call[] {
	const calls: Call[] = [];
	setJson2Transport(async (url, init) => {
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		calls.push({ url: String(url), body });
		const domain = body.domain as [string, string, unknown][];
		if (String(url).includes('/product.product/')) {
			if (opts.productStatus) return new Response('{}', { status: opts.productStatus });
			const kody = domain[0]![2] as string[];
			return new Response(
				JSON.stringify(
					PRODUKTY.filter((p) => kody.includes(p.default_code)).map((p) => ({
						...p,
						name: p.default_code,
						uom_id: [1, 'm'],
						active: true
					}))
				),
				{ status: 200 }
			);
		}
		if (String(url).includes('/stock.quant/')) {
			if (opts.quantStatus) return new Response('{}', { status: opts.quantStatus });
			const ids = domain.find((d) => d[0] === 'product_id')![2] as number[];
			return new Response(
				JSON.stringify(
					(opts.kvanty ?? KVANTY).filter((q) => ids.includes(q.product_id[0] as number))
				),
				{ status: 200 }
			);
		}
		return new Response('{}', { status: 404 });
	});
	return calls;
}

const quantCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/stock.quant/'));

const tick = () => new Promise((r) => setTimeout(r, 15));

/** Money snapshot; `generatedAt` default = teraz (čerstvý, použiteľný) */
async function seed(rows: { kod: string; sklad: number | null }[], generatedAt?: string) {
	await tick();
	fs.writeFileSync(
		snapshotPath,
		JSON.stringify({
			generatedAt: generatedAt ?? new Date().toISOString(),
			rows: rows.map((r) => ({ kod: r.kod, nakupCennik: 1, mena: 'EUR', sklad: r.sklad }))
		})
	);
	maybeImportSnapshot();
}

beforeEach(() => {
	_resetOdooKatalogCache();
	db.prepare('DELETE FROM material_prices').run();
	db.prepare('DELETE FROM material_prices_meta').run();
});

afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe('odooSkladPreKody (#599 — stock.quant)', () => {
	it('číta stock.quant: product_id in ids z product.product + location_id.usage = internal', async () => {
		enableEnv();
		const calls = mockOdoo();
		await odooSkladPreKody(['ZASP00014', 'ZASP00024']);
		const q = quantCalls(calls);
		expect(q).toHaveLength(1);
		expect(q[0]!.url).toContain('/json/2/stock.quant/search_read');
		const domain = q[0]!.body.domain as [string, string, unknown][];
		expect(domain).toContainEqual(['location_id.usage', '=', 'internal']);
		const idDom = domain.find((d) => d[0] === 'product_id')!;
		expect(idDom[1]).toBe('in');
		expect([...(idDom[2] as number[])].sort()).toEqual([20557, 20995]);
		expect(q[0]!.body.fields).toEqual(['product_id', 'quantity']);
		// katalóg stále BEZ qty_available (403 mrp.bom by zhodil celý read)
		for (const c of calls) expect(c.body.fields).not.toContain('qty_available');
	});

	it('sklad = SÚČET interných kvantov; sledovaný bez kvantov = 0; nesledovaný / neznámy kód chýba', async () => {
		enableEnv();
		mockOdoo();
		const r = await odooSkladPreKody([
			'ZASP00014',
			'ZASP00024',
			'PRP20256',
			'BPP00013',
			'NEZNAMY1'
		]);
		expect(r.zdroj).toBe('odoo');
		if (r.zdroj !== 'odoo') return;
		expect(r.sklad.get('ZASP00014')).toBe(465);
		expect(r.sklad.get('ZASP00024')).toBe(470.35);
		expect(r.sklad.get('PRP20256')).toBe(0);
		expect(r.sklad.has('BPP00013')).toBe(false);
		expect(r.sklad.has('NEZNAMY1')).toBe(false);
	});

	it('súčet sa zaokrúhli na 3 desatinné (FP akumulácia 0,1 + 0,2)', async () => {
		enableEnv();
		mockOdoo({
			kvanty: [
				{ id: 1, product_id: [20557, 'x'], quantity: 0.1 },
				{ id: 2, product_id: [20557, 'x'], quantity: 0.2 }
			]
		});
		const r = await odooSkladPreKody(['ZASP00014']);
		expect(r.zdroj === 'odoo' && r.sklad.get('ZASP00014')).toBe(0.3);
	});

	it('nenakonfigurované Odoo → nedostupne/config bez volania', async () => {
		const calls = mockOdoo();
		expect(await odooSkladPreKody(['ZASP00014'])).toEqual({ zdroj: 'nedostupne', dovod: 'config' });
		expect(calls).toHaveLength(0);
	});

	it('stock.quant 403 → nedostupne/chyba (nikdy nehádže), 60 s sa nevolá znova', async () => {
		enableEnv();
		const calls = mockOdoo({ quantStatus: 403 });
		expect(await odooSkladPreKody(['ZASP00014'])).toEqual({ zdroj: 'nedostupne', dovod: 'chyba' });
		expect(await odooSkladPreKody(['ZASP00024'])).toEqual({ zdroj: 'nedostupne', dovod: 'chyba' });
		expect(quantCalls(calls)).toHaveLength(1);
	});

	it('product.product nedostupné → sklad tiež nedostupný (bez stock.quant volania)', async () => {
		enableEnv();
		const calls = mockOdoo({ productStatus: 500 });
		expect(await odooSkladPreKody(['ZASP00014'])).toEqual({ zdroj: 'nedostupne', dovod: 'chyba' });
		expect(quantCalls(calls)).toHaveLength(0);
	});

	it('cache: druhé volanie do 60 s nevolá stock.quant; po 60 s znova (sklad sa hýbe)', async () => {
		enableEnv();
		vi.useFakeTimers({ toFake: ['Date'] });
		const calls = mockOdoo();
		await odooSkladPreKody(['ZASP00014']);
		await odooSkladPreKody(['ZASP00014']);
		expect(quantCalls(calls)).toHaveLength(1);
		vi.setSystemTime(Date.now() + 61_000);
		await odooSkladPreKody(['ZASP00014']);
		expect(quantCalls(calls)).toHaveLength(2);
	});

	it('single-flight: súbežní volajúci zdieľajú JEDEN stock.quant read', async () => {
		enableEnv();
		const calls = mockOdoo();
		const [a, b] = await Promise.all([
			odooSkladPreKody(['ZASP00014']),
			odooSkladPreKody(['ZASP00014'])
		]);
		expect(quantCalls(calls)).toHaveLength(1);
		expect(a).toEqual(b);
	});
});

describe('skladoveVarovania zo stock.quant (#599 krok 3)', () => {
	const pol = (kod: string, mnozstvo: number) => [{ kod, nazov: `Položka ${kod}`, mnozstvo }];

	it('Odoo sklad < požadované (snapshot nemá kód) → varovanie zo zdroja odoo', async () => {
		enableEnv();
		mockOdoo();
		await seed([{ kod: 'INY', sklad: 1 }]);
		expect(await skladoveVarovania(pol('ZASP00024', 500))).toEqual([
			{ kod: 'ZASP00024', nazov: 'Položka ZASP00024', sklad: 470.35, mnozstvo: 500, zdroj: 'odoo' }
		]);
	});

	it('Odoo sledovaný produkt bez kvantov (0) → varovanie, aj keď snapshot kód nemá', async () => {
		enableEnv();
		mockOdoo();
		await seed([{ kod: 'INY', sklad: 1 }]);
		expect(await skladoveVarovania(pol('PRP20256', 2))).toEqual([
			{ kod: 'PRP20256', nazov: 'Položka PRP20256', sklad: 0, mnozstvo: 2, zdroj: 'odoo' }
		]);
	});

	it('čerstvý snapshot NIŽŠÍ než Odoo (Odoo mešká za Money) → varuje snapshot hodnotou', async () => {
		enableEnv();
		mockOdoo();
		// PROD 30.9.: ZASP00024 Money 440.35 / Odoo 470.35 — Money by 460 m ticho zahodil
		await seed([{ kod: 'ZASP00024', sklad: 440.35 }]);
		expect(await skladoveVarovania(pol('ZASP00024', 460))).toEqual([
			{
				kod: 'ZASP00024',
				nazov: 'Položka ZASP00024',
				sklad: 440.35,
				mnozstvo: 460,
				zdroj: 'snapshot'
			}
		]);
	});

	it('Odoo NIŽŠIE než čerstvý snapshot → varuje Odoo hodnotou', async () => {
		enableEnv();
		mockOdoo();
		await seed([{ kod: 'ZASP00024', sklad: 2982.5 }]);
		expect(await skladoveVarovania(pol('ZASP00024', 1000))).toEqual([
			{ kod: 'ZASP00024', nazov: 'Položka ZASP00024', sklad: 470.35, mnozstvo: 1000, zdroj: 'odoo' }
		]);
	});

	it('obe hodnoty stačia → žiadne varovanie', async () => {
		enableEnv();
		mockOdoo();
		await seed([{ kod: 'ZASP00024', sklad: 440.35 }]);
		expect(await skladoveVarovania(pol('ZASP00024', 100))).toEqual([]);
	});

	it('ZASTARANÝ snapshot (> 7 dní, po cute) → rozhoduje len Odoo', async () => {
		enableEnv();
		mockOdoo();
		await seed([{ kod: 'ZASP00024', sklad: 1 }], '2026-01-01T00:00:00Z');
		expect(await skladoveVarovania(pol('ZASP00024', 100))).toEqual([]);
	});

	it('Odoo produkt nesledovaný skladom → rozhoduje snapshot', async () => {
		enableEnv();
		mockOdoo();
		await seed([{ kod: 'BPP00013', sklad: 3 }]);
		expect(await skladoveVarovania(pol('BPP00013', 5))).toEqual([
			{ kod: 'BPP00013', nazov: 'Položka BPP00013', sklad: 3, mnozstvo: 5, zdroj: 'snapshot' }
		]);
	});

	it('Odoo nedostupné (stock.quant 403) → snapshot ako doteraz (aj zastaraný), nikdy chyba', async () => {
		enableEnv();
		mockOdoo({ quantStatus: 403 });
		await seed([{ kod: 'ZASP00024', sklad: 5 }], '2026-01-01T00:00:00Z');
		expect(await skladoveVarovania(pol('ZASP00024', 10))).toEqual([
			{ kod: 'ZASP00024', nazov: 'Položka ZASP00024', sklad: 5, mnozstvo: 10, zdroj: 'snapshot' }
		]);
	});

	it('Odoo nenakonfigurované (CI/dev) → snapshot, žiadne volanie', async () => {
		const calls = mockOdoo();
		await seed([{ kod: 'ZASP00024', sklad: 5 }]);
		expect(await skladoveVarovania(pol('ZASP00024', 10))).toEqual([
			{ kod: 'ZASP00024', nazov: 'Položka ZASP00024', sklad: 5, mnozstvo: 10, zdroj: 'snapshot' }
		]);
		expect(calls).toHaveLength(0);
	});

	it('nulové množstvo sa do Odoo ani nepýta', async () => {
		enableEnv();
		const calls = mockOdoo();
		await seed([]);
		expect(await skladoveVarovania(pol('ZASP00024', 0))).toEqual([]);
		expect(calls).toHaveLength(0);
	});
});
