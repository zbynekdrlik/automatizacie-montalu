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
// Round 2 (#500): CAD kódy 16xxx sa mapujú na ZASP Money kódy cez Dominikov kód field.
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

describe('fix-catalog — transformFix (round 2: CAD→ZASP cez Dominikov kód)', () => {
	it('FIX CAD kódy (16xxx) sa mapujú na ZASP Money kódy', () => {
		const rows = [
			{ code: '16101', name: 'RAMOVY PROFIL', qty: 1, cut_mm: 2000 },
			{ code: '16104', name: 'ZASKLIEVACI PROFIL 36mm', qty: 2, cut_mm: 500 }
		];
		const r = fixCatalog.transformFix(rows);
		expect(r.unresolved).toEqual([]);
		expect(r.items).toHaveLength(2);
		// Round 2: CAD 16101 → Money ZASP00116 (Dominik msg 1818224)
		expect(r.items[0]!.kod).toBe('ZASP00116');
		expect(r.items[0]!.qty).toBe(7.5); // 2000mm < 7500mm bar → 1 bar = 7.5m
		expect(r.items[0]!.mj).toBe('m');
		// Round 2: CAD 16104 → Money ZASP202413
		expect(r.items[1]!.kod).toBe('ZASP202413');
		expect(r.items[1]!.qty).toBe(7.5); // 2x500mm = 1000mm < 7500mm → 1 bar = 7.5m
		// Round 2: bar_mm známe → barMmConfirmed = true
		expect(r.barMmConfirmed).toBe(true);
	});

	it('neznámy kód → unresolved (honest chyba)', () => {
		const rows = [{ code: '99999', name: 'NEZNAMY', qty: 1, cut_mm: 1000 }];
		const r = fixCatalog.transformFix(rows);
		expect(r.unresolved).toHaveLength(1);
		expect(r.unresolved[0]!.cad).toBe('99999');
		expect(r.items).toHaveLength(0);
	});

	it('V1 kód bez Dominik mapovania (16001) → unresolved', () => {
		const rows = [{ code: '16001', name: 'RAMOVY PROFIL', qty: 1, cut_mm: 1000 }];
		const r = fixCatalog.transformFix(rows);
		expect(r.unresolved).toHaveLength(1);
		expect(r.unresolved[0]!.cad).toBe('16001');
	});

	it('V1 kód 16006 (zasklievací 28mm) SA mapuje — ZASP00119', () => {
		const rows = [{ code: '16006', name: 'ZASKLIEVACI PROFIL 28mm', qty: 1, cut_mm: 3000 }];
		const r = fixCatalog.transformFix(rows);
		expect(r.unresolved).toEqual([]);
		expect(r.items).toHaveLength(1);
		expect(r.items[0]!.kod).toBe('ZASP00119');
	});

	it('viacero rezov rovnakého kódu: FFD bin-packing do 7500mm tyčí', () => {
		const rows = [
			{ code: '16101', name: 'RAMOVY PROFIL', qty: 1, cut_mm: 4000 },
			{ code: '16101', name: 'RAMOVY PROFIL', qty: 1, cut_mm: 4000 }
		];
		const r = fixCatalog.transformFix(rows);
		expect(r.items).toHaveLength(1);
		// 4000+4000=8000mm > 7500mm → 2 tyče (FFD: first 4000 → bar1, second 4000 → bar2)
		expect(r.items[0]!.qty).toBe(15); // 2 bars × 7.5m
	});

	it('rez dlhší ako tyč (oversize) → ceil(9000/7500) = 2 tyče', () => {
		const rows = [{ code: '16101', name: 'RAMOVY PROFIL', qty: 1, cut_mm: 9000 }];
		const r = fixCatalog.transformFix(rows);
		expect(r.items).toHaveLength(1);
		// 9000mm > 7500mm → ceil(9000/7500) = 2 bars (spojenie tyčí)
		expect(r.items[0]!.qty).toBe(15); // 2 × 7.5m
	});

	it('rezy vmestiteľné do jednej tyče → 1 × 7.5m', () => {
		const rows = [
			{ code: '16101', name: 'RAMOVY PROFIL', qty: 1, cut_mm: 1000 },
			{ code: '16101', name: 'RAMOVY PROFIL', qty: 1, cut_mm: 2000 },
			{ code: '16101', name: 'RAMOVY PROFIL', qty: 2, cut_mm: 500 }
		];
		const r = fixCatalog.transformFix(rows);
		expect(r.items).toHaveLength(1);
		// 1000+2000+2×500=4000mm < 7500mm → 1 tyč = 7.5m
		expect(r.items[0]!.qty).toBe(7.5);
	});

	it('celých 5 Dominik mapovaní je v katalógu', () => {
		const mapping = [
			{ cad: '16101', zasp: 'ZASP00116' },
			{ cad: '16006', zasp: 'ZASP00119' },
			{ cad: '16102', zasp: 'ZASP00125' },
			{ cad: '16103', zasp: 'ZASP00128' },
			{ cad: '16104', zasp: 'ZASP202413' }
		];
		for (const { cad, zasp } of mapping) {
			const r = fixCatalog.transformFix([{ code: cad, name: 'test', qty: 1, cut_mm: 100 }]);
			expect(r.unresolved).toEqual([]);
			expect(r.items[0]!.kod).toBe(zasp);
		}
	});
});

