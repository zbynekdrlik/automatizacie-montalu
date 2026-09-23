// #563 (Patrik, Odoo úloha 625, 23.9.): podklad objednávky skla musí byť použiteľný pre výrobu —
// (a) nadpis = OP + zákazník (nie ZAK), (b) popis riadku = len „Zasklenie N" (bez systému/štýlu —
// „ich nezaujíma kam to dávame"), (c) stĺpec m² vyplnený vopred, (d) typ skla = reálny Money názov
// (testuje `tests/money-nazov-skla-563.test.ts`). Money-NEUTRÁLNE (objednávka u dodávateľa skla).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-podklad-563-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { popisPozicie, m2Tabule, nadpisObjednavky } =
	await import('../src/lib/objednavka-skla-pozicia');
const { actions } = await import('../src/routes/zasklenia/+page.server');
const { load } = await import('../src/routes/objednavka-skla/[zak]/+page.server');
const { listSklaPreZakazku, pridajSklo, pridajSkloManual } =
	await import('../src/lib/server/objednavka-skla');
const { buildGlassOrderForZak } = await import('../src/lib/server/odoo-glass-order-upload');
const { db } = await import('../src/lib/server/db');

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

// Slide 3K s katalógovým IZO sklom (ako zasklenia-akcie-poradie.test.ts) — R7016 kovanie je skladom.
const SLIDE = {
	op: '01',
	zakaznik: 'X',
	system: 'Slide',
	styl: '3K',
	s: '3000',
	v: '2000',
	sklo: 'Izolačné sklo 4/8/4 číre',
	otvaranie: 'P - L',
	farbaKovania: 'R7016'
};

let nextOdpisId = 56301;
function seedOdpis(zak: string, op: string, zakaznik: string, live = 1) {
	const id = nextOdpisId++;
	db.prepare(
		`INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, presunute_at, zak_norm, op_norm)
		 VALUES (?, 'zasklenia', ?, ?, ?, 0, ?, '/t/f.xlsx', 'f.xlsx', ?, '{}', 'test', datetime('now'), NULL, ?, ?)`
	).run(id, zak, op, zakaznik, live, `hash-${id}`, zak, op);
}

function callLoad(zak: string) {
	return load({
		params: { zak },
		url: new URL(`http://x/objednavka-skla/${encodeURIComponent(zak)}`)
	} as unknown as Parameters<typeof load>[0]) as Promise<Record<string, unknown>>;
}

describe('#563 čisté helpery podkladu', () => {
	it('popisPozicie (zasklenia): „Zasklenie N: <systém> <štýl>" → „Zasklenie N"', () => {
		expect(popisPozicie('Zasklenie 1: Robust 3K', 'zasklenia')).toBe('Zasklenie 1');
		expect(popisPozicie('Zasklenie 12: Slide 4K', 'zasklenia')).toBe('Zasklenie 12');
		expect(popisPozicie('Zasklenie 2', 'zasklenia')).toBe('Zasklenie 2');
	});

	it('popisPozicie (zasklenia): starý single riadok „Robust 2K" (bez pozície) → „Zasklenie 1"', () => {
		// review 🟡: single producent spred #563 písal len „<systém> <štýl>" = jediný posuv
		expect(popisPozicie('Robust 2K', 'zasklenia')).toBe('Zasklenie 1');
		expect(popisPozicie('Slide 3K', 'zasklenia')).toBe('Zasklenie 1');
	});

	it('popisPozicie: iné moduly (FIX, pergola, ručné) NEMENÍ — ani text „Zasklenie N: …"', () => {
		// review 🔵: operátorova poznámka v ručnom riadku sa nesmie odrezať
		expect(popisPozicie('Zasklenie 2: prasklina', 'manual')).toBe('Zasklenie 2: prasklina');
		expect(popisPozicie('FIX pole 1 — okno', 'fix')).toBe('FIX pole 1 — okno');
		expect(popisPozicie('Strešné sklo — 4.4.2 číre', 'pergola')).toBe('Strešné sklo — 4.4.2 číre');
		expect(popisPozicie('', 'manual')).toBe('');
	});

	it('m2Tabule = šírka × výška × kusy / 1e6', () => {
		expect(m2Tabule(988, 1958, 3)).toBeCloseTo((988 * 1958 * 3) / 1e6, 10);
		expect(m2Tabule(1000, 1000, 1)).toBe(1);
		expect(m2Tabule(1000, 500, 2)).toBe(1);
	});

	it('nadpisObjednavky: OP + zákazník; bez zákazníka len OP; bez OP → ZAK', () => {
		expect(nadpisObjednavky({ zak: 'ZAK2026571', op: 'OPDL260238', zakaznik: 'Bondiro' })).toBe(
			'OPDL260238 Bondiro'
		);
		expect(nadpisObjednavky({ zak: 'ZAK2026571', op: 'OPDL260238', zakaznik: '' })).toBe(
			'OPDL260238'
		);
		expect(nadpisObjednavky({ zak: 'ZAK2026571', op: '', zakaznik: 'Bondiro' })).toBe('ZAK2026571');
		expect(nadpisObjednavky({ zak: 'ZAK2026571', op: '  ', zakaznik: '  ' })).toBe('ZAK2026571');
	});
});

