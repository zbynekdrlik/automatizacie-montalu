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

const { writeOdpis, normZak, normOp } = await import('../src/lib/server/money');
const { potvrdenieTokenPre } = await import('../src/lib/server/money-dedup');
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
/** PLATNÝ token potvrdenia v tejto chvíli (ten, ktorý by operátor dostal v bloku) — hard-duplicate
 *  poistky musia držať aj proti PLATNÉMU potvrdeniu dorobenia, nie len proti neplatnému. */
const platny = (modul: OdpisJob['modul'], zak: string, op: string) =>
	potvrdenieTokenPre(modul, 0, normZak(zak), normOp(op), zak, op);
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
		const b = await writeOdpis(job('TST-608', 'OP1'));
		const w = await writeOdpis(job('TST-608', 'OP1'), {
			overrideDorobenie: true,
			potvrdenieToken: b.potvrdenieToken
		});
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
			potvrdenieToken: platny('fix', 'CROSS-608', 'OP1')
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
		// „dorobenie" FIX-u s obsahom X (= pergola nárez) musí ostať tvrdo zablokované — aj s PLATNÝM
		// tokenom, ktorý FIX blok (iný obsah) reálne vráti
		const tok = platny('fix', 'CROSS2-608', 'OP1');
		const iny2 = job('CROSS2-608', 'OP1', 'fix');
		iny2.polozky = [{ kod: 'PRP20262', nazov: 'Ďalší profil', qty: 1 }];
		const blokFix = await writeOdpis(iny2);
		expect(blokFix.reason).toBe('uz-odpisane');
		expect(blokFix.potvrdenieToken).toBe(tok);
		const d = await writeOdpis(job('CROSS2-608', 'OP1', 'fix'), {
			overrideDorobenie: true,
			potvrdenieToken: tok
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
		const tok = platny('pergola', 'REZ-608', 'OP1');
		expect(tok).toBeGreaterThan(0);
		expect((await writeOdpis(cad, { overrideDorobenie: true, potvrdenieToken: tok })).status).toBe(
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
		const tok = platny('pergola', 'REZ2-608', 'OP1');
		expect(tok).toBeGreaterThan(0);
		expect((await writeOdpis(rez, { overrideDorobenie: true, potvrdenieToken: tok })).status).toBe(
			'duplicate'
		);
		expect(pocet('REZ2-608')).toBe(1);
		// ten istý token JE platný — bežné CAD dorobenie (nie rezervácia) s ním prejde, takže duplikát
		// vyššie spôsobila rezervácia, nie neplatné potvrdenie
		const cad2 = job('REZ2-608', 'OP1', 'pergola');
		cad2.polozky = [{ kod: 'PRP20263', nazov: 'CAD profil 2', qty: 4 }];
		const ok = await writeOdpis(cad2, { overrideDorobenie: true, potvrdenieToken: tok });
		expect(ok.status).toBe('written');
		expect(ok.poradie).toBe(2);
	});
});
