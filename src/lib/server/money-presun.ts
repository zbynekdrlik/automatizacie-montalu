// (#299) Detekcia RUČNÉHO presunu parkovaného (`caka=1`) LIVE odpisu zo staging „NA ODPIS" do
// ostrého Money import dir. Extrahované z `money.ts` (large-file-split, aby `money.ts` zostal pod
// 1000-riadkovým stropom). Importuje `ledgerCounts` z `money.ts` — JEDNOSMERNE (money.ts sem
// NEimportuje), takže žiadny cyklický import (vzor `compute-*` vrstvenia, large-file-split rule).
//
// `caka=1` súbor appka zapísala do `NA ODPIS/<subdir>`; Money ho NEIMPORTUJE, kým ho ČLOVEK ručne
// nepresunie do rootu `dlv-import` — krok ÚPLNE MIMO appky. `caka` je po inserte NEMENNÉ, takže bez
// tejto detekcie by presunutý odpis ostal navždy „parkovaný" (#308 readback ho vylučuje, #294 ledger
// nemá signál o presune → double-import cesta „D" verdiktu #294).
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db';
import { logger } from './log';
import { ledgerCounts } from './money';

// forenzný sub-modul `money:presun` → #297 money-audit sink (prežije redeploy), distinktne grepnuteľné.
const log = logger('money').child('presun');

export interface ManualMoveDetected {
	id: number;
	modul: string;
	zak: string;
	op: string;
	filename: string;
}

/**
 * Diff staging dir ↔ `caka=1` riadky: riadok, ktorého uložený `target` súbor je PREČ (ale jeho
 * rodičovský dir STÁLE existuje — fail-safe proti dočasne odpojenému Samba share, inak by výpadok
 * mountu falošne označil VŠETKY parkované ako presunuté), sa považuje za ručne presunutý do Money.
 * Na detekcii (idempotentne, `presunute_at IS NULL` filter):
 *   1. `presunute_at = datetime('now')` → riadok VSTÚPI do #308 readback matchingu (reálny verdikt).
 *   2. Ledger (IDEMPOTENTNE): keď tuple+content EŠTE neblokuje (`imports <= overrides`), pridá
 *      `kind='import', reason=manuálny presun` riadok do `odpis_imported`, aby neskorší appka-side
 *      re-send identického obsahu narazil na štandardný #294 blok. V PRODE už `writeOdpis`/v27
 *      backfill nechal `import` riadok (`imports=1`), takže je to tam no-op — NEdvojpočíta (to by
 *      rozbilo „jeden override = jeden re-import" invariant); zatvára len medzeru pre riadok bez
 *      ledger záznamu.
 *   3. Forenzný money-audit log (#297, prežije redeploy).
 *
 * READ-ONLY na staging dir (LEN `fs.existsSync`) — nič tam nemaže/nepíše/nepresúva. `writeOdpis`
 * (Money write cesta) sa NEDOTÝKA. Vracia zoznam NOVO detekovaných presunov (telemetry pre volajúci
 * load). Chyba pri čítaní staging (práva) sa PREHLTNE pre daný riadok — detekcia nesmie zhodiť
 * /odpisy (hostí „Uvoľniť", jedinú cestu k oprave duplikátov).
 */
export function detectManualStagingMoves(): ManualMoveDetected[] {
	const rows = db
		.prepare(
			`SELECT id, modul, zak, op, live, target, filename, content_hash, zak_norm, op_norm
			 FROM odpis_log WHERE live = 1 AND caka = 1 AND presunute_at IS NULL`
		)
		.all() as {
		id: number;
		modul: string;
		zak: string;
		op: string;
		live: number;
		target: string;
		filename: string;
		content_hash: string;
		zak_norm: string;
		op_norm: string;
	}[];
	const detected: ManualMoveDetected[] = [];
	const setPresunute = db.prepare(
		"UPDATE odpis_log SET presunute_at = datetime('now') WHERE id = ? AND presunute_at IS NULL"
	);
	const insManualMove = db.prepare(
		`INSERT INTO odpis_imported (modul, zak_norm, op_norm, live, content_hash, kind, filename, actor, reason)
		 VALUES (?, ?, ?, ?, ?, 'import', ?, ?, ?)`
	);
	for (const r of rows) {
		let gone: boolean;
		try {
			const dir = path.dirname(r.target);
			// fail-safe: staging dir NEDOSTUPNÝ (share odpojený / cesta neexistuje) → nevieme rozhodnúť,
			// preskoč (inak by výpadok mountu falošne označil všetky parkované ako presunuté).
			if (!fs.existsSync(dir)) continue;
			// súbor STÁLE v staging → odpis je reálne parkovaný, nepresunutý.
			if (fs.existsSync(r.target)) continue;
			gone = true;
		} catch {
			continue; // chyba čítania staging — nikdy nefalošuj presun ani nezhoď /odpisy
		}
		if (!gone) continue;
		// súbor je preč, ale adresár existuje → ručne presunutý do Money importu.
		db.transaction(() => {
			setPresunute.run(r.id);
			// idempotentný ledger: len keď tuple+content EŠTE neblokuje appka-side re-send.
			const led = ledgerCounts(r.modul, r.zak_norm, r.op_norm, r.live, r.content_hash);
			if (led.imports <= led.overrides) {
				insManualMove.run(
					r.modul,
					r.zak_norm,
					r.op_norm,
					r.live,
					r.content_hash,
					r.filename,
					'system:presun-detekcia',
					'manuálny presun zo staging NA ODPIS do Money importu (detekcia #299)'
				);
			}
		})();
		log.warn('odpis: detekovaný ručný presun zo staging do Money importu (#299)', {
			id: r.id,
			modul: r.modul,
			zak: r.zak,
			op: r.op,
			filename: r.filename,
			target: r.target
		});
		detected.push({ id: r.id, modul: r.modul, zak: r.zak, op: r.op, filename: r.filename });
	}
	return detected;
}
