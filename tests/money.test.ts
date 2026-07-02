// Integračné testy zápisu odpisu: dedup constraint, atomický zápis, kompenzácia
// pri zlyhaní, formát xlsx (6 stĺpcov ako Money import očakáva).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-money-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '0';
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'odpis-export');

// import až PO nastavení env (db.ts číta DATABASE_PATH pri importe)
const { writeOdpis } = await import('../src/lib/server/money');
const { loadCfg } = await import('../src/lib/server/db');
const { safeCompute } = await import('../src/lib/server/compute');

function makeReq(zak: string, op: string) {
	const cfg = loadCfg();
	const { r, err } = safeCompute(cfg, 'Robust|2K', 2509, 1930, false);
	expect(err).toBeNull();
	return {
		zak,
		op,
		zakaznik: 'Test Zákazník',
		sklo: 'Izolačné sklo 4/16/4 mliečne',
		otvaranie: 'P - L',
		caka: false,
		createdBy: 'vitest',
		result: r!
	};
}

describe('writeOdpis', () => {
	beforeAll(() => {
		fs.mkdirSync(process.env.MONEY_TEST_DIR!, { recursive: true });
	});

	it('zapíše xlsx so 6 stĺpcami a správnymi hodnotami', async () => {
		const out = await writeOdpis(makeReq('TEST-1', '01'));
		expect(out.status).toBe('written');
		expect(out.live).toBe(false);
		expect(out.filename).toContain('OP01');
		expect(fs.existsSync(out.target)).toBe(true);

		const wb = new ExcelJS.Workbook();
		await wb.xlsx.readFile(out.target);
		const ws = wb.getWorksheet('Hárok2')!;
		const header = (ws.getRow(1).values as unknown[]).slice(1);
		expect(header).toEqual([
			'číslo zakázky',
			'Kód položky',
			'Název položky',
			'Množství v m',
			'MJ',
			'Popis dokladu'
		]);
		const row2 = (ws.getRow(2).values as unknown[]).slice(1);
		expect(row2[0]).toBe('TEST-1');
		expect(row2[1]).toBe('ZASP00014');
		expect(row2[3]).toBe(15);
		expect(row2[5]).toBe('01 : Test Zákazník');
		// Popis dokladu len v prvom riadku
		expect(((ws.getRow(3).values as unknown[]).slice(1))[5] ?? '').toBe('');
	});

	it('duplikát (rovnaká ZAK+OP) sa odmietne a druhý súbor nevznikne', async () => {
		const before = fs.readdirSync(process.env.MONEY_TEST_DIR!).length;
		const out = await writeOdpis(makeReq('TEST-1', '01'));
		expect(out.status).toBe('duplicate');
		expect(out.duplicateCreatedAt).toBeTruthy();
		expect(fs.readdirSync(process.env.MONEY_TEST_DIR!).length).toBe(before);
	});

	it('iná OP tej istej ZAK prejde a má vlastný súbor (neprepíše prvý)', async () => {
		const out = await writeOdpis(makeReq('TEST-1', '02'));
		expect(out.status).toBe('written');
		const files = fs.readdirSync(process.env.MONEY_TEST_DIR!);
		expect(files.filter((f) => f.includes('TEST-1')).length).toBe(2);
	});

	it('zlyhanie zápisu súboru uvoľní dedup kľúč (kompenzácia)', async () => {
		const orig = process.env.MONEY_TEST_DIR!;
		// cieľový "priečinok" je súbor → mkdir/rename zlyhá
		const blocked = path.join(tmpRoot, 'blocked');
		fs.writeFileSync(blocked, 'x');
		process.env.MONEY_TEST_DIR = blocked;
		await expect(writeOdpis(makeReq('TEST-FAIL', '01'))).rejects.toThrow();
		process.env.MONEY_TEST_DIR = orig;
		// kľúč bol uvoľnený → opakované odoslanie prejde
		const retry = await writeOdpis(makeReq('TEST-FAIL', '01'));
		expect(retry.status).toBe('written');
	});

	it('paralelné odoslania tej istej ZAK+OP → práve jeden zápis', async () => {
		const results = await Promise.all([
			writeOdpis(makeReq('TEST-RACE', '01')),
			writeOdpis(makeReq('TEST-RACE', '01')),
			writeOdpis(makeReq('TEST-RACE', '01'))
		]);
		const written = results.filter((r) => r.status === 'written');
		const dupes = results.filter((r) => r.status === 'duplicate');
		expect(written.length).toBe(1);
		expect(dupes.length).toBe(2);
	});
});
