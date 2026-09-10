import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';

// TEST režim + vlastný Money priečinok. `MONEY_TEST_DIR`/`MONEY_LIVE` MUSIA byť nastavené
// PRED dynamickým importom route/money — vzor tests/clip-odpis.test.ts. DATABASE_PATH by
// izoloval aj auto-setup; nastavujeme ho explicitne kvôli jednote timingu.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-fix-cad-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'fix.db');
process.env.MONEY_LIVE = '0'; // TEST — do ostrého Money NIČ
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const fixCad = await import('../src/lib/server/fix-cad');
const cadOdpis = await import('../src/lib/server/cad-odpis');
const fixCatalog = await import('../src/lib/server/fix-catalog');
const route = await import('../src/routes/fix/cad/+page.server');
const pergolaRoute = await import('../src/routes/pergola/+page.server');
const { listOdpisy } = await import('../src/lib/server/money');

// FIX CAD text s kódmi 16xxx — reálny tvar z Patrikovho CAD (ZAK2026408 / OPDL260153).
// Kódy sú PRIAMO Money kódy (nie mapovanie cez CODE_MAP ako pergola 18xxx → PRP).
const FIX_CAD = [
	'16101 RAMOVY PROFIL 1 109.80',
	'16101 RAMOVY PROFIL 1 301.00',
	'16101 RAMOVY PROFIL 1 2072.48',
	'16101 RAMOVY PROFIL 1 2060.00',
	'16104 ZASKLIEVACI PROFIL 36mm 2 212.00'
].join('\n');
// PERGOLA CAD text (18xxx kódy) — pre backward-compatibility a cross-modul testy.
const PERGOLA_CAD = ['18004 PRIECKOVY PROFIL 105 9 3871', '18018 ZLABOVY PROFIL 140 2 4990'].join(
	'\n'
);

function fd(body: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(body)) f.append(k, v);
	return f;
}
function ev(body: Record<string, string>) {
	return {
		request: new Request('http://x/fix/cad', { method: 'POST', body: fd(body) }),
		locals: { user: { id: 1, username: 'tester', role: 'internal' } }
	} as never;
}

describe('fix-catalog — transformFix', () => {
	it('FIX kódy (16xxx) sa rozpoznajú ako platné Money kódy', () => {
		const rows = [
			{ code: '16101', name: 'RAMOVY PROFIL', qty: 1, cut_mm: 2000 },
			{ code: '16104', name: 'ZASKLIEVACI PROFIL 36mm', qty: 2, cut_mm: 500 }
		];
		const r = fixCatalog.transformFix(rows);
		expect(r.unresolved).toEqual([]);
		expect(r.items).toHaveLength(2);
		expect(r.items[0]!.kod).toBe('16101');
		expect(r.items[0]!.qty).toBe(2); // 2000mm = 2m
		expect(r.items[0]!.mj).toBe('m');
		expect(r.items[1]!.kod).toBe('16104');
		expect(r.items[1]!.qty).toBe(1); // 2x500mm = 1000mm = 1m
	});

	it('neznámy kód → unresolved (honest chyba)', () => {
		const rows = [{ code: '99999', name: 'NEZNAMY', qty: 1, cut_mm: 1000 }];
		const r = fixCatalog.transformFix(rows);
		expect(r.unresolved).toHaveLength(1);
		expect(r.unresolved[0]!.cad).toBe('99999');
		expect(r.items).toHaveLength(0);
	});

	it('viacero rezov rovnakého kódu sa sčítajú', () => {
		const rows = [
			{ code: '16101', name: 'RAMOVY PROFIL', qty: 1, cut_mm: 1000 },
			{ code: '16101', name: 'RAMOVY PROFIL', qty: 1, cut_mm: 2000 },
			{ code: '16101', name: 'RAMOVY PROFIL', qty: 2, cut_mm: 500 }
		];
		const r = fixCatalog.transformFix(rows);
		expect(r.items).toHaveLength(1);
		// 1000 + 2000 + 2x500 = 4000mm = 4m
		expect(r.items[0]!.qty).toBe(4);
	});
});

