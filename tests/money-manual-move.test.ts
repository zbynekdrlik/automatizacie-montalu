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

	it('súbor STÁLE v staging ⇒ NEdetekuje (odpis je reálne parkovaný)', () => {
		const present = path.join(stagingDir, 'STILL-HERE.xlsx');
		fs.writeFileSync(present, 'x'); // súbor existuje = ešte nepresunutý
		const id = seedMovedParked('ZAKSTILL', 'OP9', [1], present);
		try {
			const det = detectManualStagingMoves();
			expect(det.find((d) => d.id === id)).toBeUndefined();
			expect(presunuteAt(id)).toBeNull();
		} finally {
			fs.rmSync(present, { force: true });
		}
	});

	it('staging dir NEDOSTUPNÝ (share odpojený) ⇒ NEdetekuje (fail-safe, žiadne falošné presuny)', () => {
		// target v NEEXISTUJÚCOM adresári — rodič nie je dostupný, takže nevieme rozhodnúť
		const orphan = path.join(tmpRoot, 'NEEXISTUJE-SHARE', 'X', 'gone.xlsx');
		const id = seedMovedParked('ZAKORPH', 'OP8', [1], orphan);
		expect(fs.existsSync(path.dirname(orphan))).toBe(false);
		const det = detectManualStagingMoves();
		expect(det.find((d) => d.id === id)).toBeUndefined();
		expect(presunuteAt(id)).toBeNull();
	});

	it('[review 🟡] ČERSTVO staged riadok (<10 min) so „zmiznutým" súborom ⇒ NEdetekuje (race guard)', () => {
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
		const det = detectManualStagingMoves();
		expect(det.find((d) => d.id === id)).toBeUndefined();
		expect(presunuteAt(id)).toBeNull();
	});

	it('caka=0 (neparkovaný) odpis so zmiznutým súborom ⇒ NEdetekuje (netýka sa staging modelu)', () => {
		const gone = path.join(stagingDir, 'ACTIVE-gone.xlsx');
		const id = db
			.prepare(
				`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, created_at, zak_norm, op_norm)
				 VALUES ('pergola', 'ZAKACT', 'OP7', 'T', 0, 1, ?, 'f', 'h', '{}', 't', datetime('now'), 'ZAKACT', 'OP7')`
			)
			.run(gone).lastInsertRowid as number;
		const det = detectManualStagingMoves();
		expect(det.find((d) => d.id === id)).toBeUndefined();
		expect(presunuteAt(id)).toBeNull();
	});

	it('idempotencia: druhý beh nič nezmení (presunute_at ostáva, ledger sa nezdvojuje)', () => {
		const gone = path.join(stagingDir, 'IDEMPO.xlsx');
		const id = seedMovedParked('ZAKIDEMPO', 'OP6', [2, 3], gone);
		const first = detectManualStagingMoves();
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
		const second = detectManualStagingMoves();
		expect(second.find((d) => d.id === id)).toBeUndefined(); // už NIE je NOVO detekovaný
		expect(presunuteAt(id)).toBe(stamp); // timestamp nezmenený
		expect(ledCount()).toBe(after1); // žiadny druhý ledger riadok
	});

	it('ledger sa NEDVOJPOČÍTA: keď už import riadok existuje (imports>overrides), detekcia ho NEPRIDÁ', () => {
		const gone = path.join(stagingDir, 'HASLEDGER.xlsx');
		const id = seedMovedParked('ZAKHASLED', 'OP5', [4], gone);
		// simuluj PROD stav: `writeOdpis` už nechal 'import' riadok pri pôvodnom zápise (imports=1)
		db.prepare(
			`INSERT INTO odpis_imported (modul, zak_norm, op_norm, live, content_hash, kind, filename, actor)
			 VALUES ('pergola', 'ZAKHASLED', 'OP5', 1, 'h-ZAKHASLED', 'import', 'HASLEDGER.xlsx', 'vyroba')`
		).run();
		detectManualStagingMoves();
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
