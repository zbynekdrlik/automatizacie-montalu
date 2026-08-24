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
	opts: { live?: number; createdMod?: string; caka?: number; modul?: string } = {}
): number {
	const id = nextId++;
	const live = opts.live ?? 1;
	const created = opts.createdMod ?? '-30 minutes';
	const caka = opts.caka ?? 0;
	const modul = opts.modul ?? 'zasklenia';
	db.prepare(
		`INSERT INTO odpis_log (id, modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
		 VALUES (?, ?, ?, ?, 'Test', ?, ?, '/t/f.xlsx', 'f.xlsx', 'h', '{}', 'tester', datetime('now', ?), ?, ?)`
	).run(id, modul, zak, op, caka, live, created, normZak(zak), normOp(op));
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
	).run(
		...(datum === null
			? [dlv, normZak(zak), op ? normOp(op) : '', pocet]
			: [dlv, normZak(zak), op ? normOp(op) : '', datum, pocet])
	);
}

/** Nastaví meta snapshotu (kedy bol generovaný). `genMod` = modifikátor, null = žiadny snapshot.
 *  `windowDays` = producerovo DLV okno (0 = neznáme → app použije svoje 30 dní). */
function setMeta(genMod: string | null, windowDays = 0): void {
	db.prepare('DELETE FROM money_dlv_meta').run();
	if (genMod === null) return;
	db.prepare(
		"INSERT INTO money_dlv_meta (id, snapshot_generated_at, imported_at, row_count, window_days) VALUES (1, datetime('now', ?), datetime('now'), 1, ?)"
	).run(genMod, windowDays);
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

	it('[review 🔵] odpis mimo PRODUCEROVHO okna (kratšie než app) ⇒ caka, nie alarm', () => {
		// producer číta len 1 deň DLV; odpis spred 5 dní je mimo jeho okna → žiadny DLV NIE je dôkaz
		// skipu (producer ho nečíta). App si okno zaklampuje na producerovo.
		const id = insOdpis('ZAKW', 'OPW', [2], { createdMod: '-5 days' });
		setMeta('-0 minutes', 1); // producer window = 1 deň
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

describe('#298 readback — PARKOVANÝ caka=1 odpis NEALARMUJE (Money ho ešte neimportoval)', () => {
	it('[review 🔴] LIVE caka=1 bez DLV + čerstvý snapshot ⇒ caka, NIE chyba-doklad', () => {
		// caka=1 = súbor visí v „NA ODPIS", Money ho neimportuje kým ho človek nepresunie → žiadny
		// DLV NEznamená skip. Bez tejto poistky by KAŽDÝ parkovaný odpis falošne alarmoval.
		const id = insOdpis('ZAKP', 'OPP1', [3, 5], { caka: 1 });
		setMeta('-0 minutes');
		expect(readbackStav([id]).get(id)!.stav).toBe('caka');
	});

	it('caka=1 odpis PO presune (DLV už existuje) ⇒ ok (readback funguje po importe)', () => {
		const id = insOdpis('ZAKP2', 'OPP2', [3, 5], { caka: 1 });
		insDlv('DLVP2', 'ZAKP2', 'OPP2', 2);
		setMeta('-0 minutes');
		expect(readbackStav([id]).get(id)!.stav).toBe('ok');
	});
});

describe('#298 readback — EXKLUZÍVNE priradenie (jeden DLV neoverí dva odpisy)', () => {
	it('[review 🟡] 2 moduly rovnaká zak+op, Money zahodil jeden ⇒ druhý ostane bez dokladu = alarm', () => {
		// zasklenia + pergola tej istej zákazky (UNIQUE je (modul,zak,op,live), takže zdieľajú zak+op).
		// Money naimportoval len JEDEN doklad (2 pol.). Bez exkluzivity by ten jeden overil OBA.
		const a = insOdpis('ZAKX', 'OPX', [3, 5], { modul: 'zasklenia' });
		const b = insOdpis('ZAKX', 'OPX', [1, 2], { modul: 'pergola' });
		insDlv('DLVONE', 'ZAKX', 'OPX', 2); // sedí do pásma OBOCH (2 riadky každý)
		setMeta('-0 minutes');
		const m = readbackStav([a, b]);
		// jeden ok (napárovaný na jediný DLV), druhý bez dokladu ⇒ alarm — NIE oba ok
		const stavy = [m.get(a)!.stav, m.get(b)!.stav].sort();
		expect(stavy).toEqual(['nesulad', 'ok']);
		const alarm = m.get(a)!.stav === 'nesulad' ? m.get(a)! : m.get(b)!;
		expect(alarm.dovod).toBe('chyba-doklad');
	});

	it('2 odpisy rovnakej zak, 2 zodpovedajúce DLV ⇒ OBA ok (každý svoj doklad)', () => {
		const a = insOdpis('ZAKY', 'OPY', [3, 5], { modul: 'zasklenia' });
		const b = insOdpis('ZAKY', 'OPY', [1, 2, 4], { modul: 'pergola' });
		insDlv('DLVA', 'ZAKY', 'OPY', 2);
		insDlv('DLVB', 'ZAKY', 'OPY', 3);
		setMeta('-0 minutes');
		const m = readbackStav([a, b]);
		expect(m.get(a)!.stav).toBe('ok');
		expect(m.get(b)!.stav).toBe('ok');
		// rôzne DLV napárované (exkluzívne)
		expect(m.get(a)!.dlv).not.toBe(m.get(b)!.dlv);
	});
});