describe('#563 producenti zasklenia — popis „Zasklenie N" + m² vyplnené', () => {
	it('single posuv: popis „Zasklenie 1" (bez systému/štýlu) + m² = š×v×ks/1e6', async () => {
		await callAction('pridatSkla', { ...SLIDE, zak: 'ZAK-563-S' });
		const rows = listSklaPreZakazku('ZAK-563-S');
		expect(rows).toHaveLength(1);
		const r = rows[0]!;
		expect(r.popis).toBe('Zasklenie 1');
		expect(r.m2).not.toBeNull();
		expect(r.m2!).toBeCloseTo((r.sirkaMm * r.vyskaMm! * r.pocet) / 1e6, 10);
		// uložené v DB (nie len dopočítané pri čítaní) — ide to aj do Odoo `description`
		const raw = db
			.prepare('SELECT popis, m2 FROM objednavka_skla WHERE zak = ?')
			.get('ZAK-563-S') as { popis: string; m2: number | null };
		expect(raw.popis).toBe('Zasklenie 1');
		expect(raw.m2).not.toBeNull();
	});

	it('multi posuv: „Zasklenie 1", „Zasklenie 2" + m² pre každý riadok', async () => {
		const posuvy = JSON.stringify([
			{
				system: 'Slide',
				styl: '3K',
				s: '3000',
				v: '2000',
				sklo: 'Izolačné sklo 4/8/4 číre',
				otvaranie: 'P - L'
			},
			{
				system: 'Slide',
				styl: '3K',
				s: '2800',
				v: '2000',
				sklo: 'Izolačné sklo 4/8/4 číre',
				otvaranie: 'P - L'
			}
		]);
		await callAction('pridatSklaMulti', {
			zak: 'ZAK-563-M',
			op: '01',
			zakaznik: 'X',
			farbaKovania: 'R7016',
			posuvy
		});
		const raw = db
			.prepare(
				'SELECT popis, m2, sirka_mm, vyska_mm, pocet FROM objednavka_skla WHERE zak = ? ORDER BY id'
			)
			.all('ZAK-563-M') as {
			popis: string;
			m2: number | null;
			sirka_mm: number;
			vyska_mm: number;
			pocet: number;
		}[];
		expect(raw.map((r) => r.popis)).toEqual(['Zasklenie 1', 'Zasklenie 2']);
		for (const r of raw) {
			expect(r.m2).not.toBeNull();
			expect(r.m2!).toBeCloseTo((r.sirka_mm * r.vyska_mm * r.pocet) / 1e6, 10);
		}
	});
});

