// #245: štartovací config riadok (LOG-8) — verzia, DB cesta, MONEY_LIVE, cieľové
// adresáre, snapshot ceny. Emitovaný z hooks.server.ts pri module-load. Spy sa
// nastaví PRED importom, aby zachytil štartový riadok.
import { describe, it, expect, vi, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-startup-log-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '0';
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'odpis-export');
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'ceny.json');
process.env.LOG_LEVEL = 'info';

// spy PRED importom hooks.server (štartový log beží pri module-load)
const lines: string[] = [];
const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
	lines.push(String(chunk));
	return true;
}) as typeof process.stdout.write);
await import('../src/hooks.server');
spy.mockRestore();
afterAll(() => delete process.env.LOG_LEVEL);

const recs = lines
	.join('')
	.split('\n')
	.filter(Boolean)
	.map((l) => JSON.parse(l) as Record<string, unknown>);

describe('startup config log', () => {
	it('emituje jeden štartový riadok s verziou, DB, MONEY_LIVE a cieľmi', () => {
		const s = recs.find((r) => r.module === 'startup' && r.msg === 'štart');
		expect(s).toBeDefined();
		expect(s!.level).toBe('info');
		expect(s!.databasePath).toBe(process.env.DATABASE_PATH);
		expect(s!.moneyLive).toBe(false);
		expect(s!.testDir).toBe(process.env.MONEY_TEST_DIR);
		expect(s!.cenySnapshotPath).toBe(process.env.CENY_SNAPSHOT_PATH);
		expect(typeof s!.liveDir).toBe('string');
		expect(typeof s!.naOdpisDir).toBe('string');
		expect(s).toHaveProperty('version');
	});
});
