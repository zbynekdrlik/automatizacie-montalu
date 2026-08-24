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
	status: 'written' | 'duplicate' | 'blocked';
	/** dôvod bloku (len `status==='blocked'`): `ledger-duplicate` = identický obsah tej istej
	 *  zákazky už bol importovaný do Money a nebol RE-autorizovaný override-om (#294). */
	reason?: 'ledger-duplicate';
	live: boolean;
	target: string;
	filename: string;
	duplicateCreatedAt?: string;
	/** len `reason==='ledger-duplicate'`: kedy bol identický obsah naposledy importovaný */
	ledgerImportedAt?: string;
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
 * Normalizácia čísla objednávky (`op`) pre dedup + ledger kľúč (#294): `trim`, `toUpperCase`,
 * zbaliť whitespace + kanonizovať OP prefix — `'260286'` ≡ `'OP260286'`, `'OPOP260233'` →
 * `'OP260233'` (zdvojený OP z copy-paste). `'OPDL…'` je INÝ typ dokladu (nie OP) → ostáva
 * nedotknutý. Prázdny reťazec ostáva prázdny.
 */
export function normOp(op: string): string {
	let s = String(op).trim().toUpperCase().replace(/\s+/g, '');
	if (!s) return '';
	s = s.replace(/^(OP)+(?=\d)/, 'OP'); // OPOP260233 → OP260233 ; OP260286 → OP260286
	if (/^\d/.test(s)) s = 'OP' + s; // 260286 → OP260286
	return s;
}

/** Normalizácia čísla zákazky (`zak`) pre dedup + ledger kľúč (#294): `trim`/`toUpperCase`/
 *  zbaliť whitespace. ZAK nemá prefixovú kanonizáciu ako `op`. */
export function normZak(zak: string): string {
	return String(zak).trim().toUpperCase().replace(/\s+/g, '');
}

/** Prehodené polia (`zak` obsahuje `OP…`, `op` obsahuje `ZAK…`) — verdikt §2 id=38/78. Nie je to
 *  tvrdý blok (dedup aj tak funguje na normalizovaných hodnotách), ale zaslúži si WARN do logu. */
function detekujPrehodenePolia(zakNorm: string, opNorm: string): boolean {
	return zakNorm.startsWith('OP') || opNorm.startsWith('ZAK');
}

/** Hláška pre operátora, keď ledger zablokoval re-import IDENTICKÉHO obsahu (#294,
 *  `reason==='ledger-duplicate'`). Jeden zdroj pravdy pre všetky moduly. */
export function blokLedgerHlaska(zak: string, op: string, importedAt?: string): string {
	return (
		`Rovnaký obsah zákazky ${zak} (OP ${op}) už bol raz importovaný do Money` +
		(importedAt ? ` (${importedAt})` : '') +
		`. Znova ho NEposielam — poistka proti dvojitému importu. Ak si import v Money NAOZAJ zmazal, ` +
		`v „História odpisov" použi „⚠️ Povoliť rovnaký".`
	);
}

interface LedgerCounts {
	imports: number;
	overrides: number;
	lastImportedAt: string | undefined;
}

/**
 * Počítadlo APPEND-ONLY ledgeru `odpis_imported` (#294) pre daný per-order tuple + `content_hash`.
 * `writeOdpis` blokuje re-import, keď `imports > overrides` (identický obsah už raz importovaný a
 * nebol RE-autorizovaný). Kľúč NIKDY nie je globálny hash — dve rôzne zákazky smú mať rovnaký obsah.
 */
function ledgerCounts(
	modul: string,
	zakNorm: string,
	opNorm: string,
	live: number,
	contentHashV: string
): LedgerCounts {
	const row = db
		.prepare(
			`SELECT
				SUM(CASE WHEN kind = 'import' THEN 1 ELSE 0 END) AS imports,
				SUM(CASE WHEN kind = 'override' THEN 1 ELSE 0 END) AS overrides,
				MAX(CASE WHEN kind = 'import' THEN created_at END) AS lastImportedAt
			 FROM odpis_imported
			 WHERE modul = ? AND zak_norm = ? AND op_norm = ? AND live = ? AND content_hash = ?`
		)
		.get(modul, zakNorm, opNorm, live, contentHashV) as {
		imports: number | null;
		overrides: number | null;
		lastImportedAt: string | null;
	};
	return {
		imports: row.imports ?? 0,
		overrides: row.overrides ?? 0,
		lastImportedAt: row.lastImportedAt ?? undefined
	};
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
	const zakNorm = normZak(job.zak);
	const opNorm = normOp(job.op);
	// content_hash pre ledger AJ pre odpis_log — normalizovaný zak (planHash guard modulov je
	// oddelený, počíta si vlastný hash z RAW zak; toto je iba dedup/ledger kľúč, žiadny konzument
	// logiky ho z odpis_log nečíta — overené grepom).
	const ledgerHash = contentHash(zakNorm, job.polozky);
	const dir = targetDirFor(job.cakaSubdir, job.caka);
	const filename = filenameFor(job);
	const target = path.join(dir, filename);

	if (detekujPrehodenePolia(zakNorm, opNorm)) {
		log.warn('odpis: podozrenie na prehodené polia zak/op', {
			modul: job.modul,
			zak: job.zak,
			op: job.op,
			zakNorm,
			opNorm
		});
	}

	// (#294) normalizovaný dedup precheck — OP260286 ≡ 260286 obíde RAW UNIQUE, tak dedup-ujeme na
	// normalizovaných stĺpcoch. RAW UNIQUE(modul,zak,op,live) nižšie ostáva pre atomicitu race-u.
	const normDup = db
		.prepare(
			'SELECT created_at FROM odpis_log WHERE modul = ? AND live = ? AND zak_norm = ? AND op_norm = ?'
		)
		.get(job.modul, live, zakNorm, opNorm) as { created_at: string } | undefined;
	if (normDup) {
		log.warn('odpis duplikát — normalizovaný dedup kľúč už existuje, nič sa nezapisuje', {
			modul: job.modul,
			zak: job.zak,
			op: job.op,
			zakNorm,
			opNorm,
			live: isLive(),
			existingCreatedAt: normDup.created_at
		});
		return {
			status: 'duplicate',
			live: isLive(),
			target,
			filename,
			duplicateCreatedAt: normDup.created_at
		};
	}

	// (#294) APPEND-ONLY ledger safety-net — identický obsah tej istej zákazky (per-order tuple +
	// content_hash) už bol importovaný do Money a nebol RE-autorizovaný override-om (`povolitReimport`).
	// Toto je poistka, ktorú „Uvoľniť" NEZMAŽE: releaseOdpis maže len `odpis_log`, ledger ostáva.
	const led = ledgerCounts(job.modul, zakNorm, opNorm, live, ledgerHash);
	if (led.imports > led.overrides) {
		log.warn('odpis blokovaný ledgerom — identický obsah už importovaný do Money bez override', {
			modul: job.modul,
			zak: job.zak,
			op: job.op,
			live: isLive(),
			lastImportedAt: led.lastImportedAt
		});
		return {
			status: 'blocked',
			reason: 'ledger-duplicate',
			live: isLive(),
			target,
			filename,
			ledgerImportedAt: led.lastImportedAt
		};
	}

	let rowId: number | bigint;
	try {
		// odpis_log + odpis_polozky v JEDNEJ transakcii (#154, fáza 1): položky sú 1:1
		// s tým, čo odišlo do Money (predtým appka držala len súhrn v `detail`) a musia
		// vzniknúť/zaniknúť SPOLU s dedup záznamom — nikdy log bez položiek alebo naopak.
		// UNIQUE (dedup) aj FK zlyhanie automaticky rollbackne CELÚ transakciu.
		const insLog = db.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, zak_norm, op_norm)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
				ledgerHash,
				JSON.stringify(job.detail),
				job.createdBy,
				zakNorm,
				opNorm
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
		// #246: durable atomic write. `writeFileSync` samotné nechá dáta len v OS page
		// cache a vráti sa — pri výpadku prúdu môže rename metadáta prežiť, kým dáta
		// súboru ešte nie sú na disku → Money watcher by naimportoval NEÚPLNÝ/skrátený
		// xlsx. Preto: zapíš do tmp cez fd, `fsync(fd)` (dáta durable) PRED rename; potom
		// atomický rename; nakoniec best-effort `fsync(dir)` PO rename (durable aj samotný
		// rename = dir-entry). writeFileSync(fd) zachováva plný zápisový loop originálu,
		// fd necháva otvorený (zatvárame my). Dir fsync je best-effort — cez Samba / na
		// Windows sa adresár nemusí dať fsync-núť, čo nie je fatálne (dáta sú už durable).
		const fd = fs.openSync(tmp, 'w');
		try {
			fs.writeFileSync(fd, buf);
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
		fs.renameSync(tmp, target);
		try {
			const dirFd = fs.openSync(dir, 'r');
			try {
				fs.fsyncSync(dirFd);
			} finally {
				fs.closeSync(dirFd);
			}
		} catch {
			// dir fsync best-effort (Windows/Samba adresár sa nemusí dať otvoriť na fsync)
			// — obsah súboru je už durable cez fsync(fd) vyššie
		}
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

	// (#294) APPEND-ONLY ledger — až PO úspešnom `rename` (súbor je reálne v import priečinku, teda
	// „bol importovaný"). Kompenzácia (vyššie) tento riadok NEVYTVORÍ (vzniká len po úspechu) a
	// `releaseOdpis`/`povolitReimport` ho NIKDY nemažú — to je celý zmysel poistky mimo dedup kľúča.
	db.prepare(
		`INSERT INTO odpis_imported (modul, zak_norm, op_norm, live, content_hash, kind, filename, actor)
		 VALUES (?, ?, ?, ?, ?, 'import', ?, ?)`
	).run(job.modul, zakNorm, opNorm, live, ledgerHash, filename, job.createdBy);

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
			'SELECT modul, zak, op, live, filename, content_hash, zak_norm, op_norm FROM odpis_log WHERE id = ?'
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
					pole: `Povolený RE-IMPORT odpisu ${row.modul} ${row.zak} OP${row.op} (${row.live ? 'LIVE' : 'TEST'}) — ${row.filename}`,
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
