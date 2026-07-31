// Audit #14: v Money zápise (odpis_log.detail) musí byť ZAZNAMENANÉ presné zloženie
// skla, ak ho obchodník zadal (`skloPresne`), a ZÁROVEŇ základné sklo zo zoznamu
// (`skloZaklad`). Detail je jediné miesto, kde sa dá po zápise dohľadať, aké sklo
// zákazka mala — keby sa `skloPresne` prepisovalo/zahodilo, informácia je nenávratne
// stratená (odpis do Money sklo neobsahuje).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-detail-sklo-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'd.db');
process.env.MONEY_LIVE = '0'; // TEST režim — nikdy do ostrého Money
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'export');
fs.mkdirSync(process.env.MONEY_TEST_DIR, { recursive: true });

const { db } = await import('../src/lib/server/db');
const { actions } = await import('../src/routes/zasklenia/+page.server');

function odoslat(extra: Record<string, string>) {
	const fd = new FormData();
	const base: Record<string, string> = {
		zak: 'ZAK-D1',
		op: '01',
		zakaznik: 'X',
		system: 'Slide',
		styl: '3K',
		s: '3000',
		v: '2000',
		sklo: 'Izolačné sklo 4/8/4 číre',
		otvaranie: 'P - L'
	};
	for (const [k, v] of Object.entries({ ...base, ...extra })) fd.append(k, v);
	return actions.odoslat({
		request: new Request('http://x/zasklenia', { method: 'POST', body: fd }),
		locals: { user: { id: 1, username: 'tester', role: 'internal' } }
	} as Parameters<typeof actions.odoslat>[0]);
}

const lastDetail = () =>
	JSON.parse(
		(
			db.prepare('SELECT detail FROM odpis_log ORDER BY id DESC LIMIT 1').get() as {
				detail: string;
			}
		).detail
	);

describe('odpis detail — skloPresne vs. základné sklo (audit #14)', () => {
	it('zadané presné zloženie ide do detail.sklo, zoznamové sklo zostáva v skloZaklad', async () => {
		const r = await odoslat({ skloPresne: 'ESG 4 - 8 - 4 ESG číre kalené' });
		expect(r).toMatchObject({ step: 'hotovo' });
		expect(lastDetail()).toMatchObject({
			sklo: 'ESG 4 - 8 - 4 ESG číre kalené',
			skloZaklad: 'Izolačné sklo 4/8/4 číre'
		});
	});

	it('bez presného zloženia je detail.sklo == základné sklo (žiadne prázdno)', async () => {
		const r = await odoslat({ zak: 'ZAK-D2' });
		expect(r).toMatchObject({ step: 'hotovo' });
		const d = lastDetail();
		expect(d.sklo).toBe('Izolačné sklo 4/8/4 číre');
		expect(d.skloZaklad).toBe('Izolačné sklo 4/8/4 číre');
	});

	it('presné zloženie len z medzier sa neberie (fallback na základné sklo)', async () => {
		const r = await odoslat({ zak: 'ZAK-D3', skloPresne: '    ' });
		expect(r).toMatchObject({ step: 'hotovo' });
		expect(lastDetail().sklo).toBe('Izolačné sklo 4/8/4 číre');
	});

	it('detail nesie aj systém/štýl/rozmery + poznámku a RAL (podklad pre tlač a dohľadanie)', async () => {
		const r = await odoslat({
			zak: 'ZAK-D4',
			poznamka: 'bez kaskády\nsklo na mieru',
			ral: 'RAL 7016 štruktúra'
		});
		expect(r).toMatchObject({ step: 'hotovo' });
		expect(lastDetail()).toMatchObject({
			system: 'Slide',
			styl: '3K',
			s: 3000,
			v: 2000,
			otvaranie: 'P - L',
			poznamka: 'bez kaskády\nsklo na mieru',
			ral: 'RAL 7016 štruktúra'
		});
	});

	it('presné zloženie sa reže na 120 znakov (nezaplaví detail)', async () => {
		await odoslat({ zak: 'ZAK-D5', skloPresne: 'A'.repeat(300) });
		expect(lastDetail().sklo.length).toBe(120);
	});
});
