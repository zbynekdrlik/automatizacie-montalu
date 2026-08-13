// odpis_polozky — položky odpisu zapísané 1:1 v TEJ ISTEJ transakcii ako odpis_log
// (#154, fáza 1). RED→GREEN by tu nesedelo (nejde o bug fix), ale rovnaká prísnosť:
// dôkaz atomickosti (kompenzačný delete zmaže aj položky, duplikát nezapíše nič) a
// dôkaz 1:1 zhody s job.polozky.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-odpis-polozky-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '0';
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'odpis-export');

const { writeOdpis, listOdpisPolozky, listOdpisy } = await import('../src/lib/server/money');
const { db } = await import('../src/lib/server/db');
import type { OdpisJob } from '../src/lib/server/money';

function makeJob(zak: string, op: string, polozky: OdpisJob['polozky']): OdpisJob {
	return {
		modul: 'zasklenia',
		zak,
		op,
		zakaznik: 'Test Zákazník',
		caka: false,
		createdBy: 'vitest',
		cakaSubdir: 'Robust',
		popis: (op + ' : Test Zákazník').trim(),
		polozky,
		detail: {}
	};
}

describe('writeOdpis → odpis_polozky', () => {
	beforeAll(() => {
		fs.mkdirSync(process.env.MONEY_TEST_DIR!, { recursive: true });
	});

	it('položky sa zapíšu 1:1 s job.polozky (kód, názov, množstvo, MJ)', async () => {
		const job = makeJob('ZAK-POL-1', '01', [
			{ kod: 'ZASP00014', nazov: 'Koľajnica 2K Surový 7500 mm', qty: 15 },
			{ kod: 'ZASK00027', nazov: 'Kladka RS ROBUST', qty: 4, mj: 'ks' }
		]);
		const out = await writeOdpis(job);
		expect(out.status).toBe('written');
		const row = listOdpisy(200).find((o) => o.zak === 'ZAK-POL-1' && o.op === '01')!;
		const items = listOdpisPolozky(row.id);
		expect(items).toEqual([
			{ kod: 'ZASP00014', nazov: 'Koľajnica 2K Surový 7500 mm', qty: 15, mj: 'm' },
			{ kod: 'ZASK00027', nazov: 'Kladka RS ROBUST', qty: 4, mj: 'ks' }
		]);
	});

	it('duplikát (rovnaká ZAK+OP) nezapíše ŽIADNE nové položky (transakcia sa rollbackla)', async () => {
		const job = makeJob('ZAK-POL-1', '01', [{ kod: 'ZASP00099', nazov: 'Iný profil', qty: 99 }]);
		const before = (db.prepare('SELECT COUNT(*) c FROM odpis_polozky').get() as { c: number }).c;
		const out = await writeOdpis(job);
		expect(out.status).toBe('duplicate');
		const after = (db.prepare('SELECT COUNT(*) c FROM odpis_polozky').get() as { c: number }).c;
		expect(after).toBe(before);
	});

	it('zlyhanie zápisu súboru zruší CELÚ transakciu — ani odpis_log, ani odpis_polozky', async () => {
		const orig = process.env.MONEY_TEST_DIR!;
		const blocked = path.join(tmpRoot, 'blocked-polozky');
		fs.writeFileSync(blocked, 'x'); // "priečinok" je súbor → mkdir/rename zlyhá
		process.env.MONEY_TEST_DIR = blocked;
		const job = makeJob('ZAK-POL-FAIL', '01', [{ kod: 'ZASP00050', nazov: 'X', qty: 5 }]);
		await expect(writeOdpis(job)).rejects.toThrow();
		process.env.MONEY_TEST_DIR = orig;

		const row = listOdpisy(200).find((o) => o.zak === 'ZAK-POL-FAIL');
		expect(row).toBeUndefined(); // dedup kľúč uvoľnený (kompenzácia)
		const items = (
			db.prepare("SELECT COUNT(*) c FROM odpis_polozky WHERE kod = 'ZASP00050'").get() as {
				c: number;
			}
		).c;
		expect(items).toBe(0); // FK CASCADE zmazal by ich, keby vôbec vznikli

		// opakované odoslanie po zlyhaní prejde a MÁ svoje položky
		const retry = await writeOdpis(job);
		expect(retry.status).toBe('written');
		const retryRow = listOdpisy(200).find((o) => o.zak === 'ZAK-POL-FAIL')!;
		expect(listOdpisPolozky(retryRow.id)).toEqual([
			{ kod: 'ZASP00050', nazov: 'X', qty: 5, mj: 'm' }
		]);
	});

	it('listOdpisPolozky: neplatné/chýbajúce id vráti prázdne pole (nikdy nespadne)', () => {
		expect(listOdpisPolozky(0)).toEqual([]);
		expect(listOdpisPolozky(-1)).toEqual([]);
		expect(listOdpisPolozky(999999)).toEqual([]);
	});

	it('prázdny zoznam položiek (job.polozky = []) zapíše log bez chyby a s 0 položkami', async () => {
		const job = makeJob('ZAK-POL-EMPTY', '01', []);
		const out = await writeOdpis(job);
		expect(out.status).toBe('written');
		const row = listOdpisy(200).find((o) => o.zak === 'ZAK-POL-EMPTY')!;
		expect(listOdpisPolozky(row.id)).toEqual([]);
	});
});
