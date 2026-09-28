// #578 (Marek Drlík, Odoo úloha 1185, 28.9.): objednávka skla musí rozlíšiť tabule S OTVOROM
// a BEZ — do Odoo tak, aby IZOS cenil „s otvormi" / „bez otvorov". ROZHODNUTÉ (stream): Deluxe
// krajné sklá (N = 1 → 1, inak 2) majú 1 zámkový otvor ⌀46 (trieda d50) na tabuľu, ostatné N − 2
// sú bez otvoru → DVA riadky. Ostatné systémy do skla nevŕtajú → jeden riadok bez otvorov.
// Kontrakt odoo-erp (`montalu_glass_price.py`: price_unit = base × plocha + Σ príplatky, potom × ks;
// `montalu_glass_line_spec.py`: vŕtanie „raz na jednotku") → `holes_qty` je počet otvorov NA TABUĽU.
// Money-NEUTRÁLNE (Deluxe sklo sa v Money neodpisuje).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-otvory-578-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { actions } = await import('../src/routes/zasklenia/+page.server');
const { listSklaPreZakazku, pridajSklaHromadneIdempotentne } =
	await import('../src/lib/server/objednavka-skla');
const { buildGlassOrderForZak } = await import('../src/lib/server/odoo-glass-order-upload');
const { popisPozicie } = await import('../src/lib/objednavka-skla-pozicia');

const USER = { id: 1, username: 'tester', role: 'internal' as const };

function callAction(name: 'pridatSkla' | 'pridatSklaMulti', o: Record<string, string>) {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) f.append(k, v);
	const event = {
		request: new Request('http://x/zasklenia', { method: 'POST', body: f }),
		locals: { user: USER }
	};
	const fn = actions[name] as unknown as (e: typeof event) => Promise<Record<string, unknown>>;
	return fn(event);
}

// Deluxe 4K s 10 mm kaleným sklom (att 39228: „Float kalené 10 mm", 4 ks) — R7016 platí pre Deluxe 10.
const DELUXE_4K = {
	op: '01',
	zakaznik: 'X',
	system: 'Deluxe',
	styl: '4K',
	s: '4000',
	v: '2000',
	sklo: 'Float kalené 10 mm',
	otvaranie: 'P - L',
	farbaKovania: 'R7016'
};

const ROBUST_2K = {
	op: '01',
	zakaznik: 'X',
	system: 'Robust',
	styl: '2K',
	s: '2600',
	v: '2000',
	sklo: 'Izolačné sklo 4/16/4 mliečne',
	otvaranie: 'P - L',
	farbaKovania: 'R7016'
};

const S_OTVOROM = 'Zasklenie 1 — s otvorom ⌀46';

