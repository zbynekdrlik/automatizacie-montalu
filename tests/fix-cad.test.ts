import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// TEST režim + vlastný Money priečinok. `MONEY_TEST_DIR`/`MONEY_LIVE` MUSIA byť nastavené
// PRED dynamickým importom route/money (money.ts síce číta env pri volaní, ale je čistejšie
// mať kontrolu nad priečinkom pred prvým writeOdpis) — vzor tests/clip-odpis.test.ts.
// DATABASE_PATH by izoloval aj auto-setup; nastavujeme ho explicitne kvôli jednote timingu.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-fix-cad-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'fix.db');
process.env.MONEY_LIVE = '0'; // TEST — do ostrého Money NIČ
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const fixCad = await import('../src/lib/server/fix-cad');
const route = await import('../src/routes/fix/cad/+page.server');
const pergolaRoute = await import('../src/routes/pergola/+page.server');
const { listOdpisy } = await import('../src/lib/server/money');

// KÓD NÁZOV KS REZ — kódy zo zdieľaného pergola CODE_MAP (mechanizmus je code-driven:
// FIX-špecifické nenamapovateľné kódy by dali TVRDÚ chybu, nikdy tichý odpis).
const FIX_CAD = ['18004 PRIECKOVY PROFIL 105 9 3871', '18018 ZLABOVY PROFIL 140 2 4990'].join('\n');

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
	it('fixCadView rozparsuje platný CAD nárez bez unresolved kódov', () => {
		const { error, view } = fixCad.fixCadView({
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
		const { error, view } = fixCad.fixCadView({
			zak: 'F1',
			op: 'OP1',
			zakaznik: 'Z',
			cad: '999999 NEZNAMY PROFIL 1 1000',
			caka: false
		});
		expect(error).toBeTruthy();
		expect(view).toBeNull();
	});

	it('nezmyselný vstup (zlý formát riadku) → chyba', () => {
		const { error } = fixCad.fixCadView({
			zak: 'F1',
			op: 'OP1',
			zakaznik: 'Z',
			cad: 'toto nie je nárez',
			caka: false
		});
		expect(error).toBeTruthy();
	});

	it('buildFixCadJob nesie modul=fix, cakaSubdir=Fix, popis „OP Zákazník", celý katalóg', () => {
		const vstup = { zak: 'F1', op: 'OP7', zakaznik: 'Zákazník A', cad: FIX_CAD, caka: false };
		const { view } = fixCad.fixCadView(vstup);
		const job = fixCad.buildFixCadJob(vstup, view!, 'tester');
		expect(job.modul).toBe('fix');
		expect(job.cakaSubdir).toBe('Fix');
		expect(job.popis).toBe('OP7 Zákazník A');
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

	it('FIX odpis NEkoliduje s pergola odpisom tej istej ZAK+OP (samostatný dedup modul)', async () => {
		const pr = (await pergolaRoute.actions.odoslat(
			ev({ zak: 'SHARED-1', op: 'OP3', zakaznik: 'Z', cad: FIX_CAD })
		)) as { step: string };
		expect(pr.step).toBe('hotovo');
		// FIX odpis tej istej ZAK+OP — musí prejsť (iný modul), NIE duplikát
		const fr = (await route.actions.odoslat(
			ev({ zak: 'SHARED-1', op: 'OP3', zakaznik: 'Z', cad: FIX_CAD })
		)) as { step: string };
		expect(fr.step).toBe('hotovo');
		const rows = listOdpisy(200).filter((o) => o.zak === 'SHARED-1' && o.op === 'OP3');
		expect(rows.map((o) => o.modul).sort()).toEqual(['fix', 'pergola']);
	});

	it('chybný vstup (nenamapovaný kód) → step=form, do Money sa nič nezapíše', async () => {
		const r = (await route.actions.odoslat(
			ev({ zak: 'FIX-BAD', op: 'OP9', zakaznik: 'Z', cad: '999999 NEZNAMY 1 1000' })
		)) as { step: string };
		expect(r.step).toBe('form');
		expect(listOdpisy(200).some((o) => o.zak === 'FIX-BAD')).toBe(false);
	});
});
