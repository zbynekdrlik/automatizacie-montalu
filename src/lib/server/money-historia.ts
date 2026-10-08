// História odpisov (`odpis_log`) — čítanie + uvoľnenie / povolenie re-importu existujúceho záznamu.
// Vytiahnuté z `money.ts` (#608, large-file-split — money.ts bol pri 1000-r. strope; presun byte-
// identický v samostatnom commite), potom #608 doplnil `poradie` (SELECT-y, „(dorobenie N)" v audite
// Uvoľniť / Povoliť rovnaký). Logger `money` rovnaký. Zápisová cesta do Money (`writeOdpis`) ostáva
// v `money.ts`, ktorý tieto funkcie re-exportuje — verejná plocha `$lib/server/money` je nezmenená.
// Importuje LEN `db` + `log` (+ typ z money.ts — typový import sa pri behu zmaže, žiadny cyklus).
import { db } from './db';
import { logger } from './log';
import type { Polozka } from './money';

const log = logger('money');

export interface OdpisLogRow {
	id: number;
	modul: string;
	zak: string;
	op: string;
	zakaznik: string;
	caka: number;
	live: number;
	filename: string;
	detail: string;
	created_by: string;
	created_at: string;
	/** (#299) čas, kedy appka detekovala RUČNÝ presun parkovaného odpisu zo staging „NA ODPIS" do
	 *  Money importu (`datetime('now')`); NULL = nepresunutý / neparkovaný. */
	presunute_at: string | null;
	/** (#608) poradie odpisu tejto zákazky/OP v module: 1 = prvý, > 1 = vedomé dorobenie č. N. */
	poradie: number;
}

/** (#608) „ (dorobenie N)" do auditu/logu pre poradie > 1; prvý odpis bez prípony (texty bez zmeny). */
function dorobenieSuffix(poradie: number): string {
	return poradie > 1 ? ` (dorobenie ${poradie})` : '';
}

export function listOdpisy(limit = 200): OdpisLogRow[] {
	return db
		.prepare(
			'SELECT id, modul, zak, op, zakaznik, caka, live, filename, detail, created_by, created_at, presunute_at, poradie FROM odpis_log ORDER BY id DESC LIMIT ?'
		)
		.all(limit) as OdpisLogRow[];
}

// (#299) Detekcia RUČNÉHO presunu parkovaného odpisu zo staging → `money-presun.ts`
// (`detectManualStagingMoves`), extrahované kvôli 1000-riadkovému stropu (large-file-split).

/**
 * Uvoľní dedup kľúč (zmaže záznam) — jediná legitímna cesta, ako po oprave
 * v Money poslať tú istú ZAK+OP znova. Uvoľnenie sa audituje.
 */
export function releaseOdpis(id: number, username: string): boolean {
	const row = db
		.prepare('SELECT modul, zak, op, live, filename, poradie FROM odpis_log WHERE id = ?')
		.get(id) as
		| { modul: string; zak: string; op: string; live: number; filename: string; poradie: number }
		| undefined;
	if (!row) return false;
	db.transaction(() => {
		db.prepare('DELETE FROM odpis_log WHERE id = ?').run(id);
		db.prepare('INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)').run(
			username,
			'odpis',
			JSON.stringify([
				{
					pole: `Uvoľnený odpis ${row.modul} ${row.zak} OP${row.op}${dorobenieSuffix(row.poradie)} (${row.live ? 'LIVE' : 'TEST'}) — ${row.filename}`,
					stara: 1,
					nova: 0
				}
			])
		);
	})();
	log.info('odpis uvoľnený', {
		id,
		modul: row.modul,
		zak: row.zak,
		op: row.op,
		poradie: row.poradie,
		live: !!row.live,
		actor: username
	});
	return true;
}

