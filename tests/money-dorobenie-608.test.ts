// #608 (Odoo úloha 1380, Patrik 8.10.: „nech ma to upozorní že už je jeden vytvorený ale nech mi
// to dovolí odpísať") — druhý odpis tej istej zákazky/OP v tom istom module = DOROBENIE (zlé
// zameranie, posuv sa vyrába znova). Dnes `writeOdpis` vráti tvrdý `duplicate`; po oprave:
//   - bez potvrdenia → `status:'blocked', reason:'uz-odpisane'` PRED akýmkoľvek zápisom (náhodný
//     dvojklik / refresh nič nezapíše),
//   - s potvrdením „Odoslať ako dorobenie" (`overrideDorobenie` + token `dorobeniePo` = poradie, ktoré
//     operátor videl) → nový záznam s `poradie = max+1`, vlastný súbor (prípona dorobenia), audit v
//     `cfg_audit`, prvý záznam NEZMENENÝ; identický obsah (ledger) prekoná TO ISTÉ potvrdenie,
//   - opätovné odoslanie toho istého potvrdenia (refresh výsledku, dvojklik) → znova blok.
// MONEY_LIVE=1, ale VŠETKY cieľové adresáre sú TEMP — do reálneho /data/dlv-import NIKDY nič.
// Snapshot ani Odoo nie sú dostupné → #295 kódová validácia sa nespustí (testuje sa čisto dorobenie).
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-dorobenie-608-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.MONEY_LIVE = '1';
process.env.MONEY_LIVE_DIR = path.join(tmpRoot, 'dlv-import'); // TEMP, nikdy reálny import dir
process.env.MONEY_NA_ODPIS_DIR = path.join(tmpRoot, 'dlv-import', 'NA ODPIS'); // TEMP staging
process.env.MONEY_TEST_DIR = path.join(tmpRoot, 'test-export'); // TEMP
process.env.CENY_SNAPSHOT_PATH = path.join(tmpRoot, 'neexistuje.json'); // #295 sa nespustí

const {
	writeOdpis,
	blokHlaska,
	overrideOpts,
	rawFormEntries,
	releaseOdpis,
	povolitReimport,
	listOdpisy
} = await import('../src/lib/server/money');
const { db } = await import('../src/lib/server/db');
import type { OdpisJob, OdpisOutcome, Polozka } from '../src/lib/server/money';

const LIVE_DIR = process.env.MONEY_LIVE_DIR!;

function job(zak: string, op: string, polozky?: Polozka[], modul: OdpisJob['modul'] = 'zasklenia') {
	const j: OdpisJob = {
		modul,
		zak,
		op,
		zakaznik: 'Javorský',
		caka: false,
		createdBy: 'patrik',
		cakaSubdir: 'Robust',
		popis: `${op} : Javorský`,
		polozky: polozky ?? [
			{ kod: 'ZASP00014', nazov: 'Koľajnica 2K', qty: 15 },
			{ kod: 'ZASK00027', nazov: 'Kladka RS ROBUST', qty: 4, mj: 'ks' }
		],
		detail: { system: 'Robust', styl: '2K', s: 2509, v: 1930 }
	};
	return j;
}

type LogRow = {
	id: number;
	modul: string;
	zak: string;
	op: string;
	live: number;
	filename: string;
	target: string;
	content_hash: string;
	created_by: string;
	created_at: string;
	poradie: number;
};
const rowsFor = (zak: string): LogRow[] =>
	db.prepare('SELECT * FROM odpis_log WHERE zak = ? ORDER BY id').all(zak) as unknown as LogRow[];
const auditCount = () =>
	(db.prepare("SELECT COUNT(*) c FROM cfg_audit WHERE sys_styl = 'odpis'").get() as { c: number })
		.c;
const lastAudit = () =>
	(
		db
			.prepare("SELECT zmeny FROM cfg_audit WHERE sys_styl = 'odpis' ORDER BY id DESC LIMIT 1")
			.get() as {
			zmeny: string;
		}
	).zmeny;
const ledger = (zakNorm: string) =>
	db
		.prepare('SELECT kind, reason FROM odpis_imported WHERE zak_norm = ? AND live = 1 ORDER BY id')
		.all(zakNorm) as { kind: string; reason: string | null }[];
const liveFiles = () => fs.readdirSync(LIVE_DIR).filter((f) => f.endsWith('.xlsx'));

beforeAll(() => {
	fs.mkdirSync(LIVE_DIR, { recursive: true });
	fs.mkdirSync(process.env.MONEY_TEST_DIR!, { recursive: true });
});

