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
const route = await import('../src/routes/fix/cad/+page.server');
const pergolaRoute = await import('../src/routes/pergola/+page.server');
const { listOdpisy } = await import('../src/lib/server/money');

// KÓD NÁZOV KS REZ — kódy zo zdieľaného pergola CODE_MAP (mechanizmus je code-driven:
// FIX-špecifické nenamapovateľné kódy by dali TVRDÚ chybu, nikdy tichý odpis).
const FIX_CAD = ['18004 PRIECKOVY PROFIL 105 9 3871', '18018 ZLABOVY PROFIL 140 2 4990'].join('\n');
// INÝ obsah (iné množstvo/rez → iný content_hash) — na test legitímnej koexistencie fix+pergola.
const FIX_CAD2 = '18004 PRIECKOVY PROFIL 105 3 2500';

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

describe('fix-cad modul — čistý tok (bez DB)', () => {
	it('cadOdpisView rozparsuje platný CAD nárez bez unresolved kódov', () => {
		const { error, view } = cadOdpis.cadOdpisView({
			zak: 'F1',
			op: 'OP1',
			zakaznik: 'Z',
			cad: FIX_CAD,
			caka: false
		});
		expect(error).toBeNull();
		expect(view).not.toBeNull();
		expect(view!.nonzero.length).toBeGreaterThan(0);
	});

	it('nenamapovaný CAD kód → TVRDÁ chyba (nikdy tichý výpadok materiálu)', () => {
		const { error, view } = cadOdpis.cadOdpisView({
			zak: 'F1',
			op: 'OP1',
			zakaznik: 'Z',
			cad: '999999 NEZNAMY PROFIL 1 1000',
			caka: false
		});
		expect(error).toMatch(/Nenamapované CAD kódy.*999999/);
		expect(view).toBeNull();
	});

	it('nezmyselný vstup (zlý formát riadku) → chyba', () => {
		const { error } = cadOdpis.cadOdpisView({
			zak: 'F1',
			op: 'OP1',
			zakaznik: 'Z',
			cad: 'toto nie je nárez',
			caka: false
		});
		expect(error).toMatch(/prázdny alebo v zlom formáte/);
	});

	it('buildFixCadJob nesie modul=fix, cakaSubdir=Fix, popis „FIX OP Zákazník", celý katalóg', () => {
		const vstup = { zak: 'F1', op: 'OP7', zakaznik: 'Zákazník A', cad: FIX_CAD, caka: false };
		const { view } = cadOdpis.cadOdpisView(vstup);
		const job = fixCad.buildFixCadJob(vstup, view!, 'tester');
		expect(job.modul).toBe('fix');
		expect(job.cakaSubdir).toBe('Fix');
		// marker „FIX" odlíši FIX doklad od pergola dokladu v Money (pergola má „OP Zákazník")
		expect(job.popis).toBe('FIX OP7 Zákazník A');
		expect(job.polozky.length).toBe(25); // VŠETKÝCH 25 katalógových riadkov (aj nulové)
		expect(String(job.detail.cad)).toContain('18004');
	});
});

