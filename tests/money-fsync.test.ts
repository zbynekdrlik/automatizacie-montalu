// #246: durable atomic write vo writeOdpis — open/write/fsync/close tmp + best-effort
// fsync(dir) pred/po rename. Samotnú DURABILITY (prežitie výpadku prúdu) nemožno
// unit-testom dokázať (výpadok sa nesimuluje) — toto je ŠTRUKTURÁLNY regresný guard,
// že refaktor (writeFileSync → fd + fsync) stále vyprodukuje KOMPLETNÝ, plne
// parsovateľný xlsx (skrátený zip by ExcelJS.readFile hodil / by mu chýbali riadky).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-money-fsync-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '0';
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'odpis-export');

const { writeOdpis } = await import('../src/lib/server/money');
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
		popis: (op + ' : Test Zákazník').trim(),
		polozky: r!.odpis.map((o) => ({ kod: o.kod, nazov: o.nazov, qty: o.metre })),
		detail: { system: 'Robust', styl: '2K', s: 2509, v: 1930 }
	};
}

describe('writeOdpis — durable write vyprodukuje KOMPLETNÝ súbor (#246)', () => {
	beforeAll(() => {
		fs.mkdirSync(process.env.MONEY_TEST_DIR!, { recursive: true });
	});

	it('target súbor je neprázdny a plne parsovateľný (nie skrátený)', async () => {
		const out = await writeOdpis(makeReq('FSYNC-1', '01'));
		expect(out.status).toBe('written');
		expect(fs.existsSync(out.target)).toBe(true);

		// reálny xlsx (zip) má niekoľko kB — skrátený write by dal buď 0, alebo torzo
		const size = fs.statSync(out.target).size;
		expect(size).toBeGreaterThan(4000);

		// plná parsovateľnosť: skrátený zip by tu hodil / by chýbal worksheet a dáta
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.readFile(out.target);
		const ws = wb.getWorksheet('Hárok2');
		expect(ws).toBeDefined();
		const header = (ws!.getRow(1).values as unknown[]).slice(1);
		expect(header.length).toBe(6);
		const row2 = (ws!.getRow(2).values as unknown[]).slice(1);
		expect(row2[0]).toBe('FSYNC-1');
	});

	it('žiadny .tmp-* zvyšok v cieľovom adresári po úspešnom zápise', async () => {
		await writeOdpis(makeReq('FSYNC-2', '02'));
		const leftover = fs
			.readdirSync(process.env.MONEY_TEST_DIR!)
			.filter((f) => f.startsWith('.tmp-'));
		expect(leftover).toEqual([]);
	});
});
