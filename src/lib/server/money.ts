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
import { logger } from './log';
import type { MJ } from '$lib/komponenty';

const log = logger('money');

export type Modul = 'zasklenia' | 'bazen' | 'pergola';

export interface Polozka {
	kod: string;
	nazov: string;
	qty: number;
	/** jednotka v Money. CHÝBA ⇒ 'm' — profily (a celá história do v0.8.0) sú metrážové;
	 *  'ks' majú kusové položky kovania (Dominik 2026-07-28). Money má MJ na karte zásoby,
	 *  takže tu MUSÍ sedieť s ňou, inak sa naveze zlé množstvo. */
	mj?: MJ;
}

/**
 * Aplikuje ručné úpravy množstiev z kontrolnej stránky. Kľúč = kod.
 * Nečíselná alebo záporná hodnota = CHYBA (nie tiché 0 do Money), limit
 * 100 000 chráni pred preklepom. Zdieľané bazénom aj pergolou.
 */
export function applyEdits<T extends Polozka>(
	out: T[],
	edits: Map<string, string>
): { finalOut: T[]; zmenene: string[]; error: string | null } {
	const R = (x: number) => Math.round(x * 1000) / 1000;
	const finalOut: T[] = [];
	const zmenene: string[] = [];
	for (const o of out) {
		const raw = edits.get(o.kod);
		if (raw === undefined || raw.trim() === '') {
			finalOut.push({ ...o });
			continue;
		}
		const q = parseFloat(String(raw).replace(',', '.'));
		if (!Number.isFinite(q))
			return {
				finalOut: [],
				zmenene: [],
				error: `Neplatné množstvo „${raw}" pri ${o.kod} ${o.nazov}.`
			};
		if (q < 0)
			return {
				finalOut: [],
				zmenene: [],
				error: `Záporné množstvo (${q}) pri ${o.kod} ${o.nazov} — do Money nesmie ísť.`
			};
		if (q > 100000)
			return {
				finalOut: [],
				zmenene: [],
				error: `Podozrivo veľké množstvo (${q} m) pri ${o.kod} ${o.nazov}.`
			};
		const rq = R(q);
		if (rq !== o.qty) zmenene.push(o.kod);
		finalOut.push({ ...o, qty: rq });
	}
	return { finalOut, zmenene, error: null };
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
	/** Popis dokladu v PRVOM riadku xlsx (formát per modul — 1:1 s n8n verziou) */
	popis: string;
	/** riadky do xlsx PRESNE v tomto poradí (bazén posiela aj nulové — ako Excel) */
	polozky: Polozka[];
	/** modulovo-špecifické polia do histórie (system/styl/rozmery/model…) */
	detail: Record<string, unknown>;
	/** #221 — rezervačný odpis (materiál sa rezervuje pri zadaní objednávky, nie z CAD-u).
	 *  default undefined/false = bežný odpis. Keď true: názov súboru dostane marker „REZ"
	 *  a volajúci označí aj doklad (`popis`), aby neskoršia aktualizácia na reálne čísla
	 *  (#227) vedela rezerváciu nájsť/napárovať. Dedup kľúč sa NEMENÍ (modul='pergola'),
	 *  takže rezervácia a neskorší CAD odpis tej istej ZAK+OP kolidujú — bráni dvojitému
	 *  odpisu materiálu. */
	rezervacia?: boolean;
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

export const safe = (s: string) =>
	String(s)
		.replace(/[/\\:*?"<>|]+/g, '_')
		.trim();

export function targetDirFor(cakaSubdir: string, caka: boolean): string {
	if (!isLive()) return testDir();
	if (caka) return path.join(naOdpisDir(), cakaSubdir);
	return liveDir();
}

/** Rozriešené Money cieľové adresáre + LIVE stav — pre štartovací config log (db.ts, #245). */
export function moneyConfig(): {
	live: boolean;
	liveDir: string;
	naOdpisDir: string;
	testDir: string;
} {
	return { live: isLive(), liveDir: liveDir(), naOdpisDir: naOdpisDir(), testDir: testDir() };
}

export function contentHash(zak: string, polozky: Polozka[]): string {
	const sig =
		zak +
		'|' +
		polozky
			.map((o) => o.kod + ':' + o.qty)
			.sort()
			.join(';');
	let h = 5381;
	for (let i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) >>> 0;
	return ('00000000' + h.toString(16)).slice(-8);
}

/**
 * Názov súboru: „ZAK2026337 - Zákazník B [b1e403ee].xlsx" — číslo zákazky
 * a zákazník, nič viac (šéf 2026-07-29). OP sa do názvu NEDÁVA: kolónka je
 * „OP/OPDL číslo" a ľudia do nej OP píšu, takže starý prefix vyrábal „OPOP250359".
 *
 * Hash na konci kryje kolízie: dve RÔZNE zákazky, ktoré sanitizácia zloží na
 * rovnaký názov, aj dva odpisy tej istej zákazky s rôznym OP (bez OP v názve
 * by mali rovnaký názov a druhý by ten prvý v import priečinku prepísal),
 * preto do neho ide aj OP.
 */
export function filenameFor(
	job: Pick<OdpisJob, 'zak' | 'op' | 'zakaznik' | 'polozky' | 'rezervacia'>
): string {
	const hash = contentHash(`${job.zak}|OP${job.op}`, job.polozky);
	// #221: rezervačný odpis dostane marker „REZ" pred hash — v Money import priečinku
	// je hneď vidno, že ide o rezerváciu, a #227 (aktualizácia na reálne čísla) ju
	// vie nájsť/napárovať podľa ZAK + (hash nesie OP). Bežný odpis marker nemá.
	const rez = job.rezervacia ? 'REZ ' : '';
	return `${safe(job.zak)} - ${safe(job.zakaznik)} ${rez}[${hash}].xlsx`;
}

// exportované kvôli goldenu #234 (test číta buffer priamo — bez DB, bez env, bez zápisu)
export async function buildXlsx(job: OdpisJob): Promise<Buffer> {
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet('Hárok2');
	ws.addRow([
		'číslo zakázky',
		'Kód položky',
		'Název položky',
		'Množství v m',
		'MJ',
		'Popis dokladu'
	]);
	job.polozky.forEach((o, i) => {
		// hlavička stĺpca zostáva „Množství v m" (tak ju Money import očakáva) — skutočnú
		// jednotku nesie stĺpec MJ, kde 'm' je default kvôli všetkým metrážovým položkám
		ws.addRow([job.zak, o.kod, o.nazov, o.qty, o.mj ?? 'm', i === 0 ? job.popis : '']);
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
		// odpis_log + odpis_polozky v JEDNEJ transakcii (#154, fáza 1): položky sú 1:1
		// s tým, čo odišlo do Money (predtým appka držala len súhrn v `detail`) a musia
		// vzniknúť/zaniknúť SPOLU s dedup záznamom — nikdy log bez položiek alebo naopak.
		// UNIQUE (dedup) aj FK zlyhanie automaticky rollbackne CELÚ transakciu.
		const insLog = db.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const insPolozka = db.prepare(
			`INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (?, ?, ?, ?, ?)`
		);
		rowId = db.transaction(() => {
			const id = insLog.run(
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
			for (const o of job.polozky) insPolozka.run(id, o.kod, o.nazov, o.qty, o.mj ?? 'm');
			return id;
		})();
	} catch (e: unknown) {
		if (e instanceof Error && e.message.includes('UNIQUE')) {
			const existing = db
				.prepare(
					'SELECT created_at FROM odpis_log WHERE modul = ? AND zak = ? AND op = ? AND live = ?'
				)
				.get(job.modul, job.zak, job.op, live) as { created_at: string } | undefined;
			log.warn('odpis duplikát — dedup kľúč už existuje, nič sa nezapisuje', {
				modul: job.modul,
				zak: job.zak,
				op: job.op,
				live: isLive(),
				existingCreatedAt: existing?.created_at
			});
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

	// dedup kľúč zabraný (INSERT prešiel) — súbor sa ešte len zapisuje
	log.info('odpis claim', {
		modul: job.modul,
		zak: job.zak,
		op: job.op,
		live: isLive(),
		caka: job.caka
	});

	try {
		const buf = await buildXlsx(job);
		fs.mkdirSync(dir, { recursive: true });
		// tmp súbor BEZ prípony .xlsx — Money watcher v live priečinku importuje
		// *.xlsx a bodka na začiatku ho na Samba share neskryje; bez prípony ho
		// watcher nevidí a rename v rovnakom adresári je atomický
		const tmp = path.join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
		fs.writeFileSync(tmp, buf);
		fs.renameSync(tmp, target);
		log.info('odpis zapísaný', {
			modul: job.modul,
			zak: job.zak,
			op: job.op,
			live: isLive(),
			target,
			bytes: buf.length
		});
	} catch (e) {
		// kompenzácia: súbor sa nezapísal → uvoľni dedup kľúč, nech sa dá poslať znova
		db.prepare('DELETE FROM odpis_log WHERE id = ?').run(rowId);
		log.error('odpis kompenzácia — zápis súboru zlyhal, dedup kľúč uvoľnený', {
			modul: job.modul,
			zak: job.zak,
			op: job.op,
			live: isLive(),
			target,
			error: e
		});
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
		{ modul: string; zak: string; op: string; live: number; filename: string } | undefined;
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
	log.info('odpis uvoľnený', {
		id,
		modul: row.modul,
		zak: row.zak,
		op: row.op,
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
			'SELECT id, modul, zak, op, zakaznik, caka, live, filename, detail, created_by, created_at FROM odpis_log WHERE id = ?'
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
