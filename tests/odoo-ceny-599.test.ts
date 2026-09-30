// #599 krok ceny (ROZHODNUTÉ owner 30.9. „ano prepnut ceny hned", design Prístup 1): zdroj cien sa
// volí AUTOMATICKY — žiadny env flag. Server skúša Odoo kanál cien:
//   - materiál: `montalu.automatizacie.catalog/get_prices` (s `codes`),
//   - sklo: `montalu.glass.type` pole `price_m2` (samostatný read — pole má cost-visibility `groups`,
//     v spoločnom reade pickera by 403 zhodilo celý picker).
// Keď kanál ODPOVIE (200) → ceny LEN z Odoo; chýbajúca cena = null („cena neznáma"), NIKDY Money
// snapshot per položka; súčty sa priznajú neúplné. Keď kanál neexistuje (404/403, dnešný PROD) alebo
// nie je nakonfigurovaný → dnešné ceny zo snapshotu. Prechod medzi stavmi bez reštartu (cache TTL).
// Rozvin (lakovanie) z Odoo `montalu_rozvin`; `predajPcmo`/`nakupSkladovaKarta` Odoo nevracia → null.
//
// Mockuje sa LEN sieťová hranica (`setJson2Transport`). Ceny VYMYSLENÉ (repo je verejné).
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-odoo-ceny-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
const snapshotPath = path.join(tmpRoot, 'ceny.json');
process.env.CENY_SNAPSHOT_PATH = snapshotPath;

const { setJson2Transport } = await import('../src/lib/server/odoo-json2');
const odooPrices = await import('../src/lib/server/odoo-prices');
const { _resetGlassTypesCache, _resetGlassTypesWarn } =
	await import('../src/lib/server/odoo-glass-types');
const { enrichPolozky, cenaZaM2Zo, cenovyZdroj } = await import('../src/lib/server/ceny');
const { skloCenaPre } = await import('../src/lib/server/sklo-cena');
const { strechaSkloCenaPre } = await import('../src/lib/server/sklo-strecha-cena');
const { db } = await import('../src/lib/server/db');
const health = await import('../src/routes/health/+server');

const { odooCenyPreKody, zistiCenyZdroj, _resetOdooCenyCache } = odooPrices as unknown as {
	odooCenyPreKody: (kody: string[]) => Promise<{ zdroj: string; ceny?: Map<string, unknown> }>;
	zistiCenyZdroj: () => Promise<{ material: string; sklo: string }>;
	_resetOdooCenyCache: () => void;
};

// --- Money snapshot (zdroj „snapshot") — VYMYSLENÉ ceny, odlišné od Odoo -----------------
function writeSnapshot() {
	fs.writeFileSync(
		snapshotPath,
		JSON.stringify({
			generatedAt: new Date().toISOString(),
			rows: [
				{
					kod: 'ZASP00014',
					nakupCennik: 5,
					nakupPoslednaFaktura: 6,
					predajVo: 9,
					predajPcmo: 11,
					mena: 'EUR',
					sklad: 100,
					rozvin: 0.1
				},
				{
					kod: 'ZASP00002',
					nakupCennik: 4,
					nakupPoslednaFaktura: 5,
					predajVo: 7,
					mena: 'EUR',
					sklad: 50,
					rozvin: 0.2
				},
				{
					kod: 'BPK202535',
					nakupCennik: null,
					nakupSkladovaKarta: 3,
					nakupPoslednaFaktura: null,
					predajVo: null,
					predajPcmo: 8,
					mena: 'EUR',
					sklad: 10
				},
				{
					kod: 'TS00016',
					nakupCennik: 40,
					nakupPoslednaFaktura: null,
					predajVo: null,
					mena: 'EUR',
					sklad: 5
				},
				{
					kod: 'TS00014',
					nakupCennik: 55,
					nakupPoslednaFaktura: null,
					predajVo: null,
					mena: 'EUR',
					sklad: 5
				}
			]
		})
	);
}

// --- Odoo `get_prices` — ZASP00014 + TS00016 + BPK202535 má, ZASP00002 NEMÁ -------------
const ODOO_ROWS = [
	{
		kod: 'ZASP00014',
		nakupCennik: 7.25,
		nakupPoslednaFaktura: 6.5,
		predajVo: 12,
		mena: 'EUR',
		sklad: 470.35,
		rozvin: 0.183
	},
	{
		kod: 'BPK202535',
		nakupCennik: null,
		nakupPoslednaFaktura: 2.2,
		predajVo: 4,
		mena: 'EUR',
		sklad: false,
		rozvin: null
	},
	{
		kod: 'TS00016',
		nakupCennik: 44.5,
		nakupPoslednaFaktura: null,
		predajVo: null,
		mena: 'EUR',
		sklad: 3,
		rozvin: null
	}
];

