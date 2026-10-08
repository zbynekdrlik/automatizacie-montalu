// #606 — kg/m profilu z Odoo (`product.template.montalu_kg_per_m`, číta sa cez `product.product`)
// pre odpad v kg v nárezovom pláne. Lookup 1:1 s Odoo intake nárezáka (odoo-erp
// `sale_order_narezak_cutplan.py`: `search([("default_code","=",kod),("active","=",True)], limit=1)`)
// → AKTÍVNA karta podľa kódu, prvý riadok vyhráva; archivovaná sa ignoruje (doména active=True).
// SAMOSTATNÝ read (pole má `groups=` — dnes 403 pre technický účet appky, sonda 8.10.; v spoločnom
// reade katalógu by 403 zhodilo celý katalóg). Vzor `KodCache`: 3 s timeout, úspech 5 min,
// 403/404/výpadok 60 s bez volania, single-flight, NIKDY nehádže; po sprístupnení sa kg objavia
// samé. Mockuje sa LEN sieťová hranica (`setJson2Transport`). kg/m sú FIXTÚRA.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setJson2Transport } from '../src/lib/server/odoo-json2';
import {
	odooKgNaMPreKody,
	odooProduktyPreKody,
	planSKgNaM,
	zistiKgZdroj,
	_resetOdooKatalogCache
} from '../src/lib/server/odoo-katalog';
import type { MaterialRow } from '../src/lib/server/compute';

function enableEnv() {
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
}

interface Riadok {
	default_code: string;
	montalu_kg_per_m: unknown;
	active: boolean;
}

// fixtúra: ZASP00002 má aj ARCHIVOVANÚ kartu s iným kg/m (konsolidácia kariet, odoo-erp 9076)
const KARTY: Riadok[] = [
	{ default_code: 'ZASP00002', montalu_kg_per_m: 9.99, active: false },
	{ default_code: 'ZASP00002', montalu_kg_per_m: 1.288, active: true },
	{ default_code: 'ZASP00010', montalu_kg_per_m: 0.9, active: true },
	{ default_code: 'ZASP00014', montalu_kg_per_m: false, active: true }, // karta bez kg/m
	{ default_code: 'ZASK00001', montalu_kg_per_m: 0, active: true } // 0 = nevyplnené
];

interface Call {
	url: string;
	body: Record<string, unknown>;
}

/** Odoo mock, ktorý doménu VYHODNOTÍ (default_code in …, active = …) ako ORM. */
function mockOdoo(opts: { status?: number; karty?: Riadok[] } = {}): Call[] {
	const calls: Call[] = [];
	setJson2Transport(async (url, init) => {
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		calls.push({ url: String(url), body });
		if (opts.status && opts.status !== 200)
			return new Response(
				'{"name":"odoo.exceptions.AccessError","message":"field montalu_kg_per_m"}',
				{ status: opts.status }
			);
		const domain = body.domain as [string, string, unknown][];
		const kody = domain.find((d) => d[0] === 'default_code')![2] as string[];
		const aktivne = domain.find((d) => d[0] === 'active');
		// search_read bez active v doméne vracia len aktívne (active_test) — ako Odoo
		const chceAktivne = aktivne ? aktivne[2] === true : true;
		const rows = (opts.karty ?? KARTY).filter(
			(k) => kody.includes(k.default_code) && k.active === chceAktivne
		);
		return new Response(JSON.stringify(rows), { status: 200 });
	});
	return calls;
}

function mk(o: Partial<MaterialRow>): MaterialRow {
	return {
		kod: '',
		nazov: '',
		rezy: [],
		tyce: 1,
		bary: [],
		odpadMm: 100,
		odpadPct: 1,
		barLen: 7500,
		sikmyRez: false,
		...o
	};
}

beforeEach(() => {
	_resetOdooKatalogCache();
});

afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe('odooKgNaMPreKody (#606)', () => {
	it('samostatný product.product search_read: default_code in kódy + active=True, polia [default_code, montalu_kg_per_m]', async () => {
		enableEnv();
		const calls = mockOdoo();
		await odooKgNaMPreKody(['ZASP00002', 'ZASP00010']);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.url).toContain('/json/2/product.product/search_read');
		const domain = calls[0]!.body.domain as [string, string, unknown][];
		expect(domain).toContainEqual(['active', '=', true]);
		const kody = domain.find((d) => d[0] === 'default_code')!;
		expect(kody[1]).toBe('in');
		expect([...(kody[2] as string[])].sort()).toEqual(['ZASP00002', 'ZASP00010']);
		expect(calls[0]!.body.fields).toEqual(['default_code', 'montalu_kg_per_m']);
	});

	it('kg/m z AKTÍVNEJ karty podľa kódu — archivovaná karta s iným kg/m sa ignoruje', async () => {
		enableEnv();
		mockOdoo();
		const r = await odooKgNaMPreKody(['ZASP00002', 'ZASP00010']);
		if (r.zdroj !== 'odoo') throw new Error('čakal som zdroj odoo');
		expect(r.kgNaM.get('ZASP00002')).toBe(1.288);
		expect(r.kgNaM.get('ZASP00010')).toBe(0.9);
	});

	it('karta bez kg/m (false / 0) a neznámy kód → v mape NIE SÚ (kg/m chýba, nikdy 0)', async () => {
		enableEnv();
		mockOdoo();
		const r = await odooKgNaMPreKody(['ZASP00014', 'ZASK00001', 'ZASP99999']);
		if (r.zdroj !== 'odoo') throw new Error('čakal som zdroj odoo');
		expect(r.kgNaM.size).toBe(0);
	});

	it('viac aktívnych kariet s tým istým kódom → PRVÁ vyhráva (ako Odoo search limit=1)', async () => {
		enableEnv();
		mockOdoo({
			karty: [
				{ default_code: 'ZASP00002', montalu_kg_per_m: false, active: true },
				{ default_code: 'ZASP00002', montalu_kg_per_m: 1.288, active: true }
			]
		});
		const r = await odooKgNaMPreKody(['ZASP00002']);
		if (r.zdroj !== 'odoo') throw new Error('čakal som zdroj odoo');
		// prvá karta nemá kg/m → chýba (Odoo intake by tiež zobral prvú)
		expect(r.kgNaM.has('ZASP00002')).toBe(false);
	});

	it('403 (pole kg/m technickému účtu nepovolené — dnešný PROD) → nedostupné; 60 s bez volania; potom samo naskočí', async () => {
		enableEnv();
		vi.useFakeTimers({ toFake: ['Date'] });
		const calls = mockOdoo({ status: 403 });
		expect(await odooKgNaMPreKody(['ZASP00002'])).toEqual({
			zdroj: 'nedostupne',
			dovod: 'chyba'
		});
		vi.setSystemTime(Date.now() + 30 * 1000);
		expect((await odooKgNaMPreKody(['ZASP00010'])).zdroj).toBe('nedostupne');
		expect(calls).toHaveLength(1); // žiadny fan-out počas výpadku
		vi.setSystemTime(Date.now() + 31 * 1000);
		mockOdoo(); // m1 povolil čítanie → bez releasu, bez reštartu
		const r = await odooKgNaMPreKody(['ZASP00002']);
		expect(r.zdroj).toBe('odoo');
		if (r.zdroj === 'odoo') expect(r.kgNaM.get('ZASP00002')).toBe(1.288);
	});

	it('403 na kg/m NEzhodí katalóg artiklov (samostatný read, iná cache)', async () => {
		enableEnv();
		mockOdoo({ status: 403 });
		expect((await odooKgNaMPreKody(['ZASP00002'])).zdroj).toBe('nedostupne');
		setJson2Transport(
			async () =>
				new Response(JSON.stringify([{ id: 1, default_code: 'ZASP00002', name: 'Rámový' }]), {
					status: 200
				})
		);
		expect((await odooProduktyPreKody(['ZASP00002'])).zdroj).toBe('odoo');
	});

	it('úspech sa cachuje 5 min; single-flight súbežných volajúcich', async () => {
		enableEnv();
		vi.useFakeTimers({ toFake: ['Date'] });
		const calls = mockOdoo();
		await Promise.all([odooKgNaMPreKody(['ZASP00002']), odooKgNaMPreKody(['ZASP00002'])]);
		expect(calls).toHaveLength(1);
		vi.setSystemTime(Date.now() + 4 * 60 * 1000);
		await odooKgNaMPreKody(['ZASP00002']);
		expect(calls).toHaveLength(1);
		vi.setSystemTime(Date.now() + 2 * 60 * 1000);
		await odooKgNaMPreKody(['ZASP00002']);
		expect(calls).toHaveLength(2);
	});

	it('integrácia nenakonfigurovaná (dev/test/CI) → nedostupné (config) bez volania', async () => {
		const calls = mockOdoo();
		expect(await odooKgNaMPreKody(['ZASP00002'])).toEqual({
			zdroj: 'nedostupne',
			dovod: 'config'
		});
		expect(calls).toHaveLength(0);
	});
});