describe('fix-cad modul — cadOdpisView s FIX opts (bez DB)', () => {
	it('cadOdpisView s FIX opts rozparsuje FIX kódy (16xxx)', () => {
		const { error, view } = cadOdpis.cadOdpisView(
			{ zak: 'F1', op: 'OP1', zakaznik: 'Z', cad: FIX_CAD, caka: false },
			undefined,
			fixCad.FIX_CAD_OPTS
		);
		expect(error).toBeNull();
		expect(view).not.toBeNull();
		expect(view!.nonzero.length).toBeGreaterThan(0);
		// FIX kódy sú PRIAMO Money kódy (nie PRP mapovanie)
		const codes = view!.nonzero.map((p) => p.kod);
		expect(codes).toContain('16101');
		expect(codes).toContain('16104');
	});

	it('nenamapovaný CAD kód → TVRDÁ chyba (nikdy tichý výpadok materiálu)', () => {
		const { error, view } = cadOdpis.cadOdpisView(
			{ zak: 'F1', op: 'OP1', zakaznik: 'Z', cad: '999999 NEZNAMY PROFIL 1 1000', caka: false },
			undefined,
			fixCad.FIX_CAD_OPTS
		);
		expect(error).toMatch(/Nenamapované CAD kódy.*999999/);
		expect(view).toBeNull();
	});

	it('nezmyselný vstup (zlý formát riadku) → chyba', () => {
		const { error } = cadOdpis.cadOdpisView(
			{ zak: 'F1', op: 'OP1', zakaznik: 'Z', cad: 'toto nie je nárez', caka: false },
			undefined,
			fixCad.FIX_CAD_OPTS
		);
		expect(error).toMatch(/prázdny alebo v zlom formáte/);
	});

	it('pergola kódy (18xxx) cez FIX opts → Nenamapované (FIX nepozná pergola kódy)', () => {
		const { error } = cadOdpis.cadOdpisView(
			{ zak: 'F1', op: 'OP1', zakaznik: 'Z', cad: PERGOLA_CAD, caka: false },
			undefined,
			fixCad.FIX_CAD_OPTS
		);
		expect(error).toMatch(/Nenamapované CAD kódy.*18004/);
	});
});

describe('fix-cad modul — cadOdpisView bez opts = pergola path (backward compat)', () => {
	it('cadOdpisView BEZ opts rozparsuje pergola kódy (18xxx) — pergola path nezmenený', () => {
		const { error, view } = cadOdpis.cadOdpisView({
			zak: 'F1',
			op: 'OP1',
			zakaznik: 'Z',
			cad: PERGOLA_CAD,
			caka: false
		});
		expect(error).toBeNull();
		expect(view).not.toBeNull();
		expect(view!.nonzero.length).toBeGreaterThan(0);
	});
});

describe('fix-cad modul — buildFixCadJob', () => {
	it('buildFixCadJob nesie modul=fix, cakaSubdir=Fix, popis „FIX OP Zákazník"', () => {
		const vstup = { zak: 'F1', op: 'OP7', zakaznik: 'Zákazník A', cad: FIX_CAD, caka: false };
		const { view } = cadOdpis.cadOdpisView(vstup, undefined, fixCad.FIX_CAD_OPTS);
		const job = fixCad.buildFixCadJob(vstup, view!, 'tester');
		expect(job.modul).toBe('fix');
		expect(job.cakaSubdir).toBe('Fix');
		// marker „FIX" odlíši FIX doklad od pergola dokladu v Money
		expect(job.popis).toBe('FIX OP7 Zákazník A');
		expect(job.polozky.length).toBeGreaterThan(0);
		expect(String(job.detail.cad)).toContain('16101');
	});
});

describe('fix-cad route — odoslat BLOKOVANÉ (bar_mm neznáme — honest-null)', () => {
	// #500 review HIGH-1: bar_mm neznáme → odoslat do Money BLOKOVANÉ. Náhľad funguje
	// (operátor vidí kódy + metrá), ale zápis je pozastavený kým sa MJ nepotvrdí.
	it('odoslat s neznámym bar_mm → step=nahlad s blok hláškou (NIE hotovo)', async () => {
		const r = (await route.actions.odoslat(
			ev({ zak: 'FIX-1', op: 'OP1', zakaznik: 'Zákazník A', cad: FIX_CAD })
		)) as { step: string; error: string | null };
		expect(r.step).toBe('nahlad');
		expect(r.error).toMatch(/Odpis pozastavený/);
		expect(r.error).toMatch(/bar_mm/);
		// do Money sa nič NEzapísalo
		expect(listOdpisy(200).some((o) => o.zak === 'FIX-1' && o.op === 'OP1')).toBe(false);
	});

	it('chybný vstup (nenamapovaný kód) → step=form, do Money sa nič nezapíše', async () => {
		const r = (await route.actions.odoslat(
			ev({ zak: 'FIX-BAD', op: 'OP9', zakaznik: 'Z', cad: '999999 NEZNAMY 1 1000' })
		)) as { step: string };
		expect(r.step).toBe('form');
		expect(listOdpisy(500).some((o) => o.zak === 'FIX-BAD')).toBe(false);
	});
});