// --- Odoo `montalu.glass.type` (picker read + price read) --------------------------------
const GLASS_TYPES = [
	{
		id: 1,
		name: 'Izolačné sklo 4/16/4 číre',
		category: 'izolacne',
		cennik_code: 'IZ-4164',
		composition: '4/16/4',
		total_thickness_mm: 24,
		active: true,
		price_m2: 38.9
	},
	{
		id: 2,
		name: 'VSG 3.3.1 číre',
		category: 'vsg',
		cennik_code: 'VSG-331',
		composition: '3.3.1',
		total_thickness_mm: 7,
		active: true,
		price_m2: 0
	},
	// review #599: ROVNAKÝ názov, rôzny cenníkový kód a cena (napr. rámik AL vs TH) — cena sa musí
	// priradiť podľa `value` pickera (cennik_code), nie podľa názvu
	{
		id: 3,
		name: 'VSG 4.4.2 číre',
		category: 'vsg',
		cennik_code: 'VSG-442-A',
		composition: '4.4.2',
		total_thickness_mm: 9,
		active: true,
		price_m2: 50
	},
	{
		id: 4,
		name: 'VSG 4.4.2 číre',
		category: 'vsg',
		cennik_code: 'VSG-442-B',
		composition: '4.4.2',
		total_thickness_mm: 9,
		active: true,
		price_m2: 60
	},
	// zdieľaný cennik_code (PROD „001") → picker `value = name` pre oboch nositeľov
	{
		id: 5,
		name: 'ESG 6 číre',
		category: 'esg',
		cennik_code: 'DUP',
		composition: '6',
		total_thickness_mm: 6,
		active: true,
		price_m2: 30
	},
	{
		id: 6,
		name: 'ESG 8 číre',
		category: 'esg',
		cennik_code: 'DUP',
		composition: '8',
		total_thickness_mm: 8,
		active: true,
		price_m2: 35
	}
];

interface Call {
	url: string;
	body: Record<string, unknown>;
}

type Stav = 200 | 403 | 404 | 'down';
function mockOdoo(opts: { ceny?: Stav; sklo?: Stav } = {}): Call[] {
	const calls: Call[] = [];
	const odpoved = (stav: Stav, data: unknown) => {
		if (stav === 'down') throw new Error('ECONNREFUSED');
		if (stav !== 200) return new Response('{"message":"x"}', { status: stav });
		return new Response(JSON.stringify(data), { status: 200 });
	};
	setJson2Transport(async (url, init) => {
		const u = String(url);
		const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
		calls.push({ url: u, body });
		if (u.includes('/montalu.automatizacie.catalog/get_prices')) {
			const codes = (body.codes as string[] | undefined) ?? ODOO_ROWS.map((r) => r.kod);
			return odpoved(opts.ceny ?? 200, {
				generatedAt: '2026-09-30T10:00:00Z',
				rows: ODOO_ROWS.filter((r) => codes.includes(r.kod)),
				total: 3
			});
		}
		if (u.includes('/montalu.glass.type/search_read')) {
			const fields = (body.fields as string[]) ?? [];
			if (fields.includes('price_m2'))
				return odpoved(
					opts.sklo ?? 200,
					// ako Odoo search_read: id + LEN vyžiadané polia
					GLASS_TYPES.map((t) =>
						Object.fromEntries([
							['id', t.id],
							...fields.map((f) => [f, (t as Record<string, unknown>)[f]])
						])
					)
				);
			// picker read (bez price_m2) je vždy dostupný
			return new Response(JSON.stringify(GLASS_TYPES.map(({ price_m2: _p, ...t }) => t)), {
				status: 200
			});
		}
		return new Response('{}', { status: 404 });
	});
	return calls;
}

function enableEnv() {
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
}

const cenyCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/get_prices'));

beforeEach(() => {
	db.exec('DELETE FROM material_prices; DELETE FROM material_prices_meta;');
	writeSnapshot();
	_resetOdooCenyCache();
	_resetGlassTypesCache();
	_resetGlassTypesWarn();
});

afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