describe('#563 listSklaPreZakazku — m² fallback pre staré riadky', () => {
	it('riadok bez uloženého m² (spred #563) s výškou → m² dopočítané š×v×ks/1e6', () => {
		pridajSklo({
			zak: 'ZAK-563-OLD',
			modul: 'zasklenia',
			popis: 'Zasklenie 1: Robust 3K',
			sirkaMm: 988,
			vyskaMm: 1958,
			pocet: 3,
			typSkla: 'Izolačné sklo 4/16/4 číre',
			createdBy: 'test'
		});
		const [r] = listSklaPreZakazku('ZAK-563-OLD');
		expect(r!.m2).toBeCloseTo((988 * 1958 * 3) / 1e6, 10);
	});

	it('šikmý riadok bez výšky a bez m² → m² ostáva null (honest — bez odhadu)', () => {
		pridajSklo({
			zak: 'ZAK-563-SIKMY',
			modul: 'fix',
			popis: 'FIX pole 1',
			sirkaMm: 1000,
			vyskaMm: null,
			vLavoMm: 1500,
			vPravoMm: 1000,
			pocet: 1,
			typSkla: 'Float 4mm',
			sikmy: true,
			createdBy: 'test'
		});
		const [r] = listSklaPreZakazku('ZAK-563-SIKMY');
		expect(r!.m2).toBeNull();
	});

	it('uložené m² má prednosť (FIX lichobežník nesie vlastnú plochu)', () => {
		pridajSklo({
			zak: 'ZAK-563-FIXM2',
			modul: 'fix',
			popis: 'FIX pole 1',
			sirkaMm: 1000,
			vyskaMm: 1000,
			pocet: 1,
			typSkla: 'Float 4mm',
			m2: 0.777,
			createdBy: 'test'
		});
		const [r] = listSklaPreZakazku('ZAK-563-FIXM2');
		expect(r!.m2).toBe(0.777);
	});

	it('ručný riadok m² = rovnaký vzorec (zdieľaný helper)', () => {
		pridajSkloManual({
			zak: 'ZAK-563-MAN',
			popis: 'V.O.',
			typSkla: 'Float 4mm',
			sirkaMm: 1200,
			vyskaMm: 900,
			pocet: 2,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		const [r] = listSklaPreZakazku('ZAK-563-MAN');
		expect(r!.m2).toBeCloseTo(m2Tabule(1200, 900, 2), 10);
	});
});

describe('#563 load podkladu — nadpis OP + zákazník', () => {
	it('zákazka s odpisom: nadpis = OP z odpisu + zákazník', async () => {
		seedOdpis('ZAK-563-H1', 'OPDL260238', 'Bondiro');
		const d = await callLoad('ZAK-563-H1');
		expect(d.nadpis).toBe('OPDL260238 Bondiro');
	});

	it('servisná zákazka bez odpisu, OP len na riadkoch podkladu → nadpis = len OP', async () => {
		pridajSkloManual({
			zak: 'ZAK-563-H2',
			op: 'OP260999',
			popis: 'servis',
			typSkla: 'Float 4mm',
			sirkaMm: 500,
			vyskaMm: 500,
			pocet: 1,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		const d = await callLoad('ZAK-563-H2');
		expect(d.nadpis).toBe('OP260999');
	});

	it('bez OP → nadpis = ZAK (dnešné správanie)', async () => {
		const d = await callLoad('ZAK-563-H3');
		expect(d.nadpis).toBe('ZAK-563-H3');
	});

	it('load vracia zobrazovacie názvy typov skla pre riadky (fallback = uložený typ)', async () => {
		pridajSklo({
			zak: 'ZAK-563-H4',
			modul: 'zasklenia',
			popis: 'Zasklenie 1',
			sirkaMm: 900,
			vyskaMm: 1800,
			pocet: 1,
			typSkla: 'Float 4mm',
			createdBy: 'test'
		});
		const d = await callLoad('ZAK-563-H4');
		// bez Odoo konfigurácie (test) → zobrazí sa uložený typ, nikdy prázdne
		expect((d.nazvySkiel as Record<string, string>)['Float 4mm']).toBe('Float 4mm');
	});
});

describe('#563 review — staré riadky spred zmeny popisu (idempotencia + Odoo popis)', () => {
	it('opakované „Pridať sklá" po nasadení neduplikuje riadok spred #563 (starý popis „Slide 3K")', async () => {
		// riadok, ako ho uložil single producent PRED #563 (popis = systém + štýl, bez m²)
		await callAction('pridatSkla', { ...SLIDE, zak: 'ZAK-563-DEDUP' });
		db.prepare("UPDATE objednavka_skla SET popis = 'Slide 3K', m2 = NULL WHERE zak = ?").run(
			'ZAK-563-DEDUP'
		);
		const r = await callAction('pridatSkla', { ...SLIDE, zak: 'ZAK-563-DEDUP' });
		expect((r.sklaPridane as { pridane: number }).pridane).toBe(0);
		expect(listSklaPreZakazku('ZAK-563-DEDUP')).toHaveLength(1);
	});

	it('Odoo glass_order description/note starého riadka = pozícia „Zasklenie N" (zhoda s tlačou)', () => {
		pridajSklo({
			zak: 'ZAK-563-ODOO',
			modul: 'zasklenia',
			popis: 'Zasklenie 2: Robust 4K',
			sirkaMm: 998,
			vyskaMm: 1958,
			pocet: 4,
			typSkla: 'Izolačné sklo 4/16/4 číre',
			createdBy: 'test'
		});
		const built = buildGlassOrderForZak('ZAK-563-ODOO');
		const item = built!.order.items[0]!;
		expect(item.description).toBe('Zasklenie 2');
		expect(item.note).toBe('Zasklenie 2');
	});

	it('nový riadok zo zasklení posiela do Odoo description „Zasklenie 1"', async () => {
		await callAction('pridatSkla', { ...SLIDE, zak: 'ZAK-563-ODOO-NEW' });
		const item = buildGlassOrderForZak('ZAK-563-ODOO-NEW')!.order.items[0]!;
		expect(item.description).toBe('Zasklenie 1');
	});

	it('ručný riadok s textom „Zasklenie 2: prasklina" ide do Odoo nezmenený', () => {
		pridajSkloManual({
			zak: 'ZAK-563-ODOO-MAN',
			popis: 'Zasklenie 2: prasklina',
			typSkla: 'Float 4mm',
			sirkaMm: 500,
			vyskaMm: 400,
			pocet: 1,
			rezim: 'rozmery',
			createdBy: 'test'
		});
		const item = buildGlassOrderForZak('ZAK-563-ODOO-MAN')!.order.items[0]!;
		expect(item.description).toBe('Zasklenie 2: prasklina');
	});
});