describe('planSKgNaM (#606) — obohatenie nárezového plánu', () => {
	it('Odoo odpovedá → kópia plánu, riadky nesú kgNaM (číslo / null = chýba); vstup NEZMENENÝ', async () => {
		enableEnv();
		mockOdoo();
		const material = [
			mk({ kod: 'ZASP00002' }),
			mk({ kod: 'ZASP00014' }),
			mk({ kod: '', nazov: 'Tyč 6000 mm' })
		];
		const plan = { system: 'Robust', material };
		const out = await planSKgNaM(plan);
		expect(out.system).toBe('Robust');
		expect(out.material.map((m) => m.kgNaM)).toEqual([1.288, null, undefined]);
		// pôvodný plán (ide do saveOdpisOdpad / Money ciest) sa nemení
		expect(material.every((m) => !('kgNaM' in m))).toBe(true);
		expect(out).not.toBe(plan);
	});

	it('Odoo 403 / nedostupné → plán bez kgNaM (zobrazenie ako pred #606), nikdy nehádže', async () => {
		enableEnv();
		mockOdoo({ status: 403 });
		const material = [mk({ kod: 'ZASP00002' })];
		const out = await planSKgNaM({ material });
		expect(out.material[0]).not.toHaveProperty('kgNaM');
		expect(out.material[0]).toEqual(material[0]);
	});

	it('poškodený riadok (kód nie je reťazec) → plán bez kg, NIKDY nehádže (volá sa aj po zápise odpisu)', async () => {
		enableEnv();
		mockOdoo();
		const zly = { ...mk({ kod: 'ZASP00002' }), kod: undefined } as unknown as MaterialRow;
		const out = await planSKgNaM({ material: [zly] });
		expect(out.material).toEqual([zly]);
	});

	it('nenakonfigurované (CI) → bez volania, bez kgNaM', async () => {
		const calls = mockOdoo();
		const out = await planSKgNaM({ material: [mk({ kod: 'ZASP00002' })] });
		expect(calls).toHaveLength(0);
		expect(out.material[0]).not.toHaveProperty('kgNaM');
	});
});

describe('zistiKgZdroj (#606) — stav kanála pre /health', () => {
	it('CI bez Odoo → nedostupne; 403 → nedostupne; čitateľné pole → odoo', async () => {
		expect(await zistiKgZdroj()).toBe('nedostupne');
		enableEnv();
		mockOdoo({ status: 403 });
		expect(await zistiKgZdroj()).toBe('nedostupne');
		_resetOdooKatalogCache();
		mockOdoo();
		expect(await zistiKgZdroj()).toBe('odoo');
	});

	it('/health vráti kgZdroj vedľa cenyZdroj (verejné — žiadne kg/m hodnoty)', async () => {
		const health = await import('../src/routes/health/+server');
		const res = await (health.GET as unknown as () => Promise<Response>)();
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.kgZdroj).toBe('nedostupne');
		expect(body).toHaveProperty('cenyZdroj');
		expect(JSON.stringify(body)).not.toContain('montalu_kg_per_m');
	});
});
