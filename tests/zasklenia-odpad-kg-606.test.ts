// #606 — zasklenia: nárezový plán (single aj multi, náhľad aj hotovo) dostane kg/m z Odoo pri
// profiloch → `RozpisRezov` ukáže odpad aj v kg. Money-NEUTRÁLNE: kg/m je LEN zobrazenie — položky
// odpisu, `planHash`, zápis do Money aj uložený odpad (`odpis_odpad`) sú s kg aj bez nich IDENTICKÉ.
// Odoo nedostupné / 403 (dnešný PROD) / CI → plán bez `kgNaM` (zobrazenie ako pred #606).
// Mockuje sa LEN sieťová hranica (`setJson2Transport`): kg/m read odpovedá, všetko ostatné 403.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-odpad-kg-606-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { setJson2Transport } = await import('../src/lib/server/odoo-json2');
const { _resetOdooKatalogCache } = await import('../src/lib/server/odoo-katalog');
const { _resetGlassTypesCache, _resetGlassTypesWarn } =
	await import('../src/lib/server/odoo-glass-types');
const { _resetOdooCenyCache } = await import('../src/lib/server/odoo-prices');
const { actions } = await import('../src/routes/zasklenia/+page.server');
const { listOdpisy } = await import('../src/lib/server/money');
const { getOdpadForOdpisy } = await import('../src/lib/server/odpad-store');
const { db } = await import('../src/lib/server/db');
type MaterialRow = import('../src/lib/server/compute').MaterialRow;

const LOCALS = { user: { id: 1, username: 'tester', role: 'internal' } };

function form(extra: Record<string, string> = {}) {
	const fd = new FormData();
	const base: Record<string, string> = {
		zak: 'ZAK-606',
		op: 'OPDL606',
		zakaznik: 'X',
		system: 'Robust',
		styl: '3K',
		s: '3000',
		v: '2000',
		sklo: 'Izolačné sklo 4/16/4 číre',
		otvaranie: 'P - L',
		farbaKovania: 'R7016'
	};
	for (const [k, v] of Object.entries({ ...base, ...extra })) fd.append(k, v);
	return fd;
}
type Akcia = keyof typeof actions;
async function akcia(name: Akcia, fd: FormData) {
	const a = actions[name] as (e: unknown) => Promise<Record<string, unknown>>;
	return a({
		request: new Request('http://x/zasklenia', { method: 'POST', body: fd }),
		locals: LOCALS
	});
}
const material = (r: Record<string, unknown>, kluc: 'plan' | 'multi' = 'plan') =>
	(r[kluc] as { material: MaterialRow[] }).material;

/** Odoo, kde technický účet číta LEN kg/m (product.product s `montalu_kg_per_m`); zvyšok 403. */
function odooKg(kg: Record<string, number>, opts: { kg403?: boolean } = {}) {
	vi.stubEnv('ODOO_JSON2_URL', 'https://erp.test');
	vi.stubEnv('ODOO_JSON2_API_KEY', 'key');
	setJson2Transport(async (url, init) => {
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		const fields = (body.fields ?? []) as string[];
		if (
			!opts.kg403 &&
			String(url).endsWith('/product.product/search_read') &&
			fields.includes('montalu_kg_per_m')
		) {
			const kody = (body.domain as [string, string, unknown][]).find(
				(d) => d[0] === 'default_code'
			)![2] as string[];
			const rows = kody
				.filter((k) => k in kg)
				.map((k) => ({ default_code: k, montalu_kg_per_m: kg[k] }));
			return new Response(JSON.stringify(rows), { status: 200 });
		}
		return new Response('{"name":"odoo.exceptions.AccessError"}', { status: 403 });
	});
}

beforeEach(() => {
	_resetOdooKatalogCache();
	_resetGlassTypesCache();
	_resetGlassTypesWarn();
	_resetOdooCenyCache();
});
afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
});

