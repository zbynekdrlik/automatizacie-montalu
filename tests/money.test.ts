// Integračné testy zápisu odpisu: dedup constraint, atomický zápis, kompenzácia
// pri zlyhaní, formát xlsx (6 stĺpcov ako Money import očakáva).
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-money-test-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '0';
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'odpis-export');

// import až PO nastavení env (db.ts číta DATABASE_PATH pri importe)
const { writeOdpis, safe, targetDirFor, contentHash, releaseOdpis, listOdpisy, filenameFor } =
	await import('../src/lib/server/money');
const { loadCfg, db } = await import('../src/lib/server/db');
const { safeCompute } = await import('../src/lib/server/compute');
import type { OdpisJob } from '../src/lib/server/money';

function makeReq(zak: string, op: string, modul: OdpisJob['modul'] = 'zasklenia'): OdpisJob {
	const cfg = loadCfg();
	const { r, err } = safeCompute(cfg, 'Robust|2K', 2509, 1930, false);
	expect(err).toBeNull();
	return {
		modul,
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

// Šéf 2026-07-29 (foto z Money import priečinka): názov bol
// „ZAK2025428 - OPOP250359 - PERGOLA Zákazník A PERGOLA [4d2d4db1].xlsx" —
// kód lepil „OP" pred to, čo užívateľ do kolónky napísal (a on tam OP píše).
// Nový tvar: len číslo zákazky + zákazník.
describe('filenameFor — ZAK - zákazník, žiadne OP', () => {
	const polozky = [{ kod: 'PRP20258', nazov: 'Kotviaci profil', qty: 7.5 }];

	it('nezdvojí OP, keď ho užívateľ napíše do kolónky', () => {
		const f = filenameFor({ zak: 'ZAK2025428', op: 'OP250359', zakaznik: 'Zákazník A', polozky });
		expect(f).not.toContain('OPOP');
		expect(f).toMatch(/^ZAK2025428 - Zákazník A \[[0-9a-f]{8}\]\.xlsx$/);
	});

	it('OP sa v názve neobjaví ani keď ho užívateľ napíše bez prefixu', () => {
		const f = filenameFor({ zak: 'ZAK2026337', op: '260286', zakaznik: 'Zákazník B', polozky });
		expect(f).toMatch(/^ZAK2026337 - Zákazník B \[[0-9a-f]{8}\]\.xlsx$/);
	});

	// bez OP v názve by dva odpisy tej istej zákazky s rovnakým obsahom mali
	// rovnaký názov — druhý by prvý v Money import priečinku PREPÍSAL
	it('dve rôzne OP tej istej zákazky majú rôzny súbor aj pri rovnakom obsahu', () => {
		const a = filenameFor({ zak: 'ZAK1', op: '01', zakaznik: 'Novák', polozky });
		const b = filenameFor({ zak: 'ZAK1', op: '02', zakaznik: 'Novák', polozky });
		expect(a).not.toBe(b);
	});

	it('sanitizuje znaky, ktoré Windows v názve nepovolí', () => {
		expect(filenameFor({ zak: 'ZAK/1', op: '1', zakaznik: 'A:B?', polozky })).toContain(
			'ZAK_1 - A_B_ ['
		);
	});
});

describe('writeOdpis', () => {
	beforeAll(() => {
		fs.mkdirSync(process.env.MONEY_TEST_DIR!, { recursive: true });
	});

	it('zapíše xlsx so 6 stĺpcami a správnymi hodnotami', async () => {
		const out = await writeOdpis(makeReq('TEST-1', '01'));
		expect(out.status).toBe('written');
		expect(out.live).toBe(false);
		expect(out.filename).toContain('TEST-1 - Test Zákazník');
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

	// jednotka v xlsx: profily 'm' (default, ako doteraz), kovanie 'ks' (Dominik 2026-07-28).
	// Money má MJ na karte zásoby — keby appka poslala 'm' na kusovú položku, naveze sa
	// nesprávne množstvo, preto to má vlastný test.
	it('MJ: bez `mj` zostáva "m" (spätná kompatibilita metrážových položiek)', async () => {
		const out = await writeOdpis(makeReq('TEST-MJ-DEF', '01'));
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.readFile(out.target);
		const ws = wb.getWorksheet('Hárok2')!;
		for (let i = 2; i <= ws.rowCount; i++)
			expect((ws.getRow(i).values as unknown[]).slice(1)[4]).toBe('m');
	});

	it('MJ: kusová položka kovania sa zapíše ako "ks" a metrážová vedľa nej ako "m"', async () => {
		const job = makeReq('TEST-MJ-KS', '01');
		job.polozky = [
			{ kod: 'ZASP00014', nazov: 'Koľajnica 2K Surový 7500 mm', qty: 15 },
			{ kod: 'ZASK00027', nazov: 'Kladka RS ROBUST', qty: 4, mj: 'ks' },
			{ kod: 'ZASK20242', nazov: 'Tesnenie zasklievacie 12', qty: 12.5, mj: 'm' }
		];
		const out = await writeOdpis(job);
		const wb = new ExcelJS.Workbook();
		await wb.xlsx.readFile(out.target);
		const ws = wb.getWorksheet('Hárok2')!;
		const mj = (r: number) => (ws.getRow(r).values as unknown[]).slice(1)[4];
		const qty = (r: number) => (ws.getRow(r).values as unknown[]).slice(1)[3];
		expect([mj(2), mj(3), mj(4)]).toEqual(['m', 'ks', 'm']);
		expect([qty(2), qty(3), qty(4)]).toEqual([15, 4, 12.5]);
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

	it('iný MODUL tej istej ZAK+OP prejde (pergola aj bazén aj zasklenia na jednej zákazke)', async () => {
		const out = await writeOdpis(makeReq('TEST-1', '01', 'bazen'));
		expect(out.status).toBe('written');
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

// targetDirFor rozhoduje, KAM sa odpis zapíše — Money-kritické smerovanie.
// money.test.ts inak beží vždy caka:false → vetva if(caka) bola nepokrytá.
describe('targetDirFor — smerovanie podľa LIVE + čaká', () => {
	afterEach(() => {
		process.env.MONEY_LIVE = '0';
		delete process.env.MONEY_LIVE_DIR;
		delete process.env.MONEY_NA_ODPIS_DIR;
	});

	it('TEST režim: všetko (aj čaká) ide do testDir — do Money NIKDY nič testovacie', () => {
		process.env.MONEY_LIVE = '0';
		expect(targetDirFor('Bazen', false)).toBe(process.env.MONEY_TEST_DIR);
		expect(targetDirFor('Bazen', true)).toBe(process.env.MONEY_TEST_DIR);
	});

	it('LIVE + nečaká: priamo do live importu (dlv-import)', () => {
		process.env.MONEY_LIVE = '1';
		process.env.MONEY_LIVE_DIR = '/data/dlv-import';
		expect(targetDirFor('Bazen', false)).toBe('/data/dlv-import');
		expect(targetDirFor('Robust', false)).toBe('/data/dlv-import');
	});

	it('LIVE + čaká: do NA ODPIS/<subdir>, nie do live importu', () => {
		process.env.MONEY_LIVE = '1';
		process.env.MONEY_NA_ODPIS_DIR = '/data/dlv-import/NA ODPIS';
		expect(targetDirFor('Bazen', true)).toBe(path.join('/data/dlv-import/NA ODPIS', 'Bazen'));
		expect(targetDirFor('Pergola', true)).toBe(path.join('/data/dlv-import/NA ODPIS', 'Pergola'));
		expect(targetDirFor('Slide', true)).toBe(path.join('/data/dlv-import/NA ODPIS', 'Slide'));
	});
});

// contentHash = planHash strážca: zápis potvrdí len PRESNE to, čo užívateľ videl
// v náhľade. Ak sa medzitým zmenia vzorce → iný hash → zápis sa zablokuje.
describe('contentHash — planHash strážca', () => {
	it('rovnaké položky v inom poradí = rovnaký hash', () => {
		const a = contentHash('ZAK1', [
			{ kod: 'X', nazov: '', qty: 5 },
			{ kod: 'Y', nazov: '', qty: 3 }
		]);
		const b = contentHash('ZAK1', [
			{ kod: 'Y', nazov: '', qty: 3 },
			{ kod: 'X', nazov: '', qty: 5 }
		]);
		expect(a).toBe(b);
	});

	it('zmena množstva = INÝ hash (odpis by nesedel s náhľadom → zápis zablokovaný)', () => {
		const a = contentHash('ZAK1', [{ kod: 'X', nazov: '', qty: 5 }]);
		const b = contentHash('ZAK1', [{ kod: 'X', nazov: '', qty: 6 }]);
		expect(a).not.toBe(b);
	});

	it('zmena ZAK = iný hash', () => {
		const a = contentHash('ZAK1', [{ kod: 'X', nazov: '', qty: 5 }]);
		const b = contentHash('ZAK2', [{ kod: 'X', nazov: '', qty: 5 }]);
		expect(a).not.toBe(b);
	});
});

// releaseOdpis = jediná legitímna cesta na re-odoslanie tej istej ZAK+OP.
// Deštruktívne (maže dedup záznam) + auditované → bez testu nikdy.
describe('releaseOdpis — uvoľnenie dedup kľúča', () => {
	const auditCount = () =>
		(db.prepare("SELECT COUNT(*) n FROM cfg_audit WHERE sys_styl = 'odpis'").get() as { n: number })
			.n;

	it('write → duplicate → release → audit → re-write prejde', async () => {
		const w = await writeOdpis(makeReq('TEST-REL', '01'));
		expect(w.status).toBe('written');
		expect((await writeOdpis(makeReq('TEST-REL', '01'))).status).toBe('duplicate');

		const row = listOdpisy(200).find((o) => o.zak === 'TEST-REL' && o.op === '01');
		expect(row).toBeTruthy();

		const before = auditCount();
		expect(releaseOdpis(row!.id, 'tester')).toBe(true);

		// (a) riadok zmizol z odpis_log
		expect(listOdpisy(200).some((o) => o.id === row!.id)).toBe(false);
		// (b) audit pribudol s textom o uvoľnení
		expect(auditCount()).toBe(before + 1);
		const audit = db
			.prepare("SELECT zmeny FROM cfg_audit WHERE sys_styl = 'odpis' ORDER BY id DESC LIMIT 1")
			.get() as { zmeny: string };
		expect(audit.zmeny).toContain('Uvoľnený odpis');
		expect(audit.zmeny).toContain('TEST-REL');
		// (c) opätovný zápis tej istej ZAK+OP prejde
		expect((await writeOdpis(makeReq('TEST-REL', '01'))).status).toBe('written');
	});

	it('neplatné id (0, neexistujúce) → false, žiadny audit záznam', () => {
		const before = auditCount();
		expect(releaseOdpis(0, 't')).toBe(false);
		expect(releaseOdpis(999999, 't')).toBe(false);
		expect(auditCount()).toBe(before);
	});
});