describe('#608 dorobenie — druhý live odpis tej istej zákazky/OP', () => {
	it('[RED] bez potvrdenia → blocked `uz-odpisane`, NIČ sa nezapíše (žiadny riadok, súbor, ledger)', async () => {
		const w1 = await writeOdpis(job('ZAK2026901', 'OP261380'));
		expect(w1.status).toBe('written');
		const subory = liveFiles().length;
		const ledgerPred = ledger('ZAK2026901').length;
		const auditPred = auditCount();

		const w2 = await writeOdpis(job('ZAK2026901', 'OP261380'));
		expect(w2.status).toBe('blocked');
		expect(w2.reason).toBe('uz-odpisane');
		expect(w2.duplicateCreatedAt).toBe(rowsFor('ZAK2026901')[0]!.created_at);
		expect(w2.duplicateCreatedBy).toBe('patrik');
		expect(w2.poradieMax).toBe(1);
		expect(w2.pocetOdpisov).toBe(1);
		expect(rowsFor('ZAK2026901').length).toBe(1);
		expect(liveFiles().length).toBe(subory);
		expect(ledger('ZAK2026901').length).toBe(ledgerPred);
		expect(auditCount()).toBe(auditPred); // blok sám nič neauditne
	});

	it('[RED] s potvrdením → written, poradie 2, vlastný súbor s príponou dorobenia, audit, prvý riadok nezmenený', async () => {
		const prvy = rowsFor('ZAK2026901')[0]!;
		const auditPred = auditCount();
		const w = await writeOdpis(job('ZAK2026901', 'OP261380'), {
			overrideDorobenie: true,
			dorobeniePo: 1
		});
		expect(w.status).toBe('written');
		expect(w.poradie).toBe(2);
		expect(w.filename).toContain('dorobenie-2');
		expect(w.filename.endsWith('.xlsx')).toBe(true);
		expect(w.filename).not.toBe(prvy.filename);
		expect(fs.existsSync(w.target)).toBe(true);
		// prvý súbor v import priečinku NEprepísaný (Money ho ešte nemusel spracovať)
		expect(fs.existsSync(prvy.target)).toBe(true);

		const rows = rowsFor('ZAK2026901');
		expect(rows.map((r) => r.poradie)).toEqual([1, 2]);
		expect(rows[0]).toEqual(prvy); // prvý odpis ostáva v histórii NEZMENENÝ
		expect(rows[1]!.filename).toBe(w.filename);

		// audit vedomého dorobenia (kto + čo) — JEDEN riadok, nie tichý bypass
		expect(auditCount()).toBe(auditPred + 1);
		expect(lastAudit()).toContain('Dorobenie č. 2');
		expect(lastAudit()).toContain('ZAK2026901');
	});

	it('[RED] identický obsah (ledger) prekoná TO ISTÉ potvrdenie — override riadok s dôvodom dorobenia', async () => {
		const l = ledger('ZAK2026901');
		// import (1. odpis) → override (dorobenie) → import (dorobenie)
		expect(l.map((x) => x.kind)).toEqual(['import', 'override', 'import']);
		expect(l[1]!.reason).toContain('dorobenie');
	});

	it('[RED] refresh / dvojklik PO potvrdení (ten istý token) → znova blok, žiadne poradie 3', async () => {
		const subory = liveFiles().length;
		const w = await writeOdpis(job('ZAK2026901', 'OP261380'), {
			overrideDorobenie: true,
			dorobeniePo: 1 // operátor videl poradie 1 — medzitým vzniklo 2 → zastarané potvrdenie
		});
		expect(w.status).toBe('blocked');
		expect(w.reason).toBe('uz-odpisane');
		expect(w.poradieMax).toBe(2);
		expect(w.pocetOdpisov).toBe(2);
		expect(rowsFor('ZAK2026901').length).toBe(2);
		expect(liveFiles().length).toBe(subory);
	});

	it('[RED] potvrdenie BEZ tokenu (len override pole) sa neprijme', async () => {
		const w = await writeOdpis(job('ZAK2026901', 'OP261380'), { overrideDorobenie: true });
		expect(w.status).toBe('blocked');
		expect(w.reason).toBe('uz-odpisane');
		expect(rowsFor('ZAK2026901').length).toBe(2);
	});

	it('[RED] súbežný dvojklik na „Odoslať ako dorobenie" → práve JEDNO dorobenie', async () => {
		const zak = 'ZAK2026902';
		expect((await writeOdpis(job(zak, 'OP261381'))).status).toBe('written');
		const res = await Promise.all([
			writeOdpis(job(zak, 'OP261381'), { overrideDorobenie: true, dorobeniePo: 1 }),
			writeOdpis(job(zak, 'OP261381'), { overrideDorobenie: true, dorobeniePo: 1 })
		]);
		expect(res.filter((r) => r.status === 'written').length).toBe(1);
		expect(res.filter((r) => r.status === 'blocked' && r.reason === 'uz-odpisane').length).toBe(1);
		expect(rowsFor(zak).map((r) => r.poradie)).toEqual([1, 2]);
	});

	it('[RED] ďalšie dorobenie (č. 3) s aktuálnym tokenom prejde; iný obsah = bez ledger override', async () => {
		const zak = 'ZAK2026902';
		const iny: Polozka[] = [{ kod: 'ZASP00014', nazov: 'Koľajnica 2K', qty: 7.5 }];
		const w = await writeOdpis(job(zak, 'OP261381', iny), {
			overrideDorobenie: true,
			dorobeniePo: 2
		});
		expect(w.status).toBe('written');
		expect(w.poradie).toBe(3);
		expect(w.filename).toContain('dorobenie-3');
		// iný obsah nemal čo prekonať v ledgeri → žiadny override riadok pre tento hash
		const overridy = (
			db
				.prepare(
					"SELECT COUNT(*) c FROM odpis_imported WHERE zak_norm = ? AND kind = 'override' AND content_hash = (SELECT content_hash FROM odpis_log WHERE zak = ? AND poradie = 3)"
				)
				.get(zak, zak) as { c: number }
		).c;
		expect(overridy).toBe(0);
		// audit dorobenia NEtvrdí prekonaný ledger, keď nebolo čo prekonať (iný obsah)
		expect(lastAudit()).toContain('Dorobenie č. 3');
		expect(lastAudit()).not.toContain('ledger prekonaný');
	});

	it('audit dorobenia s identickým obsahom prizná prekonaný ledger', async () => {
		const zak = 'ZAK2026904';
		expect((await writeOdpis(job(zak, 'OP261384'))).status).toBe('written');
		const w = await writeOdpis(job(zak, 'OP261384'), { overrideDorobenie: true, dorobeniePo: 1 });
		expect(w.status).toBe('written');
		expect(lastAudit()).toContain('identický obsah — ledger prekonaný');
		// prvý odpis (poradie 1) má názov súboru BEZ označenia dorobenia
		expect(rowsFor(zak)[0]!.filename).not.toContain('dorobenie');
	});

	it('[RED] normalizované OP (OP261382 ≡ 261382) — blok aj dorobenie fungujú cez zak_norm/op_norm', async () => {
		const zak = 'ZAK2026903';
		expect((await writeOdpis(job(zak, 'OP261382'))).status).toBe('written');
		const b = await writeOdpis(job(zak, '261382'));
		expect(b.status).toBe('blocked');
		expect(b.reason).toBe('uz-odpisane');
		const w = await writeOdpis(job(zak, '261382'), { overrideDorobenie: true, dorobeniePo: 1 });
		expect(w.status).toBe('written');
		expect(w.poradie).toBe(2);
	});

	it('[RED] „Uvoľniť" funguje PER RIADOK — uvoľnenie dorobenia nechá prvý odpis, audit nesie poradie', async () => {
		const zak = 'ZAK2026903';
		const [r1, r2] = rowsFor(zak) as [LogRow, LogRow];
		expect(releaseOdpis(r2.id, 'marek')).toBe(true);
		expect(lastAudit()).toContain('dorobenie 2');
		expect(rowsFor(zak).map((r) => r.id)).toEqual([r1.id]);
		// po uvoľnení dorobenia je ďalšie dorobenie znova č. 2 (token = aktuálne max poradie 1)
		const w = await writeOdpis(job(zak, 'OP261382', [{ kod: 'ZASP00014', nazov: 'K', qty: 3 }]), {
			overrideDorobenie: true,
			dorobeniePo: 1
		});
		expect(w.status).toBe('written');
		expect(w.poradie).toBe(2);
		// uvoľnenie PRVÉHO nechá dorobenie (nič sa nekaskáduje medzi riadkami)
		expect(releaseOdpis(r1.id, 'marek')).toBe(true);
		expect(lastAudit()).not.toContain('(dorobenie');
		expect(rowsFor(zak).map((r) => r.poradie)).toEqual([2]);
	});

	it('„Povoliť rovnaký" na riadku dorobenia: audit nesie poradie, ostatné riadky ostanú', async () => {
		const zak = 'ZAK2026905';
		expect((await writeOdpis(job(zak, 'OP261385'))).status).toBe('written');
		expect(
			(await writeOdpis(job(zak, 'OP261385'), { overrideDorobenie: true, dorobeniePo: 1 })).status
		).toBe('written');
		const [r1, r2] = rowsFor(zak) as [LogRow, LogRow];
		expect(povolitReimport(r2.id, 'marek')).toBe(true);
		expect(lastAudit()).toContain('Povolený RE-IMPORT');
		expect(lastAudit()).toContain('(dorobenie 2)');
		expect(rowsFor(zak).map((r) => r.id)).toEqual([r1.id]);
	});

	it('[RED] listOdpisy vracia poradie (história /odpisy ukáže číslo dorobenia)', () => {
		const zoznam = listOdpisy(500).filter((o) => o.zak === 'ZAK2026901');
		expect(zoznam.map((o) => o.poradie).sort()).toEqual([1, 2]);
	});
});