const POLOZKY = [
	{ kod: 'ZASP00014', nazov: 'Koľajnica', qty: 2, mj: 'm' },
	{ kod: 'ZASP00002', nazov: 'Profil mimo Odoo', qty: 3, mj: 'm' },
	{ kod: 'BPK202535', nazov: 'Krytka', qty: 1, mj: 'ks' }
];

describe('manuálny flag ODOO_PRICES_ENABLED je preč (#599 — automatické prepnutie)', () => {
	it('odoo-prices.ts už neexportuje isOdooPricesEnabled a src flag nečíta', () => {
		expect((odooPrices as Record<string, unknown>).isOdooPricesEnabled).toBeUndefined();
		const src = fs.readFileSync(path.resolve('src/lib/server/odoo-prices.ts'), 'utf8');
		expect(src).not.toMatch(/process\.env\.ODOO_PRICES_ENABLED/);
		const ceny = fs.readFileSync(path.resolve('src/lib/server/ceny.ts'), 'utf8');
		expect(ceny).not.toMatch(/isOdooPricesEnabled/);
	});
});

describe('odooCenyPreKody — kanál get_prices', () => {
	it('bez konfigurácie: nedostupné, žiadne volanie', async () => {
		const calls = mockOdoo();
		const r = await odooCenyPreKody(['ZASP00014']);
		expect(r.zdroj).toBe('nedostupne');
		expect(calls).toHaveLength(0);
	});

	it('200: posiela `codes` a vráti LEN riadky, ktoré Odoo pozná', async () => {
		enableEnv();
		const calls = mockOdoo();
		const r = await odooCenyPreKody(['ZASP00014', 'ZASP00002']);
		expect(r.zdroj).toBe('odoo');
		expect([...r.ceny!.keys()]).toEqual(['ZASP00014']);
		expect(cenyCalls(calls)[0]!.body.codes).toEqual(['ZASP00014', 'ZASP00002']);
	});

	it('404 (kanál neexistuje — dnešný PROD) aj 403 → nedostupné', async () => {
		enableEnv();
		mockOdoo({ ceny: 404 });
		expect((await odooCenyPreKody(['ZASP00014'])).zdroj).toBe('nedostupne');
		_resetOdooCenyCache();
		mockOdoo({ ceny: 403 });
		expect((await odooCenyPreKody(['ZASP00014'])).zdroj).toBe('nedostupne');
	});

	it('odpoveď bez poľa `rows` = nedostupné (nie „Odoo nemá žiadne ceny")', async () => {
		enableEnv();
		setJson2Transport(async () => new Response('true', { status: 200 }));
		expect((await odooCenyPreKody(['ZASP00014'])).zdroj).toBe('nedostupne');
	});

	it('cache: druhé volanie tých istých kódov ide z cache (1 request)', async () => {
		enableEnv();
		const calls = mockOdoo();
		await odooCenyPreKody(['ZASP00014']);
		await odooCenyPreKody(['ZASP00014']);
		expect(cenyCalls(calls)).toHaveLength(1);
	});
});

