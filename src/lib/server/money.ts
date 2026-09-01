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
import { validateOdpisKody, type KodProblem } from './ceny';
import type { MJ } from '$lib/komponenty';

const log = logger('money');

// #340: observer po ÚSPEŠNOM zápise odpisu (`status:'written'`) — dostane číslo zákazky
// (`zak`) a objednávky (`op`). Registruje ho composition root (`hooks.server.ts` →
// `queueZakazkaPush`), takže money.ts NEZÁVISÍ od Odoo vrstvy (žiadny cyklický import,
// money-neutrálne). Volá sa fire-and-forget PO commite + durable zápise a NIKDY nesmie
// ovplyvniť/zhodiť už-zapísaný odpis (sync-guard v mieste volania).
export type OdpisWrittenHook = (zak: string, op: string) => void;
let onOdpisWritten: OdpisWrittenHook | null = null;
export function setOdpisWrittenHook(fn: OdpisWrittenHook | null): void {
	onOdpisWritten = fn;
}

export type Modul = 'zasklenia' | 'bazen' | 'pergola' | 'clip' | 'fix';

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
				error: `Podozrivo veľké množstvo (${q} ${o.mj ?? 'm'}) pri ${o.kod} ${o.nazov}.`
			};
		// kusové položky (#355) sú celé kusy — zlomkový výdaj do Money nedáva zmysel
		if (o.mj === 'ks' && !Number.isInteger(q))
			return {
				finalOut: [],
				zmenene: [],
				error: `Kusová položka ${o.kod} ${o.nazov} musí byť celé číslo (${q} ks nejde do Money).`
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
	 *  zákazky už bol importovaný do Money a nebol RE-autorizovaný override-om (#294);
	 *  `unknown-kod` = Money niektorý kód nepozná / nemá skladovú kartu → import by doklad ticho
	 *  preskočil (#295); `prehodene-polia` = zak/op sú pravdepodobne zamenené (zak obsahuje OP…,
	 *  op obsahuje ZAK… — tvar ZAK2026499) → do Money by šiel doklad so zameneným číslom zákazky a
	 *  objednávky; blokuje LEN pre live=1 (#307). */
	reason?: 'ledger-duplicate' | 'unknown-kod' | 'prehodene-polia';
	live: boolean;
	target: string;
	filename: string;
	duplicateCreatedAt?: string;
	/** len `reason==='ledger-duplicate'`: kedy bol identický obsah naposledy importovaný */
	ledgerImportedAt?: string;
	/** len `reason==='unknown-kod'`: kódy, ktoré Money nepozná / nemajú skladovú kartu */
	chybajuceKody?: KodProblem[];
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

/** Prehodené polia (`zak` obsahuje `OP…`, `op` obsahuje `ZAK…`) — verdikt §2 id=38/78. Pre live=1 to
 *  `writeOdpis` TVRDO BLOKUJE (audited override, #307); pre test/live=0 ostáva WARN-only. */
function detekujPrehodenePolia(zakNorm: string, opNorm: string): boolean {
	return zakNorm.startsWith('OP') || opNorm.startsWith('ZAK');
}

/** Hláška pre operátora, keď ledger zablokoval re-import IDENTICKÉHO obsahu (#294,
 *  `reason==='ledger-duplicate'`). */
function blokLedgerHlaska(zak: string, op: string, importedAt?: string): string {
	return (
		`Rovnaký obsah zákazky ${zak} (OP ${op}) už bol raz importovaný do Money` +
		(importedAt ? ` (${importedAt})` : '') +
		`. Znova ho NEposielam — poistka proti dvojitému importu. Ak si import v Money NAOZAJ zmazal, ` +
		`potvrď to tlačidlom „⚠️ Odoslať aj tak" nižšie (rovnaký obsah pošle ešte raz).`
	);
}

/** Hláška pre operátora, keď Money niektorý kód nepozná / nemá naň skladovú kartu (#295,
 *  `reason==='unknown-kod'`). Import by taký doklad ticho NEODPÍSAL (celý sa preskočí). */
function blokKodyHlaska(problemy: KodProblem[]): string {
	const kody = problemy
		.map((p) => `${p.kod}${p.dovod === 'bez-skladovej-karty' ? ' (bez skladovej karty)' : ''}`)
		.join(', ');
	const slovo = problemy.length === 1 ? 'kód' : 'kódy';
	return (
		`Money nepozná ${slovo}: ${kody}. Tento doklad by import NEODPÍSAL (Money pri neznámom ` +
		`kóde preskočí CELÝ doklad). Skontroluj kód, alebo ho nechaj doplniť do Money. Ak je kód ` +
		`správny a Money ho už má, cenník sa aktualizuje ráno.`
	);
}

/** Hláška pre operátora, keď sú polia zak/op pravdepodobne PREHODENÉ (#307, `reason==='prehodene-polia'`).
 *  Pole „číslo zákazky" nesie OP… číslo a/alebo pole „OP/OPDL" nesie ZAK… — pravdepodobný preklep pri
 *  zadaní. Do Money by šiel doklad so zameneným číslom zákazky a objednávky. */
function blokPrehodeneHlaska(zak: string, op: string): string {
	const problemy: string[] = [];
	if (normZak(zak).startsWith('OP'))
		problemy.push(`pole „číslo zákazky" obsahuje OP číslo (${zak})`);
	if (normOp(op).startsWith('ZAK')) problemy.push(`pole „OP/OPDL" obsahuje číslo zákazky (${op})`);
	return (
		`Polia sú pravdepodobne prehodené: ${problemy.join(' a ')}. Do Money by šiel doklad so ` +
		`zameneným číslom zákazky a objednávky. Skontroluj a oprav zadanie (správne ZAK do „číslo ` +
		`zákazky", správne OP do „OP/OPDL"). Ak je zadanie naozaj správne, potvrď „Odoslať aj tak".`
	);
}

/** Jeden zdroj pravdy pre hlášku bloku vo všetkých moduloch — vyberie správnu podľa `reason`. */
export function blokHlaska(outcome: OdpisOutcome, zak: string, op: string): string {
	if (outcome.reason === 'unknown-kod') return blokKodyHlaska(outcome.chybajuceKody ?? []);
	if (outcome.reason === 'prehodene-polia') return blokPrehodeneHlaska(zak, op);
	return blokLedgerHlaska(zak, op, outcome.ledgerImportedAt);
}

/**
 * (#300) „Odoslať aj tak" mapovanie: skryté pole(-a) `override` z re-submit formulára → override
 * flagy pre `writeOdpis`. `unknown-kod` ⇒ `overrideKody`, `ledger-duplicate` ⇒ `overrideLedger`,
 * `prehodene-polia` ⇒ `overridePrehodene` (#307). Číta VŠETKY `override` hodnoty (`getAll`) — jeden
 * doklad môže naraz naraziť na VIAC blokov (Money kód, čo snapshot ešte nemá, + identický obsah po
 * „Uvoľniť", + prehodené polia); vtedy ďalšie „Odoslať aj tak" nesie VŠETKY hodnoty, takže sa
 * prekonajú NARAZ (bez donekonečna sa striedajúceho ping-pongu, #300 review 🟡). Bežný (prvý) submit
 * nemá `override` pole → všetky flagy false = žiadny bypass.
 */
export function overrideOpts(form: FormData): {
	overrideKody?: boolean;
	overrideLedger?: boolean;
	overridePrehodene?: boolean;
} {
	const o = form.getAll('override').map(String);
	return {
		overrideKody: o.includes('unknown-kod'),
		overrideLedger: o.includes('ledger-duplicate'),
		overridePrehodene: o.includes('prehodene-polia')
	};
}

/**
 * (#300) Surové string polia POST-u pre re-render „Odoslať aj tak". Zachová operátorove ručné úpravy
 * množstiev (`qty_*`), vstup AJ už potvrdené `override` hodnoty (aby sa pri druhom bloku nestratil
 * prvý override — #300 review 🟡; `OdpisBlok` dopĺňa len chýbajúcu hodnotu). Re-submit tak postaví
 * IDENTICKÝ job (rovnaký content_hash → override mieri na správny tuple). `File` hodnoty sa vynechajú
 * (odpis formuláre sú čisto textové).
 */
export function rawFormEntries(form: FormData): [string, string][] {
	const out: [string, string][] = [];
	for (const [k, v] of form.entries()) {
		if (typeof v === 'string') out.push([k, v]);
	}
	return out;
}

/** Audit vedomého override chýbajúcich Money kódov (#295) — NIE tiché preskočenie: do `cfg_audit`
 *  sa zapíše, KTO poslal odpis napriek varovaniu a ktoré kódy Money nepozná. */
function auditOverrideKody(job: OdpisJob, problemy: KodProblem[]): void {
	const kody = problemy.map((p) => p.kod).join(', ');
	db.prepare('INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)').run(
		job.createdBy,
		'odpis',
		JSON.stringify([
			{
				pole: `Override chýbajúcich Money kódov (${kody}) — odpis ${job.modul} ${job.zak} OP${job.op} odoslaný napriek varovaniu`,
				stara: 0,
				nova: 1
			}
		])
	);
	log.warn('odpis: override chýbajúcich Money kódov', {
		modul: job.modul,
		zak: job.zak,
		op: job.op,
		kody
	});
}

/** Audit vedomého ledger override (#300) — operátor potvrdil „Odoslať aj tak" pri identickom
 *  obsahu, ktorý ledger blokoval (import v Money zmazal, ale klikol „Uvoľniť" namiesto „Povoliť
 *  rovnaký"). NIE tiché preskočenie: do `cfg_audit` sa zapíše, KTO povolil re-import. */
function auditOverrideLedger(job: OdpisJob): void {
	db.prepare('INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)').run(
		job.createdBy,
		'odpis',
		JSON.stringify([
			{
				pole: `Override ledgeru „Odoslať aj tak" — re-import identického obsahu ${job.modul} ${job.zak} OP${job.op} povolený (potvrdené zmazanie importu v Money)`,
				stara: 0,
				nova: 1
			}
		])
	);
	log.warn('odpis: override ledgeru „Odoslať aj tak"', {
		modul: job.modul,
		zak: job.zak,
		op: job.op
	});
}

/** Audit vedomého override PREHODENÝCH polí zak/op (#307) — operátor potvrdil „Odoslať aj tak" pri
 *  podozrení na zamenené číslo zákazky/objednávky. NIE tiché preskočenie: do `cfg_audit` sa zapíše,
 *  KTO poslal odpis napriek varovaniu. */
function auditOverridePrehodene(job: OdpisJob): void {
	db.prepare('INSERT INTO cfg_audit (username, sys_styl, zmeny) VALUES (?, ?, ?)').run(
		job.createdBy,
		'odpis',
		JSON.stringify([
			{
				pole: `Override prehodených polí zak/op — odpis ${job.modul} ${job.zak} OP${job.op} odoslaný napriek varovaniu (číslo zákazky/objednávky pravdepodobne zamenené)`,
				stara: 0,
				nova: 1
			}
		])
	);
	log.warn('odpis: override prehodených polí zak/op', {
		modul: job.modul,
		zak: job.zak,
		op: job.op
	});
}

export interface LedgerCounts {
	imports: number;
	overrides: number;
	lastImportedAt: string | undefined;
}

/**
 * Počítadlo APPEND-ONLY ledgeru `odpis_imported` (#294) pre daný per-order tuple + `content_hash`.
 * `writeOdpis` blokuje re-import, keď `imports > overrides` (identický obsah už raz importovaný a
 * nebol RE-autorizovaný). Kľúč NIKDY nie je globálny hash — dve rôzne zákazky smú mať rovnaký obsah.
 * Exportované aj pre `money-presun.ts` (#299 detekcia ručného presunu — idempotentný ledger append).
 */
export function ledgerCounts(
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
export async function writeOdpis(
	job: OdpisJob,
	opts: { overrideKody?: boolean; overrideLedger?: boolean; overridePrehodene?: boolean } = {}
): Promise<OdpisOutcome> {
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

	// (#307) Prehodené polia zak/op (zak obsahuje OP…, op obsahuje ZAK… — tvar ZAK2026499, verdikt §2
	// id=38/78). Pre live=1 to TVRDO BLOKUJE (rovnaká audited-override sémantika ako #295 unknown-kod) —
	// do Money by inak šiel doklad so zameneným číslom zákazky a objednávky. `overridePrehodene` =
	// vedomý, AUDITOVANÝ bypass (audit až v zápisovej transakcii nižšie — #300 review 🟡 dôvod: inak by
	// falošný audit vznikol aj keď to následne zablokoval ledger a nič sa neodoslalo). TEST/live=0
	// ostáva WARN-only (E2E aj testové toky sa nesmú rozbiť; do Money nič testovacie nejde). Blok je
	// PRVÝ (pred #295) — field-swap má operátor opraviť pri zdroji skôr než rieši kódy.
	let overridingPrehodene = false;
	if (detekujPrehodenePolia(zakNorm, opNorm)) {
		if (live === 1 && opts.overridePrehodene !== true) {
			log.warn('odpis blokovaný — prehodené polia zak/op (live, import so zameneným zak/op)', {
				modul: job.modul,
				zak: job.zak,
				op: job.op,
				zakNorm,
				opNorm
			});
			return {
				status: 'blocked',
				reason: 'prehodene-polia',
				live: true,
				target,
				filename
			};
		}
		overridingPrehodene = live === 1 && opts.overridePrehodene === true;
		log.warn('odpis: podozrenie na prehodené polia zak/op', {
			modul: job.modul,
			zak: job.zak,
			op: job.op,
			zakNorm,
			opNorm,
			live: isLive(),
			override: overridingPrehodene
		});
	}

	// (#295) PRE-export validácia kódov proti dennému Money snapshotu — LEN pre live=1 (do Money
	// reálne ide). Neznámy kód / kód bez skladovej karty ⇒ Money by ho ticho preskočil (Dominik:
	// „keď chýba profil, neodpíše VÔBEC" — celý doklad). `overrideKody` = vedomý, AUDITOVANÝ bypass
	// (napr. kód je správny a Money ho už má, len snapshot ešte nedobehol) — NIKDY tiché preskočenie.
	// (#300 review 🟡) override kódov sa AUDITUJE až v zápisovej transakcii (nie tu) — inak by vedomý
	// bypass zapísal falošný `cfg_audit` riadok „odoslaný napriek varovaniu" AJ keď ho následne
	// zablokoval ledger (`imports>overrides`) a REÁLNE sa nič neodoslalo. Preto tu len zaznamenáme
	// zámer + problémové kódy a audit spustíme atomicky so zápisom nižšie.
	let overridingKody = false;
	let kodProblemy: KodProblem[] = [];
	if (live === 1) {
		const val = validateOdpisKody(job.polozky);
		if (!val.ok) {
			if (opts.overrideKody === true) {
				overridingKody = true;
				kodProblemy = val.problemy;
			} else {
				log.warn('odpis blokovaný — Money nepozná kódy (import by doklad preskočil)', {
					modul: job.modul,
					zak: job.zak,
					op: job.op,
					kody: val.problemy.map((p) => p.kod)
				});
				return {
					status: 'blocked',
					reason: 'unknown-kod',
					live: true,
					target,
					filename,
					chybajuceKody: val.problemy
				};
			}
		}
	}

	// (#294) normalizovaný dedup precheck — OP260286 ≡ 260286 obíde RAW UNIQUE, tak dedup-ujeme na
	// normalizovaných stĺpcoch. RAW UNIQUE(modul,zak,op,live) nižšie kryje ATOMICKY len race
	// IDENTICKÉHO zápisu (rovnaké raw zak/op). Cross-spelling race (OP260286 vs 260286 súbežne) NEMÁ
	// DB constraint — kryje ho len to, že precheck→claim beží BEZ `await` v jednom synchrónnom bloku
	// (jeden proces, better-sqlite3 synchrónne). NEVKLADAJ `await` medzi tento precheck a INSERT
	// nižšie — otvoril by cross-spelling double-import okno.
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
	const ledgerWouldBlock = led.imports > led.overrides;
	if (ledgerWouldBlock && opts.overrideLedger !== true) {
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
	// (#300) TUPLE-based ledger override — operátor potvrdil „Odoslať aj tak" po tom, čo import
	// v Money NAOZAJ zmazal, ale klikol „Uvoľniť" (nie „Povoliť rovnaký"), takže už NEEXISTUJE
	// `odpis_log` riadok, na ktorý by sa dal zavolať `povolitReimport(id)`. Autorizujeme re-import
	// PRIAMO z normalizovaného tuple + `content_hash` job-u (nepotrebuje živý log riadok): v
	// zápisovej transakcii pribudne `kind='override'` ledger riadok (imports==overrides ⇒ prejde),
	// vedome + AUDITOVANE. One-shot: následný `import` riadok zdvihne imports späť nad overrides,
	// takže ďalší identický re-send je zas blokovaný (rovnaká sémantika ako `povolitReimport`).
	const overridingLedger = ledgerWouldBlock && opts.overrideLedger === true;

	let rowId: number | bigint;
	// (#294) id ledger 'import' riadku — zapíše sa ATOMICKY s claim-om (nižšie), pri zlyhaní
	// zápisu súboru (kompenzácia) sa podľa neho zruší.
	let ledgerImportId: number | bigint = 0;
	try {
		// odpis_log + odpis_polozky + ledger 'import' v JEDNEJ transakcii (#154 fáza 1 + #294):
		// položky sú 1:1 s tým, čo odišlo do Money a musia vzniknúť/zaniknúť SPOLU s dedup
		// záznamom. UNIQUE (dedup) aj FK zlyhanie automaticky rollbackne CELÚ transakciu.
		const insLog = db.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, zak_norm, op_norm)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		);
		const insPolozka = db.prepare(
			`INSERT INTO odpis_polozky (odpis_log_id, kod, nazov, qty, mj) VALUES (?, ?, ?, ?, ?)`
		);
		const insImported = db.prepare(
			`INSERT INTO odpis_imported (modul, zak_norm, op_norm, live, content_hash, kind, filename, actor)
			 VALUES (?, ?, ?, ?, ?, 'import', ?, ?)`
		);
		const insOverride = db.prepare(
			`INSERT INTO odpis_imported (modul, zak_norm, op_norm, live, content_hash, kind, filename, actor, reason)
			 VALUES (?, ?, ?, ?, ?, 'override', ?, ?, ?)`
		);
		rowId = db.transaction(() => {
			// (#300) override MUSÍ predchádzať `import` riadku v tej istej transakcii, aby počítadlo
			// (imports vs overrides) ostalo konzistentné aj keby zápis súboru neskôr zlyhal
			// (kompenzácia maže len `import` riadok, override authorization prežije → retry funguje).
			if (overridingLedger) {
				insOverride.run(
					job.modul,
					zakNorm,
					opNorm,
					live,
					ledgerHash,
					filename,
					job.createdBy,
					'override z modulu — „Odoslať aj tak" po zmazaní importu v Money (ledger-duplicate)'
				);
				auditOverrideLedger(job);
			}
			// (#300 review 🟡) audit override kódov AŽ TU — atomicky so zápisom, takže sa zapíše LEN keď
			// sa odpis reálne odoslal (nie keď ho medzitým zablokoval ledger a nič neodišlo).
			if (overridingKody) auditOverrideKody(job, kodProblemy);
			// (#307) rovnaký atomický audit pre override prehodených polí zak/op.
			if (overridingPrehodene) auditOverridePrehodene(job);
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
			// (#294) ledger 'import' ATOMICKY s claim-om — zapíše sa PRED zápisom súboru, takže ani
			// reštart/pád v okne medzi `rename` a zápisom ledgeru nenechá REÁLNY Money import
			// nezaznamenaný (inak by neskoršie uvoľnenie + identický re-send obišlo ledger →
			// dvojitý import, presne to, čo ledger stráži). Pri ZLYHANÍ zápisu súboru (kompenzácia
			// nižšie) sa TENTO riadok zmaže — import sa nikdy nevykonal, čo NIE JE porušenie
			// append-only (append-only chráni záznam REÁLNEHO importu, nie zrušenú claim-nu).
			ledgerImportId = insImported.run(
				job.modul,
				zakNorm,
				opNorm,
				live,
				ledgerHash,
				filename,
				job.createdBy
			).lastInsertRowid;
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
		// kompenzácia: súbor sa nezapísal → uvoľni dedup kľúč AJ zruš ledger 'import' riadok (import
		// sa NIKDY nevykonal, takže jeho zmazanie NIE je porušenie append-only — append-only chráni
		// záznam REÁLNEHO importu), nech sa dá poslať znova. Obe v jednej transakcii.
		db.transaction(() => {
			db.prepare('DELETE FROM odpis_log WHERE id = ?').run(rowId);
			db.prepare('DELETE FROM odpis_imported WHERE id = ?').run(ledgerImportId);
		})();
		log.error('odpis kompenzácia — zápis súboru zlyhal, dedup kľúč + ledger claim uvoľnené', {
			modul: job.modul,
			zak: job.zak,
			op: job.op,
			live: isLive(),
			target,
			error: e
		});
		throw e;
	}

	// #340: PO úspešnom + durable zápise odpisu upozorni observera (fire-and-forget push
	// interného zoznamu materiálu zákazky do Odoo). Sync-guard: ani synchrónny throw
	// observera nesmie zhodiť už-zapísaný odpis.
	try {
		onOdpisWritten?.(job.zak, job.op);
	} catch (e) {
		log.error('odpis-written hook hodil (ignorované — odpis je zapísaný)', {
			zak: job.zak,
			op: job.op,
			error: e
		});
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
	/** (#299) čas, kedy appka detekovala RUČNÝ presun parkovaného odpisu zo staging „NA ODPIS" do
	 *  Money importu (`datetime('now')`); NULL = nepresunutý / neparkovaný. */
	presunute_at: string | null;
}

export function listOdpisy(limit = 200): OdpisLogRow[] {
	return db
		.prepare(
			'SELECT id, modul, zak, op, zakaznik, caka, live, filename, detail, created_by, created_at, presunute_at FROM odpis_log ORDER BY id DESC LIMIT ?'
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
