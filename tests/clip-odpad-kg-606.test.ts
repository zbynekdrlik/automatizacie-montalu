// #606 — CLIP pílový plán („Rozpis rezov na tyče — pre pílu", `clip-narez.ts` → `RozpisRezov`)
// dostane kg/m z Odoo pri profiloch (rám ZASP00116, priečka ZASP00125, zasklievací ZASP00119) →
// odpad aj v kg, rovnako ako zasklenia. Money-NEUTRÁLNE: odpis CLIP (per-riadkový ROUNDUP) ani
// `content_hash` dokladu sa s kg nemenia. Odoo nedostupné / 403 / CI → `narez` bez `kgNaM` (žiadny kg
// text). b2b → bez kg (zdieľaná hranica `narez-kg.ts`; /clip je navyše b2b-forbidden v hooks).
// Server render: `RozpisRezov` nad SKUTOČNÝM `narez` z akcie s fixtúrou kg/m. Mockuje sa LEN sieťová
// hranica (`setJson2Transport`): kg/m read odpovedá, všetko ostatné 403. kg/m sú FIXTÚRA.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { render } from 'svelte/server';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-clip-kg-606-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'clip.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { setJson2Transport } = await import('../src/lib/server/odoo-json2');
const { _resetOdooKatalogCache } = await import('../src/lib/server/odoo-katalog');
const { _resetGlassTypesCache, _resetGlassTypesWarn } =
	await import('../src/lib/server/odoo-glass-types');
const clip = await import('../src/routes/clip/+page.server');
const { db } = await import('../src/lib/server/db');
const { listOdpisy } = await import('../src/lib/server/money');
const RozpisRezov = (await import('../src/lib/components/RozpisRezov.svelte')).default;
type MaterialRow = import('../src/lib/server/compute').MaterialRow;

const INTERNY = { id: 1, username: 'tester', role: 'internal' };
// izo B1 (N=2) 3000×1000 — kontraktný vektor (tests/clip-odpis.test.ts)
const IZO_B1 = { typ: 'izo', variant: '2', sirka: '3000', vyska: '1000', ral: '' };
const KG: Record<string, number> = { ZASP00116: 1.1, ZASP00125: 0.6 }; // ZASP00119 kg/m nemá

function ev(body: Record<string, string>, user: object = INTERNY) {
	const f = new FormData();
	for (const [k, v] of Object.entries(body)) f.append(k, v);
	return {
		request: new Request('http://x/clip', { method: 'POST', body: f }),
		locals: { user }
	} as never;
}
const narez = (r: unknown) => (r as { narez: MaterialRow[] }).narez;

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
			const rows = kody.map((k) => ({ default_code: k, montalu_kg_per_m: kg[k] ?? false }));
			return new Response(JSON.stringify(rows), { status: 200 });
		}
		return new Response('{"name":"odoo.exceptions.AccessError"}', { status: 403 });
	});
}

/** HTML → čitateľný text (bez tagov a komentárov, zlúčené medzery). */
const text = (html: string) =>
	html
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();

beforeEach(() => {
	_resetOdooKatalogCache();
	_resetGlassTypesCache();
	_resetGlassTypesWarn();
});
afterEach(() => {
	setJson2Transport(null);
	vi.unstubAllEnvs();
});