describe('enrichPolozky — zdroj cien Odoo vs Money snapshot', () => {
	it('kanál odpovedá: ceny LEN z Odoo, chýbajúca cena null (NIE snapshot), súčty neúplné', async () => {
		enableEnv();
		mockOdoo();
		const r = await enrichPolozky(POLOZKY);
		expect(r.zdroj).toBe('odoo');
		const [a, b, c] = r.radky;
		// ZASP00014 z Odoo (snapshot má 5/6/9)
		expect(a!.nakupCennik).toBe(7.25);
		expect(a!.nakupPoslednaFaktura).toBe(6.5);
		expect(a!.predajVo).toBe(12);
		expect(a!.sklad).toBe(470.35);
		// rozvin z Odoo montalu_rozvin (predtým vynútený null)
		expect(a!.rozvin).toBe(0.183);
		// predajPcmo Odoo nevracia → null, NIE Money (snapshot má 11)
		expect(a!.predajPcmo).toBeNull();
		// ZASP00002 Odoo nepozná → všetko neznáme, žiadny Money fallback (snapshot má 4/5/7)
		expect(b!.nakupCennik).toBeNull();
		expect(b!.nakupPoslednaFaktura).toBeNull();
		expect(b!.predajVo).toBeNull();
		expect(b!.sklad).toBeNull();
		expect(b!.rozvin).toBeNull();
		// BPK: nakupSkladovaKarta Odoo nevracia → nákup cenník null (snapshot karta 3 sa NEBERIE);
		// predajVo non-ZASP sa nuluje ako pri snapshote; sklad `false` → null
		expect(c!.nakupCennik).toBeNull();
		expect(c!.predajVo).toBeNull();
		expect(c!.predajPcmo).toBeNull();
		expect(c!.sklad).toBeNull();
		expect(r.sucty.nakupCennik.kompletne).toBe(false);
		expect(r.sucty.nakupCennik.suma).toBe(14.5);
		// lakovanie počíta z Odoo rozvinu
		expect(r.lakovanie.radky.find((x) => x.kod === 'ZASP00014')?.rozvin).toBe(0.183);
	});

	it('kanál 404 (dnešný PROD): dnešné ceny zo snapshotu', async () => {
		enableEnv();
		mockOdoo({ ceny: 404 });
		const r = await enrichPolozky(POLOZKY);
		expect(r.zdroj).toBe('snapshot');
		expect(r.radky[0]!.nakupCennik).toBe(5);
		expect(r.radky[0]!.predajPcmo).toBe(11);
		expect(r.radky[1]!.nakupCennik).toBe(4);
		expect(r.radky[2]!.nakupCennik).toBe(3); // skladová karta fallback (#506) ostáva pre snapshot
	});

	it('kanál 403 aj nenakonfigurované: snapshot', async () => {
		enableEnv();
		mockOdoo({ ceny: 403 });
		expect((await enrichPolozky(POLOZKY)).zdroj).toBe('snapshot');
		vi.unstubAllEnvs();
		_resetOdooCenyCache();
		const r = await enrichPolozky(POLOZKY);
		expect(r.zdroj).toBe('snapshot');
		expect(r.radky[0]!.nakupCennik).toBe(5);
	});

	it('prechod 404 → 200 bez reštartu (po výpadkovom okne 60 s), a späť pri výpadku', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
		enableEnv();
		mockOdoo({ ceny: 404 });
		expect((await enrichPolozky(POLOZKY)).zdroj).toBe('snapshot');
		// Odoo strana nasadí kanál (8706) — appka ho sama zistí po výpadkovom okne
		mockOdoo({ ceny: 200 });
		vi.setSystemTime(new Date('2026-09-30T10:01:01Z'));
		const r = await enrichPolozky(POLOZKY);
		expect(r.zdroj).toBe('odoo');
		expect(r.radky[0]!.nakupCennik).toBe(7.25);
		// po expirácii cache (5 min) kanál zmizne → späť na snapshot
		mockOdoo({ ceny: 404 });
		vi.setSystemTime(new Date('2026-09-30T10:07:00Z'));
		expect((await enrichPolozky(POLOZKY)).zdroj).toBe('snapshot');
	});

	it('Money snapshot tabuľka sa Odoo cenami NEPREPISUJE (validácia kódov/sklad ju čítajú ďalej)', async () => {
		enableEnv();
		mockOdoo();
		await enrichPolozky(POLOZKY);
		const row = db
			.prepare('SELECT nakup_cennik AS n, sklad FROM material_prices WHERE kod = ?')
			.get('ZASP00014') as { n: number; sklad: number };
		expect(row).toEqual({ n: 5, sklad: 100 });
	});
});