describe('#578 zasklenia → objednávka skla: tabule s otvorom a bez', () => {
	it('Deluxe 4K → DVA riadky: 2 tabule s otvorom (1 × d50) + 2 bez otvoru', async () => {
		const r = await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-578-D4' });
		expect(r.step).toBe('nahlad');
		const rows = listSklaPreZakazku('ZAK-578-D4');
		expect(rows).toHaveLength(2);
		const s = rows.find((p) => p.popis === S_OTVOROM);
		const bez = rows.find((p) => p.popis === 'Zasklenie 1');
		expect(s).toBeDefined();
		expect(bez).toBeDefined();
		expect(s!.pocet).toBe(2);
		expect(s!.spec.holesQty).toBe(1);
		expect(s!.spec.holeSize).toBe('d50');
		expect(bez!.pocet).toBe(2);
		expect(bez!.spec.holesQty).toBe(0);
		expect(bez!.spec.holeSize).toBe('');
		// rovnaké sklo (rozmer + typ) — líši sa len otvor; súčet kusov = N
		expect(s!.sirkaMm).toBe(bez!.sirkaMm);
		expect(s!.vyskaMm).toBe(bez!.vyskaMm);
		expect(s!.typSkla).toBe(bez!.typSkla);
		expect(s!.pocet + bez!.pocet).toBe(4);
		// m² každého riadku zodpovedá JEHO kusom
		expect(s!.m2!).toBeCloseTo((s!.sirkaMm * s!.vyskaMm! * 2) / 1e6, 10);
		expect(bez!.m2!).toBeCloseTo((bez!.sirkaMm * bez!.vyskaMm! * 2) / 1e6, 10);
	});

	it('opakované „Pridať sklá" (dvojklik) neduplikuje ani jeden z dvoch riadkov', async () => {
		await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-578-DUP' });
		const r = await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-578-DUP' });
		expect((r.sklaPridane as { pridane: number }).pridane).toBe(0);
		expect(listSklaPreZakazku('ZAK-578-DUP')).toHaveLength(2);
	});

	it('Robust (do skla sa nevŕta) → jeden riadok, bez otvorov (bez zmeny)', async () => {
		await callAction('pridatSkla', { ...ROBUST_2K, zak: 'ZAK-578-R' });
		const rows = listSklaPreZakazku('ZAK-578-R');
		expect(rows).toHaveLength(1);
		expect(rows[0]!.popis).toBe('Zasklenie 1');
		expect(rows[0]!.pocet).toBe(2);
		expect(rows[0]!.spec.holesQty).toBe(0);
	});

	it('multi: Deluxe posuv sa rozdelí, Slide posuv ostane jeden riadok', async () => {
		const posuvy = JSON.stringify([
			{
				system: 'Deluxe',
				styl: '3K',
				s: '3000',
				v: '2000',
				sklo: 'Float kalené 10 mm',
				otvaranie: 'P - L'
			},
			{
				system: 'Slide',
				styl: '3K',
				s: '3000',
				v: '2000',
				sklo: 'Izolačné sklo 4/8/4 číre',
				otvaranie: 'P - L'
			}
		]);
		await callAction('pridatSklaMulti', {
			zak: 'ZAK-578-M',
			op: '01',
			zakaznik: 'X',
			farbaKovania: 'R7016',
			posuvy
		});
		const rows = listSklaPreZakazku('ZAK-578-M');
		const popisy = rows.map((p) => `${p.popis}|${p.pocet}|${p.spec.holesQty}`).sort();
		expect(popisy).toEqual([
			'Zasklenie 1 — s otvorom ⌀46|2|1',
			'Zasklenie 1|1|0',
			'Zasklenie 2|3|0'
		]);
	});

	it('dedup rozlišuje riadok s otvorom a bez aj pri rovnakej geometrii a kusoch', () => {
		const base = {
			zak: 'ZAK-578-IDEM',
			op: '01',
			modul: 'zasklenia',
			sirkaMm: 1004,
			vyskaMm: 1914,
			pocet: 2,
			typSkla: 'Float kalené 10 mm',
			createdBy: 'test'
		};
		const pridane = pridajSklaHromadneIdempotentne([
			{ ...base, popis: S_OTVOROM, holesQty: 1, holeSize: 'd50' },
			{ ...base, popis: 'Zasklenie 1' }
		]);
		expect(pridane).toBe(2);
		expect(
			pridajSklaHromadneIdempotentne([
				{ ...base, popis: S_OTVOROM, holesQty: 1, holeSize: 'd50' },
				{ ...base, popis: 'Zasklenie 1' }
			])
		).toBe(0);
		expect(listSklaPreZakazku('ZAK-578-IDEM')).toHaveLength(2);
	});
});

describe('#578 popisPozicie ponechá príponu otvoru', () => {
	it('„Zasklenie 3 — s otvorom ⌀46" ostane (nie „Zasklenie 1"), staré „: systém" sa reže', () => {
		expect(popisPozicie('Zasklenie 3 — s otvorom ⌀46', 'zasklenia')).toBe(
			'Zasklenie 3 — s otvorom ⌀46'
		);
		expect(popisPozicie('Zasklenie 3: Deluxe 4K', 'zasklenia')).toBe('Zasklenie 3');
		expect(popisPozicie('Zasklenie 3', 'zasklenia')).toBe('Zasklenie 3');
	});
});

describe('#578 Odoo glass_order — holes_qty na tabuľu', () => {
	it('riadok s otvorom: qty = tabule s otvorom, holes_qty = 1 na tabuľu, hole_size d50', async () => {
		await callAction('pridatSkla', { ...DELUXE_4K, zak: 'ZAK-578-ODOO' });
		const items = buildGlassOrderForZak('ZAK-578-ODOO')!.order.items;
		expect(items).toHaveLength(2);
		const s = items.find((i) => i.description === S_OTVOROM)!;
		const bez = items.find((i) => i.description === 'Zasklenie 1')!;
		expect(s.qty).toBe(2);
		expect(s.holes_qty).toBe(1);
		expect(s.hole_size).toBe('d50');
		expect(bez.qty).toBe(2);
		expect(bez.holes_qty).toBeUndefined();
		expect(bez.hole_size).toBeUndefined();
	});
});
