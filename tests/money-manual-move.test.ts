// #299 — evidencia RUČNÉHO presunu parkovaného (`caka=1`) odpisu zo staging „NA ODPIS" do ostrého
// Money import dir. `caka=1` súbor visí v `NA ODPIS/<subdir>`; Money ho neimportuje, kým ho ČLOVEK
// ručne nepresunie do rootu `dlv-import` — krok MIMO appky. `caka` je po inserte NEMENNÝ, takže
// presunutý odpis ostáva navždy „parkovaný": `#308` readback ho vylučuje (⏳ neoverené) a `#294`
// ledger nemá signál o presune (double-import cesta „D"). Fix: `/odpisy` load detekuje zmiznutý
// staged súbor → označí `presunute_at` → riadok VSTÚPI do readback matchingu + ledger zaznamená obsah.
//
// RED (tento súbor, behaviorálne cez /odpisy load): detekcia ešte neexistuje ⇒ riadok ostáva `caka`,
// bez `presunute_at`, ledger bez manual-move záznamu. GREEN pridá detekciu (viď design komentár #299).
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'am-manual-move-'));
process.env.DATABASE_PATH = path.join(tmpRoot, 'test.db');
process.env.DLV_READBACK_PATH = path.join(tmpRoot, 'neexistuje.json'); // no-file → priamy seed ostane
// staging priečinok EXISTUJE (rodič), ale seedovaný súbor v ňom NIKDY nevznikne = simulácia
// „človek presunul súbor do Money importu" (dir ostal, súbor zmizol).
const stagingDir = path.join(tmpRoot, 'NA ODPIS', 'Pergola');
fs.mkdirSync(stagingDir, { recursive: true });

const { db } = await import('../src/lib/server/db');
const { normZak, normOp } = await import('../src/lib/server/money');
const { detectManualStagingMoves } = await import('../src/lib/server/money-presun');
const { load } = await import('../src/routes/odpisy/+page.server');

type LoadRow = {
	id: number;
	zak: string;
	caka: number;
	presunute_at?: string | null;
	readback: { stav: string; dovod: string } | null;
};
const runLoad = async () =>
	((await load({} as Parameters<typeof load>[0])) as unknown as { odpisy: LoadRow[] }).odpisy;

