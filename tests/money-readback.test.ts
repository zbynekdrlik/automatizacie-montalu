// #298 — POST-import readback z Money DB (verdikt §3 kontrola B). Appka po exporte overí, že Money
// REÁLNE naimportoval odpis: existuje DLV a jeho PocetPolozek == počet odoslaných riadkov. Nesúlad =
// viditeľný alarm, nie ticho. Test seeduje `odpis_log`/`odpis_polozky`/`money_dlv` PRIAMO (izoluje
// stavovú logiku) — Money reader boundary je externá služba, jej vstup (snapshot) mockujeme súborom;
// interná klasifikačná logika beží reálne. DLV_READBACK_PATH ide na neexistujúci súbor, nech lazy
// import nechá priamo naseedované `money_dlv` riadky na pokoji.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-readback-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.DLV_READBACK_PATH = path.join(tmpRoot, 'neexistuje.json'); // no-file → seed z DB ostane

const { db } = await import('../src/lib/server/db');
const { readbackStav } = await import('../src/lib/server/money-readback');
const { normZak, normOp } = await import('../src/lib/server/money');

let nextId = 1;

/** Vloží LIVE (default) odpis + jeho položky. `qtys` = množstvá riadkov (0 = nulový riadok, bazén).
 *  `createdMod` = SQLite datetime modifikátor pre `created_at` (napr. '-30 minutes', '-60 days'). */
function insOdpis(
	zak: string,
	op: string,
	qtys: number[],
	opts: { live?: number; createdMod?: string } = {}
): number {
	const id = nextId++;
	const live = opts.live ?? 1;
	const created = opts.createdMod ?? '-30 minutes';
	db.prepare(
		`INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
		 VALUES (?, 'zasklenia', ?, ?, 'Test', 0, ?, '/t/f.xlsx', 'f.xlsx', 'h', '{}', 'tester', datetime('now', ?), ?, ?)`
	).run(id, zak, op, live, created, normZak(zak), normOp(op));
	const insP = db.prepare(
		"INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (?, ?, ?, ?, 'm')"
	);
	qtys.forEach((q, i) => insP.run(id, `ZASP${1000 + i}`, `Profil ${i}`, q));
	return id;
}

/** Vloží DLV do readback snapshotu. `datumMod` = SQLite modifikátor pre `datum` (null = vynechať). */
function insDlv(
	dlv: string,
	zak: string,
	op: string,
	pocet: number,
	opts: { datumMod?: string | null } = {}
): void {
	const datum = opts.datumMod === undefined ? null : opts.datumMod;
	db.prepare(
		`INSERT INTO money_dlv (dlv, zak_norm, op_norm, datum, pocet_polozek)
		 VALUES (?, ?, ?, ${datum === null ? 'NULL' : "datetime('now', ?)"}, ?)`
	).run(...(datum === null ? [dlv, normZak(zak), op ? normOp(op) : '', pocet] : [dlv, normZak(zak), op ? normOp(op) : '', datum, pocet]));
}

/** Nastaví meta snapshotu (kedy bol generovaný). `genMod` = modifikátor, null = žiadny snapshot. */
function setMeta(genMod: string | null): void {
	db.prepare('DELETE FROM money_dlv_meta').run();
	if (genMod === null) return;
	db.prepare(
		"INSERT INTO money_dlv_meta (id, snapshot_generated_at, imported_at, row_count) VALUES (1, datetime('now', ?), datetime('now'), 1)"
	).run(genMod);
}

beforeEach(() => {
	db.prepare('DELETE FROM odpis_polozky').run();
	db.prepare('DELETE FROM odpis_log').run();
	db.prepare('DELETE FROM money_dlv').run();
	db.prepare('DELETE FROM money_dlv_meta').run();
	nextId = 1;
});

describe('#298 readback — chýbajúci Money doklad = ALARM (nie ticho)', () => {
	it('[RED] LIVE odpis bez zodpovedajúceho DLV a čerstvý snapshot ⇒ nesulad/chyba-doklad', () => {
		const id = insOdpis('ZAK2026273', 'OP260233', [3, 5]); // 2 riadky odoslané
		setMeta('-0 minutes'); // snapshot generovaný TERAZ (Money mal čas naimportovať)
		// žiadny DLV pre túto zákazku — Money doklad ticho zahodil (Dominikov prípad)
		const stav = readbackStav([id]).get(id)!;
		expect(stav.stav).toBe('nesulad');
		expect(stav.dovod).toBe('chyba-doklad');
	});
});

