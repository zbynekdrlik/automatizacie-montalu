// Zápis odpisu do Money importu — GENERICKÁ vrstva pre všetky moduly
// (zasklenia, bazén, pergola). Money auto-importuje .xlsx z /data/dlv-import
// (LEN root, nie rekurzívne — NA ODPIS/* podpriečinky sú odkladacie; overené
// produkčnou prevádzkou), archívuje do DONE a zdroj zmaže. TEST režim píše
// do ODPIS EXPORT — do Money NIKDY nejde nič testovacie.
//
// Poradie proti dvojitému importu:
// 1. NAJPRV sa atomicky zaberie dedup kľúč (INSERT, UNIQUE modul+zak+op+live).
// 2. Až POTOM sa zapíše súbor (tmp bez prípony + rename = atomické, watcher
//    tmp nevidí).
// 3. Ak zápis súboru zlyhá, dedup záznam sa zmaže (kompenzácia).
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { db } from './db';

export type Modul = 'zasklenia' | 'bazen' | 'pergola';

export interface Polozka {
	kod: string;
	nazov: string;
	qty: number;
}

export interface OdpisJob {
	modul: Modul;
	zak: string;
	op: string;
	zakaznik: string;
	caka: boolean;
	createdBy: string;
	/** podpriečinok v NA ODPIS pre čaká-režim (Robust/Slide/Bazen/Pergola) */
	cakaSubdir: string;
	/** názov súboru bez [hash].xlsx */
	filenameBase: string;
	/** Popis dokladu v PRVOM riadku xlsx (formát per modul — 1:1 s n8n verziou) */
	popis: string;
	/** riadky do xlsx PRESNE v tomto poradí (bazén posiela aj nulové — ako Excel) */
	polozky: Polozka[];
	/** modulovo-špecifické polia do histórie (system/styl/rozmery/model…) */
	detail: Record<string, unknown>;
}

export interface OdpisOutcome {
	status: 'written' | 'duplicate';
	live: boolean;
	target: string;
	filename: string;
	duplicateCreatedAt?: string;
}

// env sa číta pri každom volaní (nie pri importe) — kvôli testom a možnosti
// prepnúť LIVE bez rebuildu (reštart kontajnera s novým env stačí).
export const isLive = () => process.env.MONEY_LIVE === '1';
const liveDir = () => process.env.MONEY_LIVE_DIR || '/data/dlv-import';
const naOdpisDir = () => process.env.MONEY_NA_ODPIS_DIR || '/data/dlv-import/NA ODPIS';
const testDir = () =>
	process.env.MONEY_TEST_DIR ||
	'/data/montalu/konstrukcia/AUTOMATIZACIA ODPIS MATERIALU/ODPIS EXPORT';

export const safe = (s: string) => String(s).replace(/[/\\:*?"<>|]+/g, '_').trim();

export function targetDirFor(cakaSubdir: string, caka: boolean): string {
	if (!isLive()) return testDir();
	if (caka) return path.join(naOdpisDir(), cakaSubdir);
	return liveDir();
}

export function contentHash(zak: string, polozky: Polozka[]): string {
	const sig = zak + '|' + polozky.map((o) => o.kod + ':' + o.qty).sort().join(';');
	let h = 5381;
	for (let i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) >>> 0;
	return ('00000000' + h.toString(16)).slice(-8);
}

export function filenameFor(job: Pick<OdpisJob, 'zak' | 'filenameBase' | 'polozky'>): string {
	// contentHash na konci kryje kolíziu dvoch RÔZNYCH zákaziek, ktoré
	// sanitizácia zloží na rovnaký názov (hash počíta zo surovej ZAK)
	return `${job.filenameBase} [${contentHash(job.zak, job.polozky)}].xlsx`;
}

async function buildXlsx(job: OdpisJob): Promise<Buffer> {
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Hárok2');
	ws.addRow(['číslo zakázky', 'Kód položky', 'Název položky', 'Množství v m', 'MJ', 'Popis dokladu']);
	job.polozky.forEach((o, i) => {
		ws.addRow([job.zak, o.kod, o.nazov, o.qty, 'm', i === 0 ? job.popis : '']);
	});
	return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Zapíše odpis (alebo vráti duplicate). Vyhadzuje výnimku len pri zlyhaní
 * zápisu súboru — vtedy je dedup záznam už odstránený a odoslanie sa dá
 * bezpečne zopakovať.
 */
export async function writeOdpis(job: OdpisJob): Promise<OdpisOutcome> {
	const live = isLive() ? 1 : 0;
	const dir = targetDirFor(job.cakaSubdir, job.caka);
	const filename = filenameFor(job);
	const target = path.join(dir, filename);

	let rowId: number | bigint;
	try {
		rowId = db
			.prepare(
				`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				job.modul,
				job.zak,
				job.op,
				job.zakaznik,
				job.caka ? 1 : 0,
				live,
				target,
				filename,
				contentHash(job.zak, job.polozky),
				JSON.stringify(job.detail),
				job.createdBy
			).lastInsertRowid;
	} catch (e: unknown) {
		if (e instanceof Error && e.message.includes('UNIQUE')) {
			const existing = db
				.prepare(
					'SELECT created_at FROM odpis_log WHERE modul = ? AND zak = ? AND op = ? AND live = ?'
				)
				.get(job.modul, job.zak, job.op, live) as { created_at: string } | undefined;
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
		const buf = await buildXlsx(job);
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
}

export function listOdpisy(limit = 200): OdpisLogRow[] {
	return db
		.prepare(
			'SELECT id, modul, zak, op, zakaznik, caka, live, filename, detail, created_by, created_at FROM odpis_log ORDER BY id DESC LIMIT ?'
		)
		.all(limit) as OdpisLogRow[];
}

/**
 * Uvoľní dedup kľúč (zmaže záznam) — jediná legitímna cesta, ako po oprave
 * v Money poslať tú istú ZAK+OP znova. Uvoľnenie sa audituje.
 */
export function releaseOdpis(id: number, username: string): boolean {
	const row = db
		.prepare('SELECT modul, zak, op, live, filename FROM odpis_log WHERE id = ?')
		.get(id) as
		| { modul: string; zak: string; op: string; live: number; filename: string }
		| undefined;
	if (!row) return false;
	db.transaction(() => {
		db.prepare('DELETE FROM odpis_log WHERE id = ?').run(id);
		db.prepare('INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)').run(
			username,
			'odpis',
			JSON.stringify([
				{
					pole: `Uvoľnený odpis ${row.modul} ${row.zak} OP${row.op} (${row.live ? 'LIVE' : 'TEST'}) — ${row.filename}`,
					stara: 1,
					nova: 0
				}
			])
		);
	})();
	return true;
}