describe('#608 dorobenie — hláška, formulárové mapovanie, re-submit token', () => {
	const blok: OdpisOutcome = {
		status: 'blocked',
		reason: 'uz-odpisane',
		live: true,
		target: '/x',
		filename: 'x.xlsx',
		duplicateCreatedAt: '2026-10-08 07:26:00',
		duplicateCreatedBy: 'patrik',
		poradieMax: 1,
		pocetOdpisov: 1
	};

	it('[RED] blokHlaska: zákazka + OP + kedy (Bratislava) + kto + výzva „Odoslať ako dorobenie"', () => {
		const h = blokHlaska(blok, 'ZAK2026901', 'OP261380');
		expect(h).toContain('ZAK2026901');
		expect(h).toContain('OP261380');
		expect(h).toContain('už bola odpísaná');
		expect(h).toContain('8.10.2026 09:26'); // UTC 07:26 = 09:26 SELČ
		expect(h).toContain('patrik');
		expect(h).toContain('Odoslať ako dorobenie');
	});

	it('[RED] blokHlaska pri viacerých odpisoch prizná počet a ďalšie číslo dorobenia', () => {
		const h = blokHlaska({ ...blok, poradieMax: 2, pocetOdpisov: 2 }, 'ZAK1', 'OP1');
		expect(h).toContain('2×');
		expect(h).toContain('dorobenie č. 3');
	});

	it('[RED] overrideOpts: override=uz-odpisane + dorobenie_po → overrideDorobenie + token', () => {
		const f = new FormData();
		f.append('override', 'uz-odpisane');
		f.append('dorobenie_po', '2');
		const o = overrideOpts(f);
		expect(o.overrideDorobenie).toBe(true);
		expect(o.dorobeniePo).toBe(2);
		// bez override poľa žiadny bypass; nezmyselný token sa zahodí
		const g = new FormData();
		g.append('dorobenie_po', 'abc');
		expect(overrideOpts(g).overrideDorobenie).toBe(false);
		expect(overrideOpts(g).dorobeniePo).toBeUndefined();
		// token musí byť celé poradie ≥ 1 (0 / zlomok / záporné sa zahodia)
		for (const zly of ['0', '1.5', '-2']) {
			const h = new FormData();
			h.append('override', 'uz-odpisane');
			h.append('dorobenie_po', zly);
			expect(overrideOpts(h).dorobeniePo).toBeUndefined();
		}
		const jeden = new FormData();
		jeden.append('dorobenie_po', '1');
		expect(overrideOpts(jeden).dorobeniePo).toBe(1);
	});

	it('blokHlaska pri prvom existujúcom odpise: bez „×", bez zátvorky keď autor chýba', () => {
		const h = blokHlaska({ ...blok, duplicateCreatedBy: undefined }, 'ZAK1', 'OP1');
		expect(h).not.toContain('×');
		expect(h).not.toContain('(patrik)');
		expect(h).toContain('dorobenie č. 2');
		expect(h).toContain('už bola odpísaná 8.10.2026 09:26.');
	});

	it('[RED] rawFormEntries pridá AKTUÁLNY token z bloku a zastaraný nahradí', () => {
		const f = new FormData();
		f.append('zak', 'ZAK1');
		f.append('dorobenie_po', '1'); // zastaraný z predošlého potvrdenia
		f.append('override', 'uz-odpisane');
		const e = rawFormEntries(f, { ...blok, poradieMax: 2 });
		expect(e.filter(([k]) => k === 'dorobenie_po')).toEqual([['dorobenie_po', '2']]);
		expect(e).toContainEqual(['zak', 'ZAK1']);
		expect(e).toContainEqual(['override', 'uz-odpisane']);
		// iný blok (napr. ledger) token NEpridáva
		const g = new FormData();
		g.append('zak', 'ZAK1');
		expect(
			rawFormEntries(g, { ...blok, reason: 'ledger-duplicate', poradieMax: undefined }).some(
				([k]) => k === 'dorobenie_po'
			)
		).toBe(false);
	});
});
