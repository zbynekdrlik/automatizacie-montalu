// Zápis odpisu do Money importu. Money auto-importuje .xlsx z /data/dlv-import
// (root), archívuje do DONE a zdroj zmaže. TEST režim píše do ODPIS EXPORT —
// do Money NIKDY nejde nič testovacie.
//
// Poradie proti dvojitému importu (nález auditu v n8n verzii):
// 1. NAJPRV sa atomicky zaberie dedup kľúč (INSERT, UNIQUE zak+op+live v DB) —
//    súbežné odoslania vyrieši constraint, nie časovanie.
// 2. Až POTOM sa zapíše súbor (tmp + rename = atomické).
// 3. Ak zápis súboru zlyhá, dedup záznam sa zmaže (kompenzácia) a chyba sa hlási.
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { db } from './db';
import type { ComputeResult } from './compute';

// env sa číta pri každom volaní (nie pri importe) — kvôli testom a možnosti
// prepnúť LIVE bez rebuildu (reštart kontajnera s novým env stačí).
export const isLive = () => process.env.MONEY_LIVE === '1';
const liveDir = () => process.env.MONEY_LIVE_DIR || '/data/dlv-import';
// NA ODPIS je VNÚTRI dlv-import zámerne — Money watcher importuje LEN root
// (nie rekurzívne). Overené produkciou: bazén/pergola n8n verzie tam roky
// odkladajú čaká-súbory a Money ich neimportuje, kým ich Dominik nepresunie.
const naOdpisDir = () => process.env.MONEY_NA_ODPIS_DIR || '/data/dlv-import/NA ODPIS';
const testDir = () =>
	process.env.MONEY_TEST_DIR ||
	'/data/montalu/konstrukcia/AUTOMATIZACIA ODPIS MATERIALU/ODPIS EXPORT';

export interface OdpisRequest {
	zak: string;
	op: string;
	zakaznik: string;
	sklo: string;
	otvaranie: string;
	caka: boolean;
	createdBy: string;
	result: ComputeResult;
}

export interface OdpisOutcome {
	status: 'written' | 'duplicate';
	live: boolean;
	target: string;
	filename: string;
	duplicateCreatedAt?: string;
}