describe('fix-cad route — odoslat (TEST režim, do ostrého Money NIČ)', () => {
	it('zapíše FIX odpis do TEST priečinka; row.modul=fix', async () => {
		const r = (await route.actions.odoslat(
			ev({ zak: 'FIX-1', op: 'OP1', zakaznik: 'Zákazník A', cad: FIX_CAD })
		)) as { step: string; outcome: { live: boolean; filename: string } };
		expect(r.step).toBe('hotovo');
		expect(r.outcome.live).toBe(false);
		expect(r.outcome.filename).toMatch(/\.xlsx$/);
		const files = fs.readdirSync(process.env.MONEY_TEST_DIR!);
		expect(files).toContain(r.outcome.filename);
		const row = listOdpisy(200).find((o) => o.zak === 'FIX-1' && o.op === 'OP1')!;
		expect(row.modul).toBe('fix');
	});

	it('druhé odoslanie tej istej FIX ZAK+OP = duplikát (dedup modul=fix)', async () => {
		await route.actions.odoslat(ev({ zak: 'FIX-DUP', op: 'OP2', zakaznik: 'Z', cad: FIX_CAD }));
		const r2 = (await route.actions.odoslat(
			ev({ zak: 'FIX-DUP', op: 'OP2', zakaznik: 'Z', cad: FIX_CAD })
		)) as { step: string };
		expect(r2.step).toBe('duplikat');
	});

	// #380 review 🔴 — FIX reusuje pergola katalóg, takže IDENTICKÝ nárez dá identický
	// content_hash pod modul='fix' aj 'pergola'. Cross-modul guard vo writeOdpis musí zabrániť
	// dvojitému odpisu rovnakého materiálu (obídenie dedup/ledger presunom z /pergola na /fix/cad).
	it('IDENTICKÝ obsah pergola→fix na tej istej ZAK+OP = duplikát (cross-modul guard)', async () => {
		const pr = (await pergolaRoute.actions.odoslat(
			ev({ zak: 'CROSS-1', op: 'OP3', zakaznik: 'Z', cad: FIX_CAD })
		)) as { step: string };
		expect(pr.step).toBe('hotovo');
		// identický nárez cez FIX lane → cross-modul guard vráti duplikát, NIČ sa nezapíše
		const fr = (await route.actions.odoslat(
			ev({ zak: 'CROSS-1', op: 'OP3', zakaznik: 'Z', cad: FIX_CAD })
		)) as { step: string };
		expect(fr.step).toBe('duplikat');
		const rows = listOdpisy(500).filter((o) => o.zak === 'CROSS-1' && o.op === 'OP3');
		expect(rows.map((o) => o.modul)).toEqual(['pergola']); // fix sa NEzapísal
		// žiadny prepis súboru — len jeden súbor pre CROSS-1
		expect(
			fs.readdirSync(process.env.MONEY_TEST_DIR!).filter((f) => f.startsWith('CROSS-1')).length
		).toBe(1);
	});

	it('RÔZNY obsah pergola + fix na tej istej ZAK+OP KOEXISTUJE (obe zapíšu — rôzny materiál)', async () => {
		const pr = (await pergolaRoute.actions.odoslat(
			ev({ zak: 'COEX-1', op: 'OP4', zakaznik: 'Z', cad: FIX_CAD })
		)) as { step: string };
		expect(pr.step).toBe('hotovo');
		// iný nárez (iný content_hash) → cross-modul guard NEblokuje, fix legitímne zapíše
		const fr = (await route.actions.odoslat(
			ev({ zak: 'COEX-1', op: 'OP4', zakaznik: 'Z', cad: FIX_CAD2 })
		)) as { step: string };
		expect(fr.step).toBe('hotovo');
		const rows = listOdpisy(500).filter((o) => o.zak === 'COEX-1' && o.op === 'OP4');
		expect(rows.map((o) => o.modul).sort()).toEqual(['fix', 'pergola']);
		// dva RÔZNE súbory (rôzny obsah → rôzny hash → žiadny prepis)
		expect(
			fs.readdirSync(process.env.MONEY_TEST_DIR!).filter((f) => f.startsWith('COEX-1')).length
		).toBe(2);
	});

	it('chybný vstup (nenamapovaný kód) → step=form, do Money sa nič nezapíše', async () => {
		const r = (await route.actions.odoslat(
			ev({ zak: 'FIX-BAD', op: 'OP9', zakaznik: 'Z', cad: '999999 NEZNAMY 1 1000' })
		)) as { step: string };
		expect(r.step).toBe('form');
		expect(listOdpisy(500).some((o) => o.zak === 'FIX-BAD')).toBe(false);
	});
});

// #393: pergola route odpis nesie SVOJU identitu (popisPrefix='' → „OP Zákazník", BEZ „FIX ").
// Symetria k `buildFixCadJob` testu vyššie (modul=fix/cakaSubdir=Fix/popis „FIX …"): keby
// sa PERGOLA_OPTS v route omylom skopírovalo z FIXu (napr. popisPrefix='FIX '), doklad by
// v Money niesol zlú identitu. Popis žije v xlsx (money.ts) — čítame ho späť ako guard.
describe('cad-odpis — pergola route identita (PERGOLA_OPTS)', () => {
	it('pergola odpis má popis „OP Zákazník" bez FIX prefixu (popisPrefix prázdny)', async () => {
		const r = (await pergolaRoute.actions.odoslat(
			ev({ zak: 'PERG-POP', op: 'OP7', zakaznik: 'Zákazník A', cad: FIX_CAD })
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
