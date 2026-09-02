// #340: writeOdpis observer — po ÚSPEŠNOM zápise (`status:'written'`) sa zavolá
// registrovaný hook so (zak, op); pri duplicite/bloku NIE. Toto je wiring, ktorý
// v prevádzke pushuje interný zoznam zákazky do Odoo (hooks.server.ts → queueZakazkaPush).
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-odpis-hook-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '0';
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'odpis-export');

const { writeOdpis, setOdpisWrittenHook } = await import('../src/lib/server/money');
const { loadCfg } = await import('../src/lib/server/db');
const { safeCompute } = await import('../src/lib/server/compute');
import type { OdpisJob } from '../src/lib/server/money';

function makeReq(zak: string, op: string): OdpisJob {
	const cfg = loadCfg();
	const { r, err } = safeCompute(cfg, 'Robust|2K', 2509, 1930, false);
	expect(err).toBeNull();
	return {
		modul: 'zasklenia',
		zak,
		op,
		zakaznik: 'Test Zákazník',
		caka: false,
		createdBy: 'vitest',
		cakaSubdir: 'Robust',
		popis: `${op} : Test Zákazník`.trim(),
		polozky: r!.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, qty: o.metre })),
		detail: { system: 'Robust', styl: '2K', s: 2509, v: 1930 }
	};
}

afterEach(() => setOdpisWrittenHook(null));

describe('setOdpisWrittenHook — observer po zápise odpisu', () => {
	it('zavolá sa s eventom {job, contentHash, live, odpisLogId} po ÚSPEŠNOM zápise (#5825)', async () => {
		const spy = vi.fn();
		setOdpisWrittenHook(spy);
		const out = await writeOdpis(makeReq('ZAKHOOK1', 'OP501'), {});
		expect(out.status).toBe('written');
		expect(spy).toHaveBeenCalledTimes(1);
		expect(spy).toHaveBeenCalledWith(
			expect.objectContaining({
				job: expect.objectContaining({ zak: 'ZAKHOOK1', op: 'OP501' }),
				contentHash: expect.any(String),
				live: false,
				odpisLogId: expect.any(Number)
			})
		);
	});

	it('NEZAVOLÁ sa pri duplicite (rovnaká zak+op+live)', async () => {
		await writeOdpis(makeReq('ZAKHOOK2', 'OP502'), {}); // prvý zápis (bez hooku)
		const spy = vi.fn();
		setOdpisWrittenHook(spy);
		const out = await writeOdpis(makeReq('ZAKHOOK2', 'OP502'), {}); // duplicitný
		expect(out.status).toBe('duplicate');
		expect(spy).not.toHaveBeenCalled();
	});

	it('synchrónny throw hooku NEZHODÍ zápis odpisu (odpis je zapísaný)', async () => {
		setOdpisWrittenHook(() => {
			throw new Error('hook boom');
		});
		const out = await writeOdpis(makeReq('ZAKHOOK3', 'OP503'), {});
		expect(out.status).toBe('written');
	});
});