/**
 * OVERRIDE pre re-import IDENTICKÉHO obsahu (#294) — deliberátna, AUDITOVANÁ akcia, NIKDY tichý
 * bypass. Použije sa LEN keď operátor NAOZAJ zmazal import v Money a potrebuje ho poslať znova s
 * rovnakým obsahom (ledger by ho inak zablokoval). Robí dve veci atomicky:
 *   1. APPEND `kind='override'` do `odpis_imported` (imports > overrides ⇒ blok; jeden override =
 *      jeden povolený re-import, one-shot — počítadlo sa nikdy nevynuluje, len narastá).
 *   2. Uvoľní dedup kľúč (`DELETE odpis_log`), inak by re-send padol na `duplicate`.
 * Audituje sa v `cfg_audit` (rovnako ako `releaseOdpis`). NA ROZDIEL od „Uvoľniť" TOTO povolí aj
 * IDENTICKÝ obsah — bežné „Uvoľniť" ledger stále blokuje (poistka proti nechcenému dvojitému importu).
 */
export function povolitReimport(id: number, username: string): boolean {
	const row = db
		.prepare(
			'SELECT modul, zak, op, live, filename, content_hash, zak_norm, op_norm, poradie FROM odpis_log WHERE id = ?'
		)
		.get(id) as
		| {
				modul: string;
				zak: string;
				op: string;
				live: number;
				filename: string;
				content_hash: string;
				zak_norm: string;
				op_norm: string;
				poradie: number;
		  }
		| undefined;
	if (!row) return false;
	db.transaction(() => {
		db.prepare(
			`INSERT INTO odpis_imported (modul, zak_norm, op_norm, live, content_hash, kind, filename, actor, reason)
			 VALUES (?, ?, ?, ?, ?, 'override', ?, ?, ?)`
		).run(
			row.modul,
			row.zak_norm,
			row.op_norm,
			row.live,
			row.content_hash,
			row.filename,
			username,
			'povolený re-import identického obsahu (potvrdené zmazanie importu v Money)'
		);
		db.prepare('DELETE FROM odpis_log WHERE id = ?').run(id);
		db.prepare('INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)').run(
			username,
			'odpis',
			JSON.stringify([
				{
					pole: `Povolený RE-IMPORT odpisu ${row.modul} ${row.zak} OP${row.op}${dorobenieSuffix(row.poradie)} (${row.live ? 'LIVE' : 'TEST'}) — ${row.filename}`,
					stara: 1,
					nova: 0
				}
			])
		);
	})();
	log.info('odpis re-import povolený (override)', {
		id,
		modul: row.modul,
		zak: row.zak,
		op: row.op,
		poradie: row.poradie,
		live: !!row.live,
		actor: username
	});
	return true;
}

/**
 * Jeden záznam histórie — podklad pre „Použiť znova" (Patrik 2026-07-31: viacerí
 * zákazníci si objednávajú to isté, nech to nemusí vypĺňať nanovo).
 *
 * Vracia LEN dáta; nič sa nezapisuje a nič sa neodpisuje — volajúci z toho
 * predvyplní FORMULÁR, ktorý používateľ ešte vidí a musí odoslať sám.
 */
export function getOdpis(id: number): OdpisLogRow | null {
	if (!Number.isInteger(id) || id <= 0) return null;
	const row = db
		.prepare(
			'SELECT id, modul, zak, op, zakaznik, caka, live, filename, detail, created_by, created_at, presunute_at, poradie FROM odpis_log WHERE id = ?'
		)
		.get(id) as OdpisLogRow | undefined;
	return row ?? null;
}

/**
 * Presné položky odpisu (#154, fáza 1) — 1:1 s tým, čo odišlo do Money, zapísané
 * v tej istej transakcii ako `odpis_log` (viď `writeOdpis`). Podklad pre cenový
 * detail v histórii odpisov (`/odpisy/[id]`). Prázdne pole pre staršie odpisy
 * spred fázy 1 (žiadne položky sa im spätne nedoplnia).
 */
export function listOdpisPolozky(odpisLogId: number): Polozka[] {
	if (!Number.isInteger(odpisLogId) || odpisLogId <= 0) return [];
	return db
		.prepare('SELECT kod, nazov, qty, mj FROM odpis_polozky WHERE odpis_log_id = ? ORDER BY id')
		.all(odpisLogId) as Polozka[];
}
