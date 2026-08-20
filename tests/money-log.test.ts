// #245: Money zápisová cesta loguje claim / duplicate / success / release.
// (Kompenzačná ERROR vetva je krytá existujúcim money.test.ts „kompenzácia".)
import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { OdpisJob } from '../src/lib/server/money';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-money-log-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '0';
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'odpis-export');

// import PRV (migrácie ticho), level až potom
const { writeOdpis, releaseOdpis, listOdpisy } = await import('../src/lib/server/money');
process.env.LOG_LEVEL = 'info';
afterAll(() => delete process.env.LOG_LEVEL);

function makeJob(zak: string, op: string): OdpisJob {
	return {
		modul: 'zasklenia',
		zak,
		op,
		zakaznik: 'Test Zákazník',
		caka: false,
		createdBy: 'vitest',
		cakaSubdir: 'Robust',
		popis: `${op} : Test`,
		polozky: [{ kod: 'PRP20258', nazov: 'Kotviaci profil', qty: 7.5 }],
		detail: {}
	};
}

async function capture(fn: () => unknown): Promise<Record<string, unknown>[]> {
	const lines: string[] = [];
	const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
		lines.push(String(chunk));
		return true;
	}) as typeof process.stdout.write);
	try {
		await fn();
	} finally {
		spy.mockRestore();
	}
	return lines
		.join('')
		.split('\n')
		.filter(Boolean)
		.map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('money zápis — logovanie', () => {
	it('claim + zapísaný pri úspešnom zápise', async () => {
		const recs = await capture(() => writeOdpis(makeJob('ZAKLOG1', '01')));
		const claim = recs.find((r) => r.msg === 'odpis claim');
		expect(claim!.level).toBe('info');
		expect(claim!.modul).toBe('zasklenia');
		expect(claim!.zak).toBe('ZAKLOG1');
		expect(claim!.live).toBe(false);

		const ok = recs.find((r) => r.msg === 'odpis zapísaný');
		expect(ok!.level).toBe('info');
		expect(typeof ok!.target).toBe('string');
		expect(ok!.bytes as number).toBeGreaterThan(0);
	});

	it('duplikát → WARN s existing created_at', async () => {
		await writeOdpis(makeJob('ZAKLOG2', '02'));
		const recs = await capture(() => writeOdpis(makeJob('ZAKLOG2', '02')));
		const dup = recs.find((r) => r.msg?.toString().startsWith('odpis duplikát'));
		expect(dup!.level).toBe('warn');
		expect(dup!.zak).toBe('ZAKLOG2');
		expect(dup!.existingCreatedAt).toBeDefined();
	});

	it('releaseOdpis → INFO s actorom', async () => {
		await writeOdpis(makeJob('ZAKLOG3', '03'));
		const row = listOdpisy().find((r) => r.zak === 'ZAKLOG3');
		const recs = await capture(() => {
			releaseOdpis(row!.id, 'admin-user');
		});
		const rel = recs.find((r) => r.msg === 'odpis uvoľnený');
		expect(rel!.level).toBe('info');
		expect(rel!.actor).toBe('admin-user');
		expect(rel!.zak).toBe('ZAKLOG3');
	});
});