/** parkovaný (`caka=1`) LIVE odpis, ktorého staged súbor je PREČ (presunutý do Money). */
function seedMovedParked(zak: string, op: string, qtys: number[], gonePath: string): number {
	const id = db
		.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
			 VALUES ('pergola', ?, ?, 'T', 1, 1, ?, ?, ?, '{}', 't', datetime('now','-30 minutes'), ?, ?)`
		)
		.run(zak, op, gonePath, path.basename(gonePath), 'h-' + zak, normZak(zak), normOp(op))
		.lastInsertRowid as number;
	const insP = db.prepare(
		"INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (?, ?, ?, ?, 'm')"
	);
	qtys.forEach((q, i) => insP.run(id, `ZASP${i}`, `P${i}`, q));
	return id;
}

beforeEach(() => {
	db.prepare('DELETE FROM odpis_polozky').run();
	db.prepare('DELETE FROM odpis_log').run();
	db.prepare('DELETE FROM odpis_imported').run();
	db.prepare('DELETE FROM money_dlv').run();
	db.prepare('DELETE FROM money_dlv_meta').run();
	// čerstvý snapshot (gen = teraz) — Money mal čas
	db.prepare(
		"INSERT INTO money_dlv_meta (id, snapshot_generated_at, imported_at, row_count) VALUES (1, datetime('now'), datetime('now'), 1)"
	).run();
});

describe('#299 /odpisy load — detekcia ručného presunu zo staging NA ODPIS', () => {
	it('[RED] caka=1 LIVE odpis so zmiznutým staged súborom ⇒ označí sa „presunuté ručne" (presunute_at)', async () => {
		const gone = path.join(stagingDir, 'ZAKMOVED - Zákazník [abc].xlsx');
		const id = seedMovedParked('ZAKMOVED', 'OP1', [3, 5], gone);
		expect(fs.existsSync(gone)).toBe(false); // súbor je preč = presunutý do Money

		const row = (await runLoad()).find((o) => o.id === id)!;
		expect(row.presunute_at).toBeTruthy(); // detekcia nastaví timestamp presunu
	});

	it('[RED] presunutý odpis VSTÚPI do readback matchingu ⇒ reálny Money verdikt (ok), nie ⏳ caka', async () => {
		const gone = path.join(stagingDir, 'ZAKMOVED2 - Zákazník [def].xlsx');
		const id = seedMovedParked('ZAKMOVED2', 'OP2', [3, 5], gone);
		// zhodný Money DLV (2 pol. v pásme [2..2]) — po presune sa MUSÍ napárovať
		db.prepare(
			"INSERT INTO money_dlv (dlv, zak_norm, op_norm, pocet_polozek) VALUES ('DLVM', 'ZAKMOVED2', 'OP2', 2)"
		).run();

		const row = (await runLoad()).find((o) => o.id === id)!;
		expect(row.readback).toMatchObject({ stav: 'ok' });
	});

	it('[RED] detekcia zaznamená obsah do #294 ledgeru (manuálny presun) ⇒ appka-side re-send bude blokovaný', async () => {
		const gone = path.join(stagingDir, 'ZAKMOVED3 - Zákazník [ghi].xlsx');
		seedMovedParked('ZAKMOVED3', 'OP3', [3, 5], gone);

		await runLoad();
		const led = db
			.prepare(
				"SELECT COUNT(*) c FROM odpis_imported WHERE kind = 'import' AND reason LIKE '%presun%'"
			)
			.get() as { c: number };
		expect(led.c).toBe(1);
	});

	it('[review 🔴] STARÝ parkovaný odpis presunutý DNES, snapshot ešte nemá jeho DLV ⇒ caka, NIE falošný ⛔', async () => {
		// Parkovaný odpis vytvorený pred 20 dňami; človek ho presunul do Money DNES. Denný snapshot bol
		// vygenerovaný PRED presunom, takže preň ešte NEEXISTUJE DLV. „Money mal čas" + „v okne" sa MUSIA
		// merať od PRESUNU (nie od vytvorenia) — inak by KAŽDÝ korektný presun privítal operátora falošným
		// ⛔ „Money doklad chýba" (presne trieda #308, ktorú sme odstránili). Detekcia (v load) nastaví
		// presunute_at=teraz → refEpoch=teraz → moneyMalCas=false → caka.
		const gone = path.join(stagingDir, 'ZAKOLD - Zákazník [old].xlsx');
		db.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
			 VALUES ('pergola', 'ZAKOLD', 'OP20', 'T', 1, 1, ?, ?, 'h-ZAKOLD', '{}', 't', datetime('now','-20 days'), 'ZAKOLD', 'OP20')`
		).run(gone, path.basename(gone));
		const insP = db.prepare(
			"INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (?, ?, ?, ?, 'm')"
		);
		const id = (db.prepare("SELECT id FROM odpis_log WHERE zak = 'ZAKOLD'").get() as { id: number })
			.id;
		insP.run(id, 'ZASP0', 'P0', 3);
		insP.run(id, 'ZASP1', 'P1', 5);
		// žiadny money_dlv pre ZAKOLD — snapshot presun ešte „nevidel"

		const row = (await runLoad()).find((o) => o.id === id)!;
		expect(row.presunute_at).toBeTruthy(); // presun sa detekoval (vstúpil do matchingu)
		expect(row.readback!.stav).toBe('caka'); // ale je „neoverené", NIE falošný ⛔ chyba-doklad
	});
});