describe('#298 readback — sedí PocetPolozek', () => {
	it('DLV existuje a PocetPolozek == počet odoslaných ⇒ ok', () => {
		const id = insOdpis('ZAK1', 'OP111', [3, 5]);
		insDlv('DLV20251360', 'ZAK1', 'OP111', 2);
		setMeta('-0 minutes');
		const stav = readbackStav([id]).get(id)!;
		expect(stav.stav).toBe('ok');
		expect(stav.dlv).toBe('DLV20251360');
		expect(stav.moneyPocet).toBe(2);
		expect(stav.riadkov).toBe(2);
	});

	it('DLV existuje, ale PocetPolozek < počet reálnych riadkov ⇒ nesulad/pocet (riadok preskočený)', () => {
		const id = insOdpis('ZAK2', 'OP222', [3, 5]);
		insDlv('DLV20251400', 'ZAK2', 'OP222', 1); // Money odpísal len 1 z 2
		setMeta('-0 minutes');
		const stav = readbackStav([id]).get(id)!;
		expect(stav.stav).toBe('nesulad');
		expect(stav.dovod).toBe('pocet');
		expect(stav.moneyPocet).toBe(1);
	});

	it('OP v DLV prázdny (producer OP nevyplnil) ⇒ zak-only fallback stále napáruje', () => {
		const id = insOdpis('ZAK3', 'OP333', [7]);
		insDlv('DLV20251401', 'ZAK3', '', 1); // op prázdny
		setMeta('-0 minutes');
		expect(readbackStav([id]).get(id)!.stav).toBe('ok');
	});
});

describe('#298 readback — nulové riadky (bazén) v pásme tolerancie', () => {
	it('5 odoslaných (3 nenulové), Money odpísal 3 ⇒ ok (pásmo nenulové..všetky)', () => {
		const id = insOdpis('ZAK4', 'OP444', [1, 2, 3, 0, 0]);
		insDlv('DLV20251402', 'ZAK4', 'OP444', 3);
		setMeta('-0 minutes');
		expect(readbackStav([id]).get(id)!.stav).toBe('ok');
	});

	it('5 odoslaných (3 nenulové), Money odpísal len 2 ⇒ nesulad/pocet (reálny riadok chýba)', () => {
		const id = insOdpis('ZAK5', 'OP555', [1, 2, 3, 0, 0]);
		insDlv('DLV20251403', 'ZAK5', 'OP555', 2);
		setMeta('-0 minutes');
		const stav = readbackStav([id]).get(id)!;
		expect(stav.stav).toBe('nesulad');
		expect(stav.dovod).toBe('pocet');
	});
});

describe('#298 readback — neoverené (caka), NIKDY nefalošný alarm', () => {
	it('snapshot chýba (nikdy naimportovaný) ⇒ caka', () => {
		const id = insOdpis('ZAK6', 'OP666', [2]);
		setMeta(null);
		expect(readbackStav([id]).get(id)!.stav).toBe('caka');
	});

	it('snapshot je STARŠÍ než odpis (Money ešte nemal čas) ⇒ caka, nie alarm', () => {
		const id = insOdpis('ZAK7', 'OP777', [2], { createdMod: '-5 minutes' });
		setMeta('-30 minutes'); // snapshot generovaný PRED odpisom
		expect(readbackStav([id]).get(id)!.stav).toBe('caka');
	});

	it('odpis MIMO readback okna (>30 dní) bez DLV ⇒ caka (producer ho nečíta, nefalošuj alarm)', () => {
		const id = insOdpis('ZAK8', 'OP888', [2], { createdMod: '-60 days' });
		setMeta('-0 minutes');
		expect(readbackStav([id]).get(id)!.stav).toBe('caka');
	});

	it('odpis bez položiek (pred #154) ⇒ caka (nemáme čo overiť)', () => {
		const id = nextId++;
		db.prepare(
			`INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
			 VALUES (?, 'zasklenia', 'ZAK9', 'OP999', 'T', 0, 1, '/t/f', 'f', 'h', '{}', 't', datetime('now','-30 minutes'), 'ZAK9', 'OP999')`
		).run(id);
		setMeta('-0 minutes');
		expect(readbackStav([id]).get(id)!.stav).toBe('caka');
	});

	it('starý DLV (datum dávno pred odpisom) sa NEpočíta ⇒ chýbajúci aktuálny doklad = alarm', () => {
		const id = insOdpis('ZAK10', 'OP1010', [2]);
		insDlv('DLV_OLD', 'ZAK10', 'OP1010', 2, { datumMod: '-30 days' }); // starý duplicitný doklad
		setMeta('-0 minutes');
		const stav = readbackStav([id]).get(id)!;
		expect(stav.stav).toBe('nesulad');
		expect(stav.dovod).toBe('chyba-doklad');
	});
});

describe('#298 readback — TEST odpisy sa neoverujú (do Money nikdy nešli)', () => {
	it('live=0 odpis nemá readback záznam', () => {
		const id = insOdpis('ZAK11', 'OP1111', [2], { live: 0 });
		setMeta('-0 minutes');
		expect(readbackStav([id]).has(id)).toBe(false);
	});
});