describe('cena skla — price_m2 / get_prices / snapshot', () => {
	const plan = (variant: string, system = 'Robust') => ({
		label: '',
		system,
		variant,
		sirka: 1000,
		vyska: 1000,
		pocet: 2
	});

	it('price_m2 čitateľné: Odoo typ (priamo value) → €/m² z Odoo, zdroj odoo', async () => {
		enableEnv();
		mockOdoo({ ceny: 404 });
		const r = await skloCenaPre([plan('IZ-4164')]);
		expect(r.zdroj).toBe('odoo');
		expect(r.radky[0]!.eurM2).toBe(38.9);
		expect(r.radky[0]!.spolu).toBe(77.8);
	});

	it('price_m2 čitateľné: lokálny variant jednoznačne spárovaný na Odoo typ → Odoo cena (nie snapshot 40)', async () => {
		enableEnv();
		mockOdoo({ ceny: 404 });
		const r = await skloCenaPre([plan('Izolačné sklo 4/16/4 číre')]);
		expect(r.zdroj).toBe('odoo');
		expect(r.radky[0]!.eurM2).toBe(38.9);
	});

	it('review #599: rovnaký názov, rôzny cenníkový kód → každý typ vlastná cena (kľúč = value pickera)', async () => {
		enableEnv();
		mockOdoo({ ceny: 404 });
		const r = await skloCenaPre([plan('VSG-442-A'), plan('VSG-442-B')]);
		expect(r.radky.map((x) => x.eurM2)).toEqual([50, 60]);
	});

	it('review #599: zdieľaný cennik_code → value = name, cena podľa názvu', async () => {
		enableEnv();
		mockOdoo({ ceny: 404 });
		const r = await skloCenaPre([plan('ESG 6 číre'), plan('ESG 8 číre')]);
		expect(r.radky.map((x) => x.eurM2)).toEqual([30, 35]);
	});

	it('price_m2 = 0 → cena neznáma (honest-null), súhrn neúplný', async () => {
		enableEnv();
		mockOdoo({ ceny: 404 });
		const r = await skloCenaPre([plan('VSG-331')]);
		expect(r.radky[0]!.eurM2).toBeNull();
		expect(r.kompletne).toBe(false);
	});

	it('price_m2 403, get_prices 200: TS kód z Odoo get_prices (IZOS), zdroj odoo', async () => {
		enableEnv();
		mockOdoo({ sklo: 403 });
		const r = await skloCenaPre([plan('Izolačné sklo 4/16/4 číre')]);
		expect(r.zdroj).toBe('odoo');
		expect(r.radky[0]!.eurM2).toBe(44.5);
	});

	it('oba kanály 403/404 (dnešný PROD): snapshot ako doteraz', async () => {
		enableEnv();
		mockOdoo({ ceny: 404, sklo: 403 });
		const r = await skloCenaPre([plan('Izolačné sklo 4/16/4 číre')]);
		expect(r.zdroj).toBe('snapshot');
		expect(r.radky[0]!.eurM2).toBe(40);
	});

	it('strešné sklo pergoly: get_prices odpovedá, TS kód v Odoo chýba → null, NIE snapshot 55', async () => {
		enableEnv();
		mockOdoo();
		const r = await strechaSkloCenaPre('IZO 4.4.2-8-6 číre', 10);
		expect(r!.zdroj).toBe('odoo');
		expect(r!.eurM2).toBeNull();
		expect(r!.cenaSpolu).toBeNull();
	});

	it('cenaZaM2Zo (TS kód) pri Odoo zdroji berie get_prices', async () => {
		enableEnv();
		mockOdoo();
		expect(cenaZaM2Zo(await cenovyZdroj(['TS00016']), 'TS00016')?.eurM2).toBe(44.5);
	});
});

describe('zistiCenyZdroj + /health cenyZdroj', () => {
	it('nenakonfigurované (CI): material aj sklo = snapshot', async () => {
		expect(await zistiCenyZdroj()).toEqual({ material: 'snapshot', sklo: 'snapshot' });
	});

	it('get_prices 404 + price_m2 403 → snapshot/snapshot; po sprístupnení odoo/odoo', async () => {
		enableEnv();
		mockOdoo({ ceny: 404, sklo: 403 });
		expect(await zistiCenyZdroj()).toEqual({ material: 'snapshot', sklo: 'snapshot' });
		_resetOdooCenyCache();
		mockOdoo();
		expect(await zistiCenyZdroj()).toEqual({ material: 'odoo', sklo: 'odoo' });
	});

	it('/health vráti cenyZdroj (verejné — bez cien)', async () => {
		const res = await (health.GET as unknown as () => Promise<Response>)();
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.cenyZdroj).toEqual({ material: 'snapshot', sklo: 'snapshot' });
		expect(body).toHaveProperty('version');
	});
});

describe('log pri zmene zdroja cien', () => {
	afterAll(() => {
		delete process.env.LOG_LEVEL;
	});

	it('zaloguje info „zdroj cien" pri prechode snapshot → odoo (raz, nie pri každom volaní)', async () => {
		process.env.LOG_LEVEL = 'info';
		const lines: string[] = [];
		const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
			lines.push(String(chunk));
			return true;
		});
		try {
			enableEnv();
			mockOdoo({ ceny: 404 });
			await enrichPolozky(POLOZKY);
			_resetOdooCenyCache();
			mockOdoo();
			await enrichPolozky(POLOZKY);
			await enrichPolozky(POLOZKY);
		} finally {
			spy.mockRestore();
		}
		const zmeny = lines.filter((l) => l.includes('zdroj cien') && l.includes('"na":"odoo"'));
		expect(zmeny).toHaveLength(1);
	});
});
