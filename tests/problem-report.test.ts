// Audit #35: nahlásenie problému — prázdny popis sa NESMIE uložiť (inak sa história
// hlásení zaplní prázdnymi riadkami a skutočné hlásenia sa v nej stratia), dlhý
// popis sa reže na 5000 znakov, a load() vracia posledné hlásenia.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-problem-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'p.db');
delete process.env.MONEY_LIVE;

const { db } = await import('../src/lib/server/db');
const { actions, load } = await import('../src/routes/problem/+page.server');

const pocet = () =>
	(db.prepare('SELECT COUNT(*) c FROM problem_reports').get() as { c: number }).c;

function ev(body: Record<string, string>, username = 'tester') {
	const fd = new FormData();
	for (const [k, v] of Object.entries(body)) fd.append(k, v);
	return {
		request: new Request('http://x/problem', { method: 'POST', body: fd }),
		locals: { user: { id: 1, username, role: 'internal' } }
	} as Parameters<typeof actions.default>[0];
}

describe('nahlásenie problému — guard na prázdny popis (audit #35)', () => {
	it('prázdny popis → chyba a DB sa nezmení', async () => {
		const before = pocet();
		const r = await actions.default(ev({ oblast: 'zasklenia', popis: '' }));
		expect((r as { error?: string }).error).toMatch(/Napíš/);
		expect(pocet()).toBe(before);
	});

	it('popis len z medzier/nových riadkov sa tiež odmietne (trim)', async () => {
		const before = pocet();
		const r = await actions.default(ev({ oblast: 'zasklenia', popis: '   \n\t  ' }));
		expect((r as { error?: string }).error).toMatch(/Napíš/);
		expect(pocet()).toBe(before);
	});

	it('platný popis sa uloží s prihláseným menom a vybranou oblasťou', async () => {
		const r = await actions.default(ev({ oblast: 'bazén', popis: '  odpis nesedí  ' }, 'dielna'));
		expect(r).toMatchObject({ ulozene: true });
		const row = db
			.prepare('SELECT username, oblast, popis FROM problem_reports ORDER BY id DESC LIMIT 1')
			.get() as { username: string; oblast: string; popis: string };
		expect(row).toMatchObject({ username: 'dielna', oblast: 'bazén', popis: 'odpis nesedí' });
	});

	it('extrémne dlhý popis sa odreže na 5000 znakov (neroztrhne stránku histórie)', async () => {
		await actions.default(ev({ oblast: 'iné', popis: 'x'.repeat(9000) }));
		const row = db.prepare('SELECT popis FROM problem_reports ORDER BY id DESC LIMIT 1').get() as {
			popis: string;
		};
		expect(row.popis.length).toBe(5000);
	});

	it('load() vracia uložené hlásenia (najnovšie prvé)', async () => {
		const { reports } = (await load(
			{} as Parameters<typeof load>[0]
		)) as unknown as { reports: { popis: string }[] };
		expect(reports.length).toBeGreaterThanOrEqual(2);
		expect(reports[0].popis.length).toBe(5000); // posledné vložené = najnovšie
	});
});