describe('fix-cad route — spocitat FUNGUJE (náhľad aj pri neznámom bar_mm)', () => {
	it('spocitat s FIX kódmi → step=nahlad + fixBarMmWarning', async () => {
		const r = (await route.actions.spocitat(
			ev({ zak: 'FIX-S1', op: 'OP1', zakaznik: 'Z', cad: FIX_CAD })
		)) as { step: string; fixBarMmWarning: string | null; v: { nonzero: { kod: string }[] } };
		expect(r.step).toBe('nahlad');
		expect(r.fixBarMmWarning).toMatch(/nie je zatiaľ možný/);
		expect(r.v.nonzero.map((p) => p.kod)).toContain('16101');
	});
});

// #393: pergola route odpis nesie SVOJU identitu (popisPrefix='' → „OP Zákazník", BEZ „FIX ").
describe('cad-odpis — pergola route identita (PERGOLA_OPTS)', () => {
	it('pergola odpis má popis „OP Zákazník" bez FIX prefixu (popisPrefix prázdny)', async () => {
		const r = (await pergolaRoute.actions.odoslat(
			ev({ zak: 'PERG-POP', op: 'OP7', zakaznik: 'Zákazník A', cad: PERGOLA_CAD })
		)) as { step: string; outcome: { target: string } };
		expect(r.step).toBe('hotovo');
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.readFile(r.outcome.target);
		const ws = wb.getWorksheet('Hárok2')!;
		// popis dokladu = 6. stĺpec (index 5) prvého dátového riadku (money.ts addRow poradie)
		const popis = (ws.getRow(2).values as unknown[]).slice(1)[5];
		expect(popis).toBe('OP7 Zákazník A'); // pergola: „OP Zákazník", NIE „FIX OP Zákazník"
	});
});

describe('fix-cad — Patrikove testovacie vektory (ZAK2026408 / OPDL260153)', () => {
	it('reálny FIX CAD nárez z výroby dá správne metráže per kód', () => {
		// Rekonštrukcia z ticketu issue 500 — Patrikova vzorka (zákazka SHOP MARKET).
		// Všetky rezy sú kód 16101 RAMOVY PROFIL, rôzne dĺžky v mm.
		const patrikCad = [
			'16101 RAMOVY PROFIL 1 109.80',
			'16101 RAMOVY PROFIL 1 301.00',
			'16101 RAMOVY PROFIL 1 2072.48',
			'16101 RAMOVY PROFIL 1 2060.00',
			'16101 RAMOVY PROFIL 1 53.81',
			'16101 RAMOVY PROFIL 2 212.00',
			'16101 RAMOVY PROFIL 1 1664.68',
			'16101 RAMOVY PROFIL 1 1653.39',
			'16101 RAMOVY PROFIL 1 303.00',
			'16101 RAMOVY PROFIL 1 109.83',
			'16101 RAMOVY PROFIL 1 2074.69'
		].join('\n');
		const { error, view } = cadOdpis.cadOdpisView(
			{ zak: 'ZAK2026408', op: 'OPDL260153', zakaznik: 'SHOP MARKET', cad: patrikCad, caka: false },
			undefined,
			fixCad.FIX_CAD_OPTS
		);
		expect(error).toBeNull();
		expect(view).not.toBeNull();
		expect(view!.nonzero).toHaveLength(1);
		expect(view!.nonzero[0]!.kod).toBe('16101');
		// Celková dĺžka rezov: 109.80+301.00+2072.48+2060.00+53.81+2x212.00+1664.68+1653.39+303.00+109.83+2074.69
		// = 10826.68 mm = 10.827 m (zaokrúhlené na 3 desatinné miesta)
		expect(view!.nonzero[0]!.qty).toBeCloseTo(10.827, 2);
	});
});
