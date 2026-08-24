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
			// `created_at <= now-10min`: RACE-guard. `writeOdpis` zaberie DB riadok (caka=1, target,
			// presunute_at NULL) ATOMICKY, ale súbor zapíše až PO `await buildXlsx` — v tom okne by
			// súbežný /odpisy load videl dir-existuje (subdir sa recykluje) + target-chýba a označil
			// čerstvo staged riadok ako „presunutý" (trvalý false-positive, presun sa neruší). Človek
			// nikdy nepresunie súbor do minút od staging → 10-min prah okno zatvára. (Crash-residue:
			// claim commitnutý, súbor nikdy nezapísaný, proces padol pred kompenzáciou → zostáva známy
			// okrajový limit, nižšie riešený ENOENT-only kontrolou, nie týmto prahom.)
			`SELECT id, modul, zak, op, live, target, filename, content_hash, zak_norm, op_norm
			 FROM odpis_log
			 WHERE live = 1 AND caka = 1 AND presunute_at IS NULL
			   AND created_at <= datetime('now', '-10 minutes')`
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
		// fail-safe: `existsSync` vráti false na AKEJKOĽVEK stat chybe (EACCES/EIO/stale CIFS handle), nie
		// len na ENOENT — degradovaný (nie odpojený) share, kde dir-stat prejde z cache ale per-file stat
		// zlyhá, by inak označil CELÝ subdir ako presunutý (trvalo). Preto `statSync` + rozlišuj kód:
		// dir musí byť DOSTUPNÝ; „presunutý" = LEN čistý ENOENT na TARGETE. Iná chyba → preskoč.
		const dir = path.dirname(r.target);
		try {
			fs.statSync(dir); // dir nedostupný (odpojený mount / iná chyba) → catch → skip
		} catch {
			continue;
		}
		let gone = false;
		try {
			fs.statSync(r.target); // súbor STÁLE v staging → odpis je reálne parkovaný, nepresunutý
		} catch (e) {
			// LEN ENOENT (súbor naozaj nie je, dir je dostupný) = ručne presunutý. Iná chyba (EACCES/EIO/
			// stale handle) NIE JE dôkaz presunu → preskoč, nikdy nefalošuj presun ani nezhoď /odpisy.
			if ((e as NodeJS.ErrnoException).code === 'ENOENT') gone = true;
			else continue;
		}
		if (!gone) continue;
		// súbor je preč, ale adresár existuje → ručne presunutý do Money importu.
		db.transaction(() => {
			setPresunute.run(r.id);
			// idempotentný ledger: len keď tuple+content EŠTE neblokuje appka-side re-send. POZN.: v stave
			// imports==overrides (operátor spravil `povolitReimport`, ešte neposlal) presun sem doplní
			// `import` → čakajúca autorizácia sa „minie" a re-send zablokuje. Je to SPRÁVNE + fail-safe:
			// presun JE reálny import, takže následný appka-side re-send by bol genuine dvojitý import.
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
