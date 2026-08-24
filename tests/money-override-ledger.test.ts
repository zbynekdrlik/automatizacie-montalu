// #300 — „Uvoľniť" dead-end: po `releaseOdpis` (zmaže `odpis_log` riadok) je identický obsah
// ledger-blokovaný, ale `povolitReimport(id)` už NEMÁ riadok, z ktorého číta content_hash/tuple —
// operátor nemá z UI cestu von. Fix: TUPLE-based override priamo vo `writeOdpis`
// (`opts.overrideLedger`) — NEPOTREBUJE živý `odpis_log` riadok, autorizuje re-import z
// normalizovaného tuple + content_hash samotného job-u. RED zlyhá na súčasnom kóde (overrideLedger
// sa ignoruje → stále blocked); GREEN pridá override vetvu + audit + one-shot.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-ovr-ledger-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '0';
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'odpis-export');

const { writeOdpis, releaseOdpis, listOdpisy, overrideOpts, rawFormEntries } =
	await import('../src/lib/server/money');
const { loadCfg, db } = await import('../src/lib/server/db');
const { safeCompute } = await import('../src/lib/server/compute');
import type { OdpisJob } from '../src/lib/server/money';

function makeReq(zak: string, op: string, s = 2509, v = 1930): OdpisJob {
	const cfg = loadCfg();
	const { r, err } = safeCompute(cfg, 'Robust|2K', s, v, false);
	expect(err).toBeNull();
	return {
		modul: 'zasklenia',
		zak,
		op,
		zakaznik: 'Test Zákazník',
		caka: false,
		createdBy: 'vitest',
		cakaSubdir: 'Robust',
		popis: (op + ' : Test Zákazník').trim(),
		polozky: r!.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, qty: o.metre })),
		detail: { system: 'Robust', styl: '2K', s, v }
	};
}

describe('#300 tuple-based ledger override — „Uvoľniť" dead-end', () => {
	beforeAll(() => {
		fs.mkdirSync(process.env.MONEY_TEST_DIR!, { recursive: true });
	});

	it('[RED] po „Uvoľniť" identický obsah blokuje, ale overrideLedger ho pustí (bez odpis_log riadku)', async () => {
		const w1 = await writeOdpis(makeReq('ZAK-DEADEND', '01'));
		expect(w1.status).toBe('written');
		fs.rmSync(w1.target); // Money spracoval + odsunul do DONE

		// „Uvoľniť" (NIE „Povoliť rovnaký") — zmaže odpis_log riadok, ledger ostáva
		const row = listOdpisy(500).find((o) => o.zak === 'ZAK-DEADEND' && o.op === '01');
		expect(releaseOdpis(row!.id, 'tester')).toBe(true);
		// riadok je preč → „Povoliť rovnaký" (povolitReimport) sa naň už nedá zavolať — DEAD END
		expect(listOdpisy(500).some((o) => o.zak === 'ZAK-DEADEND' && o.op === '01')).toBe(false);

		// identický re-send bez override = ledger blok (poistka funguje)
		const blocked = await writeOdpis(makeReq('ZAK-DEADEND', '01'));
		expect(blocked.status).toBe('blocked');
		expect(blocked.reason).toBe('ledger-duplicate');

		// TUPLE override (nepotrebuje odpis_log riadok) pustí re-import
		const ok = await writeOdpis(makeReq('ZAK-DEADEND', '01'), { overrideLedger: true });
		expect(ok.status).toBe('written');
		expect(fs.existsSync(ok.target)).toBe(true);
	});

	it('overrideLedger zaznamená `override` ledger riadok + cfg_audit a je ONE-SHOT', async () => {
		const w1 = await writeOdpis(makeReq('ZAK-OVR1S', '01'));
		expect(w1.status).toBe('written');
		fs.rmSync(w1.target);
		const row = listOdpisy(500).find((o) => o.zak === 'ZAK-OVR1S' && o.op === '01');
		expect(releaseOdpis(row!.id, 'tester')).toBe(true);

		const overridesBefore = (
			db.prepare("SELECT COUNT(*) c FROM odpis_imported WHERE kind = 'override'").get() as {
				c: number;
			}
		).c;
		const auditBefore = (
			db.prepare("SELECT COUNT(*) c FROM cfg_audit WHERE sys_styl = 'odpis'").get() as { c: number }
		).c;

		const ok = await writeOdpis(makeReq('ZAK-OVR1S', '01'), { overrideLedger: true });
		expect(ok.status).toBe('written');
		fs.rmSync(ok.target);

		const overridesAfter = (
			db.prepare("SELECT COUNT(*) c FROM odpis_imported WHERE kind = 'override'").get() as {
				c: number;
			}
		).c;
		const auditAfter = (
			db.prepare("SELECT COUNT(*) c FROM cfg_audit WHERE sys_styl = 'odpis'").get() as { c: number }
		).c;
		expect(overridesAfter).toBe(overridesBefore + 1);
		expect(auditAfter).toBe(auditBefore + 1); // vedomý override je AUDITOVANÝ, nie tiché preskočenie

		// ONE-SHOT: ďalší identický re-send bez nového override je zas blokovaný
		const rowB = listOdpisy(500).find((o) => o.zak === 'ZAK-OVR1S' && o.op === '01');
		expect(releaseOdpis(rowB!.id, 'tester')).toBe(true);
		const w3 = await writeOdpis(makeReq('ZAK-OVR1S', '01'));
		expect(w3.status).toBe('blocked');
		expect(w3.reason).toBe('ledger-duplicate');
	});

	it('overrideLedger bez ledger bloku je no-op (normálny prvý zápis prejde)', async () => {
		const ok = await writeOdpis(makeReq('ZAK-OVR-NOOP', '01'), { overrideLedger: true });
		expect(ok.status).toBe('written');
		// žiadny zbytočný override riadok, keď nebolo čo obchádzať
		const overrides = (
			db
				.prepare(
					"SELECT COUNT(*) c FROM odpis_imported WHERE kind = 'override' AND zak_norm = 'ZAK-OVR-NOOP'"
				)
				.get() as { c: number }
		).c;
		expect(overrides).toBe(0);
	});
});

describe('#300 overrideOpts + rawFormEntries — UI „Odoslať aj tak" plumbing', () => {
	it('overrideOpts mapuje skryté `override` pole na správny flag', () => {
		const fKody = new FormData();
		fKody.set('override', 'unknown-kod');
		expect(overrideOpts(fKody)).toEqual({ overrideKody: true, overrideLedger: false });

		const fLedger = new FormData();
		fLedger.set('override', 'ledger-duplicate');
		expect(overrideOpts(fLedger)).toEqual({ overrideKody: false, overrideLedger: true });

		// bežný (prvý) submit nemá `override` pole → žiadny bypass
		expect(overrideOpts(new FormData())).toEqual({ overrideKody: false, overrideLedger: false });
	});

	it('rawFormEntries zachová string polia (aj qty úpravy), vynechá `override`', () => {
		const f = new FormData();
		f.set('zak', 'ZAK1');
		f.set('op', 'OP260286');
		f.set('qty_18004', '3,5'); // ručná úprava množstva
		f.set('override', 'ledger-duplicate'); // toto sa NEsmie zopakovať (doplní ho komponent)
		const e = rawFormEntries(f);
		expect(e).toContainEqual(['zak', 'ZAK1']);
		expect(e).toContainEqual(['op', 'OP260286']);
		expect(e).toContainEqual(['qty_18004', '3,5']);
		expect(e.some(([k]) => k === 'override')).toBe(false);
	});
});