const safe = (s: string) => String(s).replace(/[/\\:*?"<>|]+/g, '_').trim();

export function targetDirFor(system: string, caka: boolean): string {
	if (!isLive()) return testDir();
	if (caka) return path.join(naOdpisDir(), system === 'Slide' ? 'Slide' : 'Robust');
	return liveDir();
}

export function filenameFor(req: OdpisRequest): string {
	const { zak, op, zakaznik, result } = req;
	// OP je v názve súboru — dve OP tej istej zákazky sa NESMÚ navzájom prepísať
	// (nález auditu: stratený odpis v čaká-priečinku). contentHash na konci kryje
	// kolíziu dvoch RÔZNYCH zákaziek, ktoré sanitizácia zloží na rovnaký názov
	// (napr. „2026/12" aj „2026:12" → „2026_12") — hash počíta zo surovej ZAK.
	return `${safe(zak)} - OP${safe(op)} - ${safe(zakaznik)} ZASKLENIA ${safe(result.system)} ${safe(result.styl)} [${contentHash(zak, result)}].xlsx`;
}

export function contentHash(zak: string, result: ComputeResult): string {
	const sig = zak + '|' + result.odpis.map((o) => o.kod + ':' + o.metre).sort().join(';');
	let h = 5381;
	for (let i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) >>> 0;
	return ('00000000' + h.toString(16)).slice(-8);
}

async function buildXlsx(req: OdpisRequest): Promise<Buffer> {
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Hárok2');
	ws.addRow(['číslo zakázky', 'Kód položky', 'Název položky', 'Množství v m', 'MJ', 'Popis dokladu']);
	const popis = (req.op + ' : ' + req.zakaznik).trim();
	req.result.odpis.forEach((o, i) => {
		ws.addRow([req.zak, o.kod, o.nazov, o.metre, 'm', i === 0 ? popis : '']);
	});
	return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Zapíše odpis (alebo vráti duplicate). Vyhadzuje výnimku len pri zlyhaní
 * zápisu súboru — vtedy je dedup záznam už odstránený a odoslanie sa dá
 * bezpečne zopakovať.
 */
export async function writeOdpis(req: OdpisRequest): Promise<OdpisOutcome> {
	const live = isLive() ? 1 : 0;
	const dir = targetDirFor(req.result.system, req.caka);
	const filename = filenameFor(req);
	const target = path.join(dir, filename);

	let rowId: number | bigint;
	try {
		rowId = db
			.prepare(
				`INSERT INTO odpis_log (zak, op, zakaznik, system, styl, s, v, sklo, otvaranie, caka, live, target, filename, content_hash, created_by)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				req.zak,
				req.op,
				req.zakaznik,
				req.result.system,
				req.result.styl,
				req.result.S,
				req.result.V,
				req.sklo,
				req.otvaranie,
				req.caka ? 1 : 0,
				live,
				target,
				filename,
				contentHash(req.zak, req.result),
				req.createdBy
			).lastInsertRowid;
	} catch (e: unknown) {
		if (e instanceof Error && e.message.includes('UNIQUE')) {
			const existing = db
				.prepare('SELECT created_at FROM odpis_log WHERE zak = ? AND op = ? AND live = ?')
				.get(req.zak, req.op, live) as { created_at: string } | undefined;
			return {
				status: 'duplicate',
				live: isLive(),
				target,
				filename,
				duplicateCreatedAt: existing?.created_at
			};
		}
		throw e;
	}

	try {
		const buf = await buildXlsx(req);
		fs.mkdirSync(dir, { recursive: true });
		// tmp súbor BEZ prípony .xlsx — Money watcher v live priečinku importuje
		// *.xlsx a bodka na začiatku ho na Samba share neskryje; bez prípony ho
		// watcher nevidí a rename v rovnakom adresári je atomický
		const tmp = path.join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
		fs.writeFileSync(tmp, buf);
		fs.renameSync(tmp, target);
	} catch (e) {
		// kompenzácia: súbor sa nezapísal → uvoľni dedup kľúč, nech sa dá poslať znova
		db.prepare('DELETE FROM odpis_log WHERE id = ?').run(rowId);
		throw e;
	}

	return { status: 'written', live: isLive(), target, filename };
}

export interface OdpisLogRow {
	id: number;
	zak: string;
	op: string;
	zakaznik: string;
	system: string;
	styl: string;
	s: number;
	v: number;
	caka: number;
	live: number;
	filename: string;
	created_by: string;
	created_at: string;
}

export function listOdpisy(limit = 100): OdpisLogRow[] {
	return db
		.prepare(
			'SELECT id, zak, op, zakaznik, system, styl, s, v, caka, live, filename, created_by, created_at FROM odpis_log ORDER BY id DESC LIMIT ?'
		)
		.all(limit) as OdpisLogRow[];
}

/**
 * Uvoľní dedup kľúč (zmaže záznam) — jediná legitímna cesta, ako po oprave
 * v Money poslať tú istú ZAK+OP znova. Uvoľnenie sa audituje.
 */
export function releaseOdpis(id: number, username: string): boolean {
	const row = db
		.prepare('SELECT zak, op, live, filename FROM odpis_log WHERE id = ?')
		.get(id) as { zak: string; op: string; live: number; filename: string } | undefined;
	if (!row) return false;
	db.transaction(() => {
		db.prepare('DELETE FROM odpis_log WHERE id = ?').run(id);
		db.prepare('INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)').run(
			username,
			'odpis',
			JSON.stringify([
				{
					pole: `Uvoľnený odpis ${row.zak} OP${row.op} (${row.live ? 'LIVE' : 'TEST'}) — ${row.filename}`,
					stara: 1,
					nova: 0
				}
			])
		);
	})();
	return true;
}
