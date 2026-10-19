// Review nález pri #613 (história účtov preberá vzor karty „História zmien" editora vzorcov):
// karta na `/zasklenia/nastavenia` ukazovala SUROVÝ `cfg_audit.ts` — SQLite `datetime('now')` je
// UTC bez zóny, takže výroba videla čas o 1–2 h posunutý (zima / leto) a pri polnoci iný deň
// (timestamps.md). Load má čas pripraviť v Europe/Bratislava ako ostatné stránky.
import { describe, it, expect } from 'vitest';
import { db } from '../src/lib/server/db';

const { load } = await import('../src/routes/zasklenia/nastavenia/+page.server');

describe('/zasklenia/nastavenia — História zmien v miestnom čase', () => {
	it('čas zmeny = Europe/Bratislava (zima UTC+1, leto UTC+2 cez polnoc), nie surové UTC', async () => {
		const ins = db.prepare(
			"INSERT INTO cfg_audit (ts, username, sys_styl, zmeny) VALUES (?, 'vyroba', 'Robust|2K', '[]')"
		);
		ins.run('2026-01-05 13:32:00');
		ins.run('2026-07-01 22:30:00');
		const data = (await load({
			url: new URL('http://x/zasklenia/nastavenia?sysStyl=Robust%7C2K')
		} as Parameters<typeof load>[0])) as { audit: { ts: string; username: string }[] };
		expect(data.audit.slice(0, 2).map((a) => [a.ts, a.username])).toEqual([
			['2.7.2026 00:30', 'vyroba'],
			['5.1.2026 14:32', 'vyroba']
		]);
	});
});
