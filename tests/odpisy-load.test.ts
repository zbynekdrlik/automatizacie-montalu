// Audit #29: /odpisy parsuje `detail` (JSON) pre každý riadok histórie. Jeden pokazený
// riadok NESMIE zhodiť celú stránku — „Uvoľniť" na tejto stránke je JEDINÁ cesta, ako
// opraviť duplikát v Money, takže pád histórie by zablokoval opravu.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-odpisy-load-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'o.db');
delete process.env.MONEY_LIVE;

const { db } = await import('../src/lib/server/db');
const { load, actions } = await import('../src/routes/odpisy/+page.server');

const ins = (zak: string, detail: string) =>
	db
		.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by)
			 VALUES ('zasklenia', ?, '01', 'X', 0, 0, '/t/f.xlsx', 'f.xlsx', ?, ?, 'tester')`
		)
		.run(zak, 'h-' + zak, detail);

const loadOdpisy = async () =>
	(
		(await load({} as Parameters<typeof load>[0])) as unknown as {
			odpisy: { zak: string; d: Record<string, unknown> }[];
		}
	).odpisy;

describe('/odpisy load — pokazený JSON detail nezhodí históriu (audit #29)', () => {
	it('nevalidný JSON → prázdny detail, riadok zostáva v zozname', async () => {
		ins('ZAK-BAD', '{toto nie je json');
		const odpisy = await loadOdpisy();
		const bad = odpisy.find((o) => o.zak === 'ZAK-BAD')!;
		expect(bad).toBeTruthy();
		expect(bad.d).toEqual({});
	});

	it('platný JSON sa rozparsuje na objekt', async () => {
		ins('ZAK-OK', JSON.stringify({ system: 'Slide', styl: '2x3K', s: 5000 }));
		const odpisy = await loadOdpisy();
		expect(odpisy.find((o) => o.zak === 'ZAK-OK')!.d).toMatchObject({
			system: 'Slide',
			styl: '2x3K',
			s: 5000
		});
	});

	it('pokazený riadok NEZABRÁNI zobrazeniu ostatných (nespadne celý load)', async () => {
		ins('ZAK-BAD2', 'null-ish [[[');
		ins('ZAK-OK2', '{"system":"Robust"}');
		const odpisy = await loadOdpisy();
		const zaky = odpisy.map((o) => o.zak);
		expect(zaky).toContain('ZAK-BAD2');
		expect(zaky).toContain('ZAK-OK2');
		expect(odpisy.every((o) => typeof o.d === 'object' && o.d !== null)).toBe(true);
	});

	it('prázdny detail ("") sa tiež zvládne (starý záznam bez detailu)', async () => {
		ins('ZAK-EMPTY', '');
		const odpisy = await loadOdpisy();
		expect(odpisy.find((o) => o.zak === 'ZAK-EMPTY')!.d).toEqual({});
	});

	it('uvolnit odmietne neplatné id bez zásahu do DB', async () => {
		const before = (
			db.prepare('SELECT COUNT(*) c FROM odpis_log').get() as { c: number }
		).c;
		const fd = new FormData();
		fd.append('id', '-5');
		const r = await actions.uvolnit({
			request: new Request('http://x/odpisy', { method: 'POST', body: fd }),
			locals: { user: { id: 1, username: 'tester', role: 'internal' } }
		} as Parameters<typeof actions.uvolnit>[0]);
		expect((r as { error?: string }).error).toMatch(/Neplatný/);
		expect((db.prepare('SELECT COUNT(*) c FROM odpis_log').get() as { c: number }).c).toBe(before);
	});
});
