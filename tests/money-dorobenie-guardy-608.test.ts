// #608 dorobenie — poistky, ktoré dorobenie NESMIE obísť, + TEST režim (live=0).
//   - TEST režim: dedup blokoval aj doteraz (`duplicate`) → teraz rovnaký blok `uz-odpisane` + vedomé
//     dorobenie ako na live (E2E beží v TEST), súbor ide VÝLUČNE do TEST priečinka.
//   - Cross-modul identický obsah (issue 380 — FIX z CADu reusuje pergola katalóg): ostáva TVRDÝ
//     `duplicate` aj s potvrdením dorobenia (dorobenie je per modul; presun rovnakého nárezu medzi
//     /pergola a /fix sa ním obísť nedá).
//   - Pergola rezervácia (issue 221): rezervácia a CAD odpis tej istej ZAK+OP kolidujú ZÁMERNE (bráni
//     dvojitému odpisu materiálu) → ostáva tvrdý `duplicate`, žiadne dorobenie.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-dorobenie-guardy-608-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '0';
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'odpis-export');
process.env.MONEY_LIVE_DIR = path.join(tmpRoot, 'nikdy-live'); // keby sa TEST pomýlil, uvidíme to

const { writeOdpis } = await import('../src/lib/server/money');
const { db } = await import('../src/lib/server/db');
import type { OdpisJob, Polozka } from '../src/lib/server/money';

const TEST_DIR = process.env.MONEY_TEST_DIR!;
const POL: Polozka[] = [{ kod: 'PRP20258', nazov: 'Kotviaci profil', qty: 7.5 }];

function job(
	zak: string,
	op: string,
	modul: OdpisJob['modul'] = 'zasklenia',
	extra = {}
): OdpisJob {
	return {
		modul,
		zak,
		op,
		zakaznik: 'Test',
		caka: false,
		createdBy: 'vitest',
		cakaSubdir: 'Robust',
		popis: `${op} : Test`,
		polozky: POL,
		detail: {},
		...extra
	};
}
const pocet = (zak: string) =>
	(db.prepare('SELECT COUNT(*) c FROM odpis_log WHERE zak = ?').get(zak) as { c: number }).c;

beforeAll(() => {
	fs.mkdirSync(TEST_DIR, { recursive: true });
});

describe('#608 TEST režim (live=0) — rovnaký blok aj dorobenie, nikdy do Money', () => {
	it('[RED] druhé TEST odoslanie bez potvrdenia → blocked `uz-odpisane`, nič nezapísané', async () => {
		expect((await writeOdpis(job('TST-608', 'OP1'))).status).toBe('written');
		const pred = fs.readdirSync(TEST_DIR).length;
		const b = await writeOdpis(job('TST-608', 'OP1'));
		expect(b.status).toBe('blocked');
		expect(b.reason).toBe('uz-odpisane');
		expect(b.live).toBe(false);
		expect(pocet('TST-608')).toBe(1);
		expect(fs.readdirSync(TEST_DIR).length).toBe(pred);
	});

	it('[RED] TEST dorobenie s potvrdením → poradie 2 v TEST priečinku, live priečinok nevznikne', async () => {
		const w = await writeOdpis(job('TST-608', 'OP1'), { overrideDorobenie: true, dorobeniePo: 1 });
		expect(w.status).toBe('written');
		expect(w.poradie).toBe(2);
		expect(path.dirname(w.target)).toBe(TEST_DIR);
		expect(fs.existsSync(process.env.MONEY_LIVE_DIR!)).toBe(false);
		expect(pocet('TST-608')).toBe(2);
	});
});

describe('#608 cross-modul identický obsah (issue 380) — dorobenie ho NEobíde', () => {
	it('[guard] fix s obsahom identickým s pergolou → duplicate aj s potvrdením dorobenia', async () => {
		expect((await writeOdpis(job('CROSS-608', 'OP1', 'pergola'))).status).toBe('written');
		const f = await writeOdpis(job('CROSS-608', 'OP1', 'fix'), {
			overrideDorobenie: true,
			dorobeniePo: 1
		});
		expect(f.status).toBe('duplicate');
		expect(pocet('CROSS-608')).toBe(1);
	});

	it('[guard] dorobenie VO FIX s obsahom identickým s pergolou → duplicate (presun nárezu sa neprepašuje)', async () => {
		// FIX má vlastný (iný) odpis tej istej ZAK+OP …
		const iny = job('CROSS2-608', 'OP1', 'fix');
		iny.polozky = [{ kod: 'PRP20259', nazov: 'Iný profil', qty: 3 }];
		expect((await writeOdpis(iny)).status).toBe('written');
		// … a pergola má obsah X
		expect((await writeOdpis(job('CROSS2-608', 'OP1', 'pergola'))).status).toBe('written');
		// „dorobenie" FIX-u s obsahom X (= pergola nárez) musí ostať tvrdo zablokované
		const d = await writeOdpis(job('CROSS2-608', 'OP1', 'fix'), {
			overrideDorobenie: true,
			dorobeniePo: 1
		});
		expect(d.status).toBe('duplicate');
		expect(pocet('CROSS2-608')).toBe(2);
	});

	it('[guard] cross-modul duplikát má prednosť pred blokom `uz-odpisane` (operátorovi neponúkne zbytočné dorobenie)', async () => {
		const d = await writeOdpis(job('CROSS2-608', 'OP1', 'fix'));
		expect(d.status).toBe('duplicate');
	});
});

describe('#608 pergola rezervácia (issue 221) — kolízia s CAD odpisom ostáva tvrdá', () => {
	it('[guard] existujúca rezervácia + CAD odpis tej istej ZAK+OP → duplicate aj s potvrdením', async () => {
		const rez = job('REZ-608', 'OP1', 'pergola', {
			rezervacia: true,
			detail: { rezervacia: true }
		});
		expect((await writeOdpis(rez)).status).toBe('written');
		const cad = job('REZ-608', 'OP1', 'pergola');
		cad.polozky = [{ kod: 'PRP20260', nazov: 'CAD profil', qty: 6 }];
		expect((await writeOdpis(cad)).status).toBe('duplicate');
		expect((await writeOdpis(cad, { overrideDorobenie: true, dorobeniePo: 1 })).status).toBe(
			'duplicate'
		);
		expect(pocet('REZ-608')).toBe(1);
	});

	it('[guard] druhá rezervácia nad existujúcim odpisom → duplicate (rezervácia nie je dorobenie)', async () => {
		const cad = job('REZ2-608', 'OP1', 'pergola');
		expect((await writeOdpis(cad)).status).toBe('written');
		const rez = job('REZ2-608', 'OP1', 'pergola', {
			rezervacia: true,
			detail: { rezervacia: true }
		});
		rez.polozky = [{ kod: 'PRP20261', nazov: 'Rez profil', qty: 2 }];
		expect((await writeOdpis(rez, { overrideDorobenie: true, dorobeniePo: 1 })).status).toBe(
			'duplicate'
		);
		expect(pocet('REZ2-608')).toBe(1);
	});
});