describe('#606 zasklenia — kg/m z Odoo k nárezovému plánu', () => {
	it('bez Odoo (CI) → náhľad bez kgNaM (zobrazenie ako pred #606)', async () => {
		const r = await akcia('nahlad', form());
		expect(r.step).toBe('nahlad');
		const m = material(r);
		expect(m.length).toBeGreaterThan(1);
		expect(m.every((x) => !('kgNaM' in x))).toBe(true);
	});

	it('kg/m čitateľné → profily nesú kg/m (chýbajúci kód = null); planHash a položky odpisu NEZMENENÉ', async () => {
		const bez = await akcia('nahlad', form());
		const kody = material(bez).map((x) => x.kod);
		// všetky profily okrem posledného majú kartu s kg/m (fixtúra)
		const kg = Object.fromEntries(kody.slice(0, -1).map((k, i) => [k, 0.5 + i / 10]));
		odooKg(kg);
		const s = await akcia('nahlad', form());
		expect(s.step).toBe('nahlad');
		expect(material(s).map((x) => x.kgNaM)).toEqual(kody.map((k) => kg[k] ?? null));
		// Money-neutrálne: ten istý odpis (hash položiek) aj tie isté mm/tyče
		expect(s.planHash).toBe(bez.planHash);
		expect(s.kovanie).toEqual(bez.kovanie);
		const bezKg = material(s).map(({ kgNaM: _kg, ...rest }) => rest);
		expect(bezKg).toEqual(material(bez));
	});

	it('Odoo 403 na kg/m (dnešný PROD) → náhľad funguje, plán bez kgNaM', async () => {
		odooKg({}, { kg403: true });
		const r = await akcia('nahlad', form());
		expect(r.step).toBe('nahlad');
		expect(material(r).every((x) => !('kgNaM' in x))).toBe(true);
	});

	it('odoslat s kg kanálom: hotovo nesie kg, do Money ide ten istý odpis a ten istý odpad ako bez kg', async () => {
		// referencia: TÁ ISTÁ zákazka, iné OP (dedup je per ZAK+OP), odoslaná BEZ Odoo
		const ZAK = 'ZAK-606-O';
		const bezN = await akcia('nahlad', form({ zak: ZAK, op: 'OPDL606REF' }));
		const ref = await akcia(
			'odoslat',
			form({ zak: ZAK, op: 'OPDL606REF', planHash: String(bezN.planHash) })
		);
		expect(ref.step).toBe('hotovo');
		const kody = material(ref).map((x) => x.kod);
		odooKg(Object.fromEntries(kody.map((k) => [k, 1.288])));
		const n = await akcia('nahlad', form({ zak: ZAK, op: 'OPDL606KG' }));
		// potvrdenie hashom z náhľadu S kg — keby kg menili odpis, akcia by vrátila „vzorce sa zmenili"
		const r = await akcia(
			'odoslat',
			form({ zak: ZAK, op: 'OPDL606KG', planHash: String(n.planHash) })
		);
		expect(r.step).toBe('hotovo');
		expect(material(r).every((x) => x.kgNaM === 1.288)).toBe(true);
		const riadok = (op: string) => listOdpisy().find((o) => o.zak === ZAK && o.op === op)!;
		// odpis do Money: content_hash zapísaného dokladu (ZAK + kódy × množstvá) s kg aj bez nich ROVNAKÝ
		const hash = (op: string) =>
			(
				db.prepare('SELECT content_hash FROM odpis_log WHERE id = ?').get(riadok(op).id) as {
					content_hash: string;
				}
			).content_hash;
		expect(hash('OPDL606KG')).not.toBe('');
		expect(hash('OPDL606KG')).toBe(hash('OPDL606REF'));
		// uložený odpad (Odoo log-note) je s kg aj bez nich IDENTICKÝ — kg sa nikam neukladajú
		const odpad = (op: string) =>
			getOdpadForOdpisy([riadok(op).id])
				.map(({ profilKod, profilNazov, odpadMm, materialMm, tyce }) => ({
					profilKod,
					profilNazov,
					odpadMm,
					materialMm,
					tyce
				}))
				.sort((a, b) => a.profilKod.localeCompare(b.profilKod));
		expect(odpad('OPDL606KG')).toEqual(odpad('OPDL606REF'));
		expect(odpad('OPDL606KG').length).toBe(kody.length);
	});

	it('b2b (veľkoobchod) → plán BEZ kg aj pri živom kanáli (rovnaká hranica ako ceny)', async () => {
		const bez = await akcia('nahlad', form());
		odooKg(Object.fromEntries(material(bez).map((x) => [x.kod, 1.288])));
		const b2b = (await (actions.nahlad as (e: unknown) => Promise<Record<string, unknown>>)({
			request: new Request('http://x/zasklenia', { method: 'POST', body: form() }),
			locals: { user: { id: 2, username: 'vo', role: 'b2b' } }
		})) as Record<string, unknown>;
		expect(b2b.step).toBe('nahlad');
		expect(material(b2b).every((x) => !('kgNaM' in x))).toBe(true);
		// interný v tom istom stave kg dostane (kontrola, že kanál naozaj žije)
		expect(material(await akcia('nahlad', form())).every((x) => x.kgNaM === 1.288)).toBe(true);
	});

	it('multi posuv (zimná záhrada): zlúčený materiál nesie kg/m', async () => {
		const posuv = {
			system: 'Robust',
			styl: '3K',
			s: '3000',
			v: '2000',
			sklo: 'Izolačné sklo 4/16/4 číre',
			otvaranie: 'P - L'
		};
		const fd = () =>
			form({ zak: 'ZAK-606-M', posuvy: JSON.stringify([posuv, { ...posuv, s: '2500' }]) });
		const bez = await akcia('nahladMulti', fd());
		expect(bez.step).toBe('nahladMulti');
		const kody = material(bez, 'multi').map((x) => x.kod);
		odooKg(Object.fromEntries(kody.map((k) => [k, 0.9])));
		const s = await akcia('nahladMulti', fd());
		expect(material(s, 'multi').every((x) => x.kgNaM === 0.9)).toBe(true);
		expect(s.planHash).toBe(bez.planHash);
	});
});