describe('fix-cad modul — cadOdpisView s FIX opts (bez DB)', () => {
	it('cadOdpisView s FIX opts mapuje CAD 16xxx → ZASP Money kódy', () => {
		const { error, view } = cadOdpis.cadOdpisView(
			{ zak: 'F1', op: 'OP1', zakaznik: 'Z', cad: FIX_CAD, caka: false },
			undefined,
			fixCad.FIX_CAD_OPTS
		);
		expect(error).toBeNull();
		expect(view).not.toBeNull();
		expect(view!.nonzero.length).toBeGreaterThan(0);
		// Round 2: CAD 16xxx → ZASP Money kódy (cez Dominikov kód field)
		const codes = view!.nonzero.map((p) => p.kod);
		expect(codes).toContain('ZASP00116'); // CAD 16101 → ZASP00116
		expect(codes).toContain('ZASP202413'); // CAD 16104 → ZASP202413
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

describe('fix-cad route — odoslat ODBLOKOVANÉ (round 2: bar_mm = 7500)', () => {
	// Round 2: Dominik potvrdil bar_mm = 7500 → odoslat FUNGUJE, ZASP kódy v xlsx
	it('odoslat s potvrdenými bar_mm → step=hotovo, ZASP kódy v Money', async () => {
		const r = (await route.actions.odoslat(
			ev({ zak: 'FIX-R2', op: 'OP1', zakaznik: 'Zákazník A', cad: FIX_CAD })
		)) as { step: string; outcome?: { target: string } };
		expect(r.step).toBe('hotovo');
		// xlsx existuje a obsahuje ZASP kódy
		expect(r.outcome).toBeDefined();
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.readFile(r.outcome!.target);
		const ws = wb.getWorksheet('Hárok2')!;
		const kody: string[] = [];
		ws.eachRow((row, i) => {
			if (i >= 2) kody.push(String(row.getCell(2).value));
		});
		expect(kody).toContain('ZASP00116'); // CAD 16101
		expect(kody).toContain('ZASP202413'); // CAD 16104
		// zápis v odpis_log existuje
		expect(listOdpisy(200).some((o) => o.zak === 'FIX-R2' && o.op === 'OP1')).toBe(true);
	});

	it('chybný vstup (nenamapovaný kód) → step=form, do Money sa nič nezapíše', async () => {
		const r = (await route.actions.odoslat(
			ev({ zak: 'FIX-BAD', op: 'OP9', zakaznik: 'Z', cad: '999999 NEZNAMY 1 1000' })
		)) as { step: string };
		expect(r.step).toBe('form');
		expect(listOdpisy(500).some((o) => o.zak === 'FIX-BAD')).toBe(false);
	});
});

describe('fix-cad route — spocitat (round 2: bar_mm potvrdené)', () => {
	it('spocitat s FIX kódmi → step=nahlad, žiadne fixBarMmWarning, ZASP kódy', async () => {
		const r = (await route.actions.spocitat(
			ev({ zak: 'FIX-S1', op: 'OP1', zakaznik: 'Z', cad: FIX_CAD })
		)) as { step: string; fixBarMmWarning: string | null; v: { nonzero: { kod: string }[] } };
		expect(r.step).toBe('nahlad');
		// Round 2: bar_mm = 7500 → žiadne varovanie
		expect(r.fixBarMmWarning).toBeNull();
		expect(r.v.nonzero.map((p) => p.kod)).toContain('ZASP00116');
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
	it('reálny FIX CAD nárez z výroby → ZASP00116, 2 tyče (15m)', () => {
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
		// Round 2: CAD 16101 → ZASP00116 (Money Dominikov kód field)
		expect(view!.nonzero[0]!.kod).toBe('ZASP00116');
		// FFD bin-packing rezov do 7500mm tyčí:
		// Rezy sorted desc: 2074.69, 2072.48, 2060.00, 1664.68, 1653.39, 303, 301, 212, 212, 109.83, 109.80, 53.81
		// Bar1: 2074.69+2072.48+2060.00+303+301+212+212+109.83+109.80 = 9454.80 > 7500 → nop
		// FFD: bar1 gets 2074.69+2072.48+2060.00+303+301+212+212+109.83+109.80 all fit? No:
		//   2074.69 (rem 5425.31) + 2072.48 (rem 3352.83) + 2060.00 (rem 1292.83)
		//   1664.68 > 1292.83 → bar2; 1653.39 fits bar2 (rem 4181.93)
		//   303 fits bar1 (rem 989.83), 301 fits bar1 (rem 688.83)
		//   212 fits bar1 (rem 476.83), 212 fits bar1 (rem 264.83)
		//   109.83 fits bar1 (rem ~155), 109.80 fits bar1 (rem ~45.2)
		//   53.81 > 45.2 → fits bar2
		// = 2 tyče × 7.5m = 15.0m
		expect(view!.nonzero[0]!.qty).toBe(15);
	});
});