// unit testy `detectManualStagingMoves` — READ-ONLY na staging, idempotencia, fail-safe
describe('#299 detectManualStagingMoves — hranice a bezpečnosť', () => {
	const presunuteAt = (id: number) =>
		(
			db.prepare('SELECT presunute_at FROM odpis_log WHERE id = ?').get(id) as {
				presunute_at: string | null;
			}
		).presunute_at;

	it('súbor STÁLE v staging ⇒ NEdetekuje (odpis je reálne parkovaný)', async () => {
		const present = path.join(stagingDir, 'STILL-HERE.xlsx');
		fs.writeFileSync(present, 'x'); // súbor existuje = ešte nepresunutý
		const id = seedMovedParked('ZAKSTILL', 'OP9', [1], present);
		try {
			const det = await detectManualStagingMoves();
			expect(det.find((d) => d.id === id)).toBeUndefined();
			expect(presunuteAt(id)).toBeNull();
		} finally {
			fs.rmSync(present, { force: true });
		}
	});

	it('staging dir NEDOSTUPNÝ (share odpojený) ⇒ NEdetekuje (fail-safe, žiadne falošné presuny)', async () => {
		// target v NEEXISTUJÚCOM adresári — rodič nie je dostupný, takže nevieme rozhodnúť
		const orphan = path.join(tmpRoot, 'NEEXISTUJE-SHARE', 'X', 'gone.xlsx');
		const id = seedMovedParked('ZAKORPH', 'OP8', [1], orphan);
		expect(fs.existsSync(path.dirname(orphan))).toBe(false);
		const det = await detectManualStagingMoves();
		expect(det.find((d) => d.id === id)).toBeUndefined();
		expect(presunuteAt(id)).toBeNull();
	});

	it('[review 🟡] ČERSTVO staged riadok (<10 min) so „zmiznutým" súborom ⇒ NEdetekuje (race guard)', async () => {
		// writeOdpis zaberie DB riadok ATOMICKY, ale súbor zapíše až po `await buildXlsx` — v tom okne by
		// súbežný load videl target-chýba a označil čerstvý riadok ako presunutý (trvalý false-positive).
		// Vekový prah (created_at <= now-10min) to okno zatvára: riadok mladší než 10 min sa nedetekuje.
		const gone = path.join(stagingDir, 'FRESH.xlsx');
		db.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
			 VALUES ('pergola', 'ZAKFRESH', 'OP4', 'T', 1, 1, ?, 'f', 'h', '{}', 't', datetime('now'), 'ZAKFRESH', 'OP4')`
		).run(gone);
		const id = (
			db.prepare("SELECT id FROM odpis_log WHERE zak = 'ZAKFRESH'").get() as { id: number }
		).id;
		expect(fs.existsSync(gone)).toBe(false);
		const det = await detectManualStagingMoves();
		expect(det.find((d) => d.id === id)).toBeUndefined();
		expect(presunuteAt(id)).toBeNull();
	});

	it('caka=0 (neparkovaný) odpis so zmiznutým súborom ⇒ NEdetekuje (netýka sa staging modelu)', async () => {
		const gone = path.join(stagingDir, 'ACTIVE-gone.xlsx');
		const id = db
			.prepare(
				`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
				 VALUES ('pergola', 'ZAKACT', 'OP7', 'T', 0, 1, ?, 'f', 'h', '{}', 't', datetime('now'), 'ZAKACT', 'OP7')`
			)
			.run(gone).lastInsertRowid as number;
		const det = await detectManualStagingMoves();
		expect(det.find((d) => d.id === id)).toBeUndefined();
		expect(presunuteAt(id)).toBeNull();
	});

	it('idempotencia: druhý beh nič nezmení (presunute_at ostáva, ledger sa nezdvojuje)', async () => {
		const gone = path.join(stagingDir, 'IDEMPO.xlsx');
		const id = seedMovedParked('ZAKIDEMPO', 'OP6', [2, 3], gone);
		const first = await detectManualStagingMoves();
		expect(first.find((d) => d.id === id)).toBeTruthy();
		const stamp = presunuteAt(id);
		expect(stamp).toBeTruthy();
		const ledCount = () =>
			(
				db.prepare("SELECT COUNT(*) c FROM odpis_imported WHERE zak_norm = 'ZAKIDEMPO'").get() as {
					c: number;
				}
			).c;
		const after1 = ledCount();
		const second = await detectManualStagingMoves();
		expect(second.find((d) => d.id === id)).toBeUndefined(); // už NIE je NOVO detekovaný
		expect(presunuteAt(id)).toBe(stamp); // timestamp nezmenený
		expect(ledCount()).toBe(after1); // žiadny druhý ledger riadok
	});

	it('ledger sa NEDVOJPOČÍTA: keď už import riadok existuje (imports>overrides), detekcia ho NEPRIDÁ', async () => {
		const gone = path.join(stagingDir, 'HASLEDGER.xlsx');
		const id = seedMovedParked('ZAKHASLED', 'OP5', [4], gone);
		// simuluj PROD stav: `writeOdpis` už nechal 'import' riadok pri pôvodnom zápise (imports=1)
		db.prepare(
			`INSERT INTO odpis_imported (modul, zak_norm, op_norm, live, content_hash, kind, filename, actor)
			 VALUES ('pergola', 'ZAKHASLED', 'OP5', 1, 'h-ZAKHASLED', 'import', 'HASLEDGER.xlsx', 'vyroba')`
		).run();
		await detectManualStagingMoves();
		expect(presunuteAt(id)).toBeTruthy(); // presun je označený
		const imports = (
			db
				.prepare(
					"SELECT COUNT(*) c FROM odpis_imported WHERE zak_norm = 'ZAKHASLED' AND kind = 'import'"
				)
				.get() as { c: number }
		).c;
		// stále LEN 1 import (pôvodný) — detekcia NEpridala druhý (inak by rozbila „1 override = 1 re-import")
		expect(imports).toBe(1);
	});
});

// #315 — detekcia MUSÍ byť async s tvrdým wall-clock rozpočtom. Na PRODE `target` cesty ležia na
// CIFS/SMB share cez WireGuard (`fs.statSync` namerané 0,7–8,8 s/súbor) — SYNCHRÓNNE volanie
// blokovalo event loop na desiatky sekúnd (aj /health zamrzol). Fix: async `readdir`+stat, pri
// prekročení rozpočtu sa detekcia ČESTNE preskočí (riadok ostáva parkovaný), NIKDY nefalošuje presun.
describe('#315 detekcia async s rozpočtom — pomalý/visiaci mount NEblokuje ani nefalošuje', () => {
	const presunuteAt = (id: number) =>
		(
			db.prepare('SELECT presunute_at FROM odpis_log WHERE id = ?').get(id) as {
				presunute_at: string | null;
			}
		).presunute_at;

	// po teste, ktorý nechal orphan fs op (race ho opustil na timeoute / držal in-flight), počkaj, kým
	// `Promise.allSettled(bgOps)` znova otvorí `detectBusy` gate — inak by ďalší test videl „už beží".
	const settleGate = () => new Promise((r) => setTimeout(r, 20));

	it('jedna in-flight detekcia: súbežné volanie sa preskočí, nič sa nezdvojí (#315)', async () => {
		const gone = path.join(stagingDir, 'ZAKINFLIGHT - Z [if].xlsx');
		const id = seedMovedParked('ZAKINFLIGHT', 'OPIF', [1], gone);
		let release: (v: string[]) => void = () => {};
		const gated = () => new Promise<string[]>((res) => (release = res)); // drží detekciu in-flight
		const p1 = detectManualStagingMoves({ readdir: gated, budgetMs: 5000 });
		const p2 = await detectManualStagingMoves({ readdir: gated, budgetMs: 5000 }); // busy → []
		expect(p2).toHaveLength(0);
		release([]); // readdir vráti prázdno → súbor „preč" → potvrdí exact-path stat (reálny ENOENT) → mark
		const d1 = await p1;
		expect(d1.map((x) => x.id)).toContain(id);
		expect(presunuteAt(id)).toBeTruthy();
		await settleGate();
	});

	it('normalizačný rozdiel (readdir NFD vs uložené NFC) ⇒ berie sa ako prítomný, NEoznačí (#315)', async () => {
		const base = 'ZAKNORM - Rožnáková [n].xlsx'.normalize('NFC');
		const target = path.join(stagingDir, base);
		const id = seedMovedParked('ZAKNORM', 'OPN', [1], target);
		const readdir = async () => [base.normalize('NFD')]; // fs vráti NFD tvar toho istého názvu
		const det = await detectManualStagingMoves({ readdir, budgetMs: 5000 });
		expect(det.find((x) => x.id === id)).toBeUndefined();
		expect(presunuteAt(id)).toBeNull();
	});

	it('readdir názov nenašiel, ale exact-path stat prejde ⇒ NEoznačí (potvrdenie chráni pred falošným markom) (#315)', async () => {
		const target = path.join(stagingDir, 'ZAKCONF - Z [c].xlsx');
		fs.writeFileSync(target, 'x'); // súbor REÁLNE existuje
		const id = seedMovedParked('ZAKCONF', 'OPC', [1], target);
		try {
			const det = await detectManualStagingMoves({ readdir: async () => [], budgetMs: 5000 });
			expect(det.find((x) => x.id === id)).toBeUndefined();
			expect(presunuteAt(id)).toBeNull();
		} finally {
			fs.rmSync(target, { force: true });
		}
	});

	it('potvrdzujúci stat zlyhá inak než ENOENT (EACCES) ⇒ NEoznačí (nie dôkaz presunu) (#315)', async () => {
		const target = path.join(stagingDir, 'ZAKEACC - Z [e].xlsx');
		const id = seedMovedParked('ZAKEACC', 'OPE', [1], target);
		const eacces = async () => {
			const err = new Error('EACCES') as NodeJS.ErrnoException;
			err.code = 'EACCES';
			throw err;
		};
		const det = await detectManualStagingMoves({
			readdir: async () => [],
			stat: eacces,
			budgetMs: 5000
		});
		expect(det.find((x) => x.id === id)).toBeUndefined();
		expect(presunuteAt(id)).toBeNull();
	});

	it('potvrdzujúci stat prekročí rozpočet ⇒ NEoznačí (timeout nie je dôkaz presunu) (#315)', async () => {
		const target = path.join(stagingDir, 'ZAKSTMO - Z [s].xlsx');
		const id = seedMovedParked('ZAKSTMO', 'OPSM', [1], target);
		let release: () => void = () => {};
		const hangStat = () => new Promise((res) => (release = () => res({})));
		const started = Date.now();
		const det = await detectManualStagingMoves({
			readdir: async () => [],
			stat: hangStat,
			budgetMs: 200
		});
		expect(Date.now() - started).toBeLessThan(3000);
		expect(det).toHaveLength(0);
		expect(presunuteAt(id)).toBeNull();
		release();
		await settleGate();
	});

	it('rozpočet už vyčerpaný pred prvým readdir ⇒ nič sa nedetekuje (#315)', async () => {
		const gone = path.join(stagingDir, 'ZAKBUDG - Z [b].xlsx');
		const id = seedMovedParked('ZAKBUDG', 'OPB', [1], gone);
		let t = 0;
		const now = () => (t += 10_000); // každé now() posunie o 10 s → hneď za deadline
		const det = await detectManualStagingMoves({ now, budgetMs: 1000 });
		expect(det).toHaveLength(0);
		expect(presunuteAt(id)).toBeNull();
	});

	it('rozpočet vyčerpaný PO readdir, pred potvrdzujúcim statom ⇒ NEoznačí (rozpočet stráži aj 2. fázu) (#315)', async () => {
		const gone = path.join(stagingDir, 'ZAKP2 - Z [p2].xlsx');
		const id = seedMovedParked('ZAKP2', 'OPP2', [1], gone);
		let calls = 0;
		// #1 deadline base, #2/#3 fáza-1 (v rozpočte), #4 fáza-2 kontrola skočí za deadline
		const now = () => (++calls <= 3 ? 0 : 10_000);
		const det = await detectManualStagingMoves({
			readdir: async () => [], // dir dostupný, súbor „preč" → kandidát na potvrdenie
			budgetMs: 1000,
			now
		});
		expect(det).toHaveLength(0);
		expect(presunuteAt(id)).toBeNull();
	});

	it('strom zmizol PO readdir (target aj dir ENOENT pri potvrdení) ⇒ NEoznačí (per-riadková re-kontrola dir) (#315)', async () => {
		const target = path.join(stagingDir, 'ZAKVANISH - Z [v].xlsx');
		const id = seedMovedParked('ZAKVANISH', 'OPV', [1], target);
		const enoent = async () => {
			const err = new Error('ENOENT') as NodeJS.ErrnoException;
			err.code = 'ENOENT';
			throw err;
		};
		// readdir videl dir dostupný (prázdny), ale strom medzitým zmizol → target AJ dir stat ENOENT
		const det = await detectManualStagingMoves({
			readdir: async () => [],
			stat: enoent,
			budgetMs: 5000
		});
		expect(det.find((x) => x.id === id)).toBeUndefined(); // dir-revalidácia zabráni falošnému marku svepu
		expect(presunuteAt(id)).toBeNull();
	});

	it('orphan readdir REJECTNE až po rozpočte ⇒ žiadny unhandled rejection, NEoznačí (#315)', async () => {
		const gone = path.join(stagingDir, 'ZAKREJ - Z [r].xlsx');
		const id = seedMovedParked('ZAKREJ', 'OPR', [1], gone);
		let rej: (e: unknown) => void = () => {};
		const lateReject = () => new Promise<string[]>((_, r) => (rej = r));
		const started = Date.now();
		const det = await detectManualStagingMoves({ readdir: lateReject, budgetMs: 200 });
		expect(Date.now() - started).toBeLessThan(3000);
		expect(det).toHaveLength(0);
		expect(presunuteAt(id)).toBeNull();
		rej(Object.assign(new Error('EIO'), { code: 'EIO' })); // orphan dozneje rejectom — musí byť handled
		await settleGate();
	});

	it('gate zaseknutý nad max-hold (visiaci mount) ⇒ force-reopen + ďalšia detekcia REÁLNE beží (#315)', async () => {
		const gone = path.join(stagingDir, 'ZAKWEDGE - Z [w].xlsx');
		const id = seedMovedParked('ZAKWEDGE', 'OPW', [1], gone);
		let release: (v: string[]) => void = () => {};
		const gated = () => new Promise<string[]>((res) => (release = res));
		// 1. detekcia drží gate visiacim readdir (drzana od now=1000)
		const p1 = detectManualStagingMoves({ readdir: gated, budgetMs: 60_000, now: () => 1000 });
		// 2. ďalšia detekcia s now ĎALEKO za max-hold → gate sa force-reopne a detekcia beží (nie skip)
		const det = await detectManualStagingMoves({
			readdir: async () => [],
			budgetMs: 5000,
			maxHoldMs: 100,
			now: () => 999_999
		});
		expect(det.map((x) => x.id)).toContain(id); // force-reopnutá detekcia bežala a označila
		expect(presunuteAt(id)).toBeTruthy();
		release([]); // uvoľni orphan p1; jeho neskoro doznený settle nezhodí novšiu gate (gen guard)
		await p1;
		await settleGate();
	});

	it('potvrdzujúci DIR-stat prekročí rozpočet (target ENOENT, dir visí) ⇒ NEoznačí (timeout dir nie je dôkaz) (#315)', async () => {
		const target = path.join(stagingDir, 'ZAKDIRTO - Z [dt].xlsx');
		const id = seedMovedParked('ZAKDIRTO', 'OPDT', [1], target);
		let releaseDir: () => void = () => {};
		const stat = (p: string) => {
			if (p === target) {
				const err = new Error('ENOENT') as NodeJS.ErrnoException;
				err.code = 'ENOENT';
				return Promise.reject(err); // target je preč (ENOENT)
			}
			return new Promise((res) => (releaseDir = () => res({}))); // ale dir-stat VISÍ
		};
		const started = Date.now();
		const det = await detectManualStagingMoves({ readdir: async () => [], stat, budgetMs: 200 });
		expect(Date.now() - started).toBeLessThan(3000);
		expect(det).toHaveLength(0); // dir sa nestihol overiť → NEoznačí (timeout nie je dôkaz presunu)
		expect(presunuteAt(id)).toBeNull();
		releaseDir();
		await settleGate();
	});

	// POSLEDNÝ test: readdir sa vyrieši až PO rozpočte (releasable), gate sa potom čisto otvorí. Dokazuje
	// ROOT: visiaci mount dobehne v rozpočte a NIKDY nefalošuje presun.
	it('[RED] visiaci mount (readdir sa vyrieši až po rozpočte) ⇒ dobehne v rozpočte a NEoznačí presun (#315)', async () => {
		const gone = path.join(stagingDir, 'ZAKSLOW - Zákazník [slow].xlsx');
		const id = seedMovedParked('ZAKSLOW', 'OPSLOW', [1], gone);
		expect(fs.existsSync(gone)).toBe(false); // na rýchlom fs by sa OZNAČIL — tu má rozpočet vyhrať
		let release: (v: string[]) => void = () => {};
		const hanging = () => new Promise<string[]>((res) => (release = res)); // visiaci CIFS mount
		const started = Date.now();
		const det = await detectManualStagingMoves({ readdir: hanging, budgetMs: 300 });
		expect(Date.now() - started).toBeLessThan(3000); // dobehla v rozpočte (event loop neblokovaný)
		expect(det).toHaveLength(0); // nič sa neoznačilo
		expect(presunuteAt(id)).toBeNull(); // visiaci/timeoutnutý stat NIKDY nefalošuje presun
		release([]);
		await settleGate();
	});
});