describe('#606 CLIP — odpad v kg v pílovom pláne', () => {
	it('bez Odoo (CI) → narez bez kgNaM a rozpis bez akéhokoľvek kg textu', async () => {
		const r = await clip.actions.spocitat(ev({ zak: 'Z606', op: 'OP1', zakaznik: 'X', ...IZO_B1 }));
		expect((r as { step: string }).step).toBe('kontrola');
		expect(narez(r).map((m) => m.kod)).toEqual(['ZASP00116', 'ZASP00125', 'ZASP00119']);
		expect(narez(r).every((m) => !('kgNaM' in m))).toBe(true);
		const h = render(RozpisRezov, { props: { material: narez(r) } }).body;
		expect(text(h)).not.toContain('kg');
	});

	it('kg/m čitateľné → profily nesú kg/m (bez karty = null), rozpis ukáže kg + neúplný súčet', async () => {
		odooKg(KG);
		const r = await clip.actions.spocitat(ev({ zak: 'Z606', op: 'OP1', zakaznik: 'X', ...IZO_B1 }));
		expect(narez(r).map((m) => m.kgNaM)).toEqual([1.1, 0.6, null]);
		const h = render(RozpisRezov, { props: { material: narez(r) } }).body;
		const t = text(h);
		// rám: odpad mm z plánu × 1,1 kg/m (relačne — číslo mm berie z toho istého riadku)
		const ram = narez(r)[0]!;
		const ramKg = String(Math.round((ram.odpadMm / 1000) * 1.1 * 100) / 100).replace('.', ',');
		expect(t).toContain(
			`odpad ${ram.odpadMm} mm (${String(ram.odpadPct).replace('.', ',')} %) · ${ramKg} kg · rez rovný`
		);
		expect(t).toContain('· kg/m chýba · rez rovný');
		expect(t).toMatch(
			/· [\d,]+ kg z [\d,]+ kg \([\d,]+ % hmotnosti\) · neúplné — kg\/m chýba: ZASP00119/
		);
	});

	it('Odoo 403 na kg/m (dnešný PROD) → kontrola funguje, narez bez kgNaM', async () => {
		odooKg({}, { kg403: true });
		const r = await clip.actions.spocitat(ev({ zak: 'Z606', op: 'OP1', zakaznik: 'X', ...IZO_B1 }));
		expect((r as { step: string }).step).toBe('kontrola');
		expect(narez(r).every((m) => !('kgNaM' in m))).toBe(true);
	});

	it('b2b (obrana do hĺbky popri hooks denyliste) → bez kg aj pri živom kanáli', async () => {
		odooKg(KG);
		const b2b = { id: 2, username: 'vo', role: 'b2b' };
		const r = await clip.actions.spocitat(
			ev({ zak: 'Z606', op: 'OP1', zakaznik: 'X', ...IZO_B1 }, b2b)
		);
		expect(narez(r).every((m) => !('kgNaM' in m))).toBe(true);
		// interný v tom istom stave kg dostane (kanál naozaj žije)
		const i = await clip.actions.spocitat(ev({ zak: 'Z606', op: 'OP1', zakaznik: 'X', ...IZO_B1 }));
		expect(narez(i)[0]!.kgNaM).toBe(1.1);
	});

	it('multi (spoločný plán) → kg/m pri zdieľaných profiloch', async () => {
		odooKg(KG);
		const kusy = [
			{ typ: 'izo', variant: 2, sirka: 3000, vyska: 1000, ral: '' },
			{ typ: 'izo', variant: 1, sirka: 1500, vyska: 1000, ral: '' }
		];
		const r = await clip.actions.spocitatMulti(
			ev({ zak: 'Z606M', op: 'OP1', zakaznik: 'X', clipKusy: JSON.stringify(kusy) })
		);
		expect((r as { step: string }).step).toBe('kontrolaMulti');
		expect(narez(r).map((m) => m.kgNaM)).toEqual([1.1, 0.6, null]);
	});

	it('odoslat s kg → hotovo s kg, do Money ide TEN ISTÝ doklad ako bez Odoo (content_hash)', async () => {
		const hlava = { zak: 'Z606-O', zakaznik: 'X', ...IZO_B1 };
		const ref = await clip.actions.odoslat(ev({ ...hlava, op: 'OPREF' }));
		expect((ref as { step: string }).step).toBe('hotovo');
		odooKg(KG);
		const r = await clip.actions.odoslat(ev({ ...hlava, op: 'OPKG' }));
		expect((r as { step: string }).step).toBe('hotovo');
		expect(narez(r).map((m) => m.kgNaM)).toEqual([1.1, 0.6, null]);
		const hash = (op: string) =>
			(
				db
					.prepare('SELECT content_hash FROM odpis_log WHERE id = ?')
					.get(listOdpisy().find((o) => o.zak === 'Z606-O' && o.op === op)!.id) as {
					content_hash: string;
				}
			).content_hash;
		expect(hash('OPKG')).not.toBe('');
		expect(hash('OPKG')).toBe(hash('OPREF'));
	});
});
