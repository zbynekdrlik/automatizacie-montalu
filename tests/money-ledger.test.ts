// #294 — dvojitý import do Money. Append-only ledger `odpis_imported` blokuje re-import
// IDENTICKÉHO obsahu po „Uvoľniť" (root cause: `releaseOdpis` maže dedup kľúč bez Money-guardu).
// Blok je PER-ORDER: tuple (modul, zak_norm, op_norm, live) + content_hash — NIKDY globálny hash
// (owner: „ale ved moze mat viacero objednavok rovnaky obsah"). RED testy najprv zlyhajú na
// súčasnom kóde; GREEN pridá ledger + override.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-ledger-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '0';
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'odpis-export');

const { writeOdpis, releaseOdpis, listOdpisy } = await import('../src/lib/server/money');
const { loadCfg } = await import('../src/lib/server/db');
const { safeCompute } = await import('../src/lib/server/compute');
import type { OdpisJob } from '../src/lib/server/money';

function makeReq(zak: string, op: string, modul: OdpisJob['modul'] = 'zasklenia'): OdpisJob {
	const cfg = loadCfg();
	const { r, err } = safeCompute(cfg, 'Robust|2K', 2509, 1930, false);
	expect(err).toBeNull();
	return {
		modul,
		zak,
		op,
		zakaznik: 'Test Zákazník',
		caka: false,
		createdBy: 'vitest',
		cakaSubdir: 'Robust',
		popis: (op + ' : Test Zákazník').trim(),
		polozky: r!.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, qty: o.metre })),
		detail: { system: 'Robust', styl: '2K', s: 2509, v: 1930 }
	};
}

describe('#294 ledger — re-import identického obsahu po uvoľnení', () => {
	beforeAll(() => {
		fs.mkdirSync(process.env.MONEY_TEST_DIR!, { recursive: true });
	});

	it('[RED] write → (Money spracoval + uvoľniť) → write IDENTICKÝ ⇒ NEre-importuje sa', async () => {
		const w1 = await writeOdpis(makeReq('ZAK-LEDGER', '01'));
		expect(w1.status).toBe('written');
		expect(fs.existsSync(w1.target)).toBe(true);

		// simuluj, že Money watcher súbor spracoval a odsunul do DONE (v ostrej prevádzke
		// presne toto umožnilo dvojitý import: súbor zmizol z import dir medzi dvomi zápismi)
		fs.rmSync(w1.target);

		const row = listOdpisy(500).find((o) => o.zak === 'ZAK-LEDGER' && o.op === '01');
		expect(row).toBeTruthy();
		expect(releaseOdpis(row!.id, 'tester')).toBe(true);

		// operátor pošle znova PRESNE ten istý obsah — do Money už NESMIE ísť druhýkrát
		const w2 = await writeOdpis(makeReq('ZAK-LEDGER', '01'));
		expect(fs.existsSync(w1.target)).toBe(false); // žiadny re-import súbor
		expect(w2.status).not.toBe('written');
	});

	it('[RED] normalizácia op: OP260286 potom 260286 (rovnaký modul/zak/live) ⇒ duplicate', async () => {
		const w1 = await writeOdpis(makeReq('ZAK-NORM', 'OP260286'));
		expect(w1.status).toBe('written');
		const w2 = await writeOdpis(makeReq('ZAK-NORM', '260286'));
		// OP260286 ≡ 260286 po normalizácii → druhý je duplikát (dnes prejde ako 2 rôzne)
		expect(w2.status).toBe('duplicate');
	});

	// owner constraint (2026-08-24): „ale ved moze mat viacero objednavok rovnaky obsah" —
	// dve RÔZNE zákazky s IDENTICKÝM obsahom sa NESMÚ blokovať navzájom.
	it('[GUARD] identický obsah pod INÝM zak/op prejde normálne (per-order tuple, nie globálny hash)', async () => {
		const a = await writeOdpis(makeReq('ZAK-SAME-A', '01'));
		const b = await writeOdpis(makeReq('ZAK-SAME-B', '01'));
		expect(a.status).toBe('written');
		expect(b.status).toBe('written');
	});
});
