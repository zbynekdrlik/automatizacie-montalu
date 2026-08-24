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
});
