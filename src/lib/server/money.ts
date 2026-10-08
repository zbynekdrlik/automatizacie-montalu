// Zápis odpisu do Money importu — GENERICKÁ vrstva pre všetky moduly
// (zasklenia, bazén, pergola, clip, fix). Money auto-importuje .xlsx z /data/dlv-import
// (LEN root, nie rekurzívne — NA ODPIS/* podpriečinky sú odkladacie; overené
// produkčnou prevádzkou), archívuje do DONE a zdroj zmaže. TEST režim píše
// do ODPIS EXPORT — do Money NIKDY nejde nič testovacie.
//
// Poradie proti dvojitému importu:
// 1. NAJPRV sa atomicky zaberie dedup kľúč (INSERT, UNIQUE modul+zak+op+live+poradie).
// 2. Až POTOM sa zapíše súbor (tmp bez prípony + rename = atomické, watcher
//    tmp nevidí).
// 3. Ak zápis súboru zlyhá, dedup záznam sa zmaže (kompenzácia).
//
// #608 DOROBENIE: druhý a ďalší odpis tej istej zákazky/OP v tom istom module (zlé zameranie, posuv
// sa vyrába znova) je povolený LEN vedome — blok `uz-odpisane` + audited „Odoslať ako dorobenie"
// s tokenom poradia, ktoré operátor videl (`dorobeniePo`). Náhodný duplikát (dvojklik, refresh) aj
// opätovné odoslanie toho istého potvrdenia ostáva zablokované; prvý odpis ostáva v histórii.
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { db } from './db';
import { logger } from './log';
import { validateOdpisKody, type KodProblem } from './ceny';
import {
	auditOverrideKody,
	auditOverrideLedger,
	auditOverridePrehodene,
	auditOverrideDorobenie
} from './money-override-audit';
import { formatDatumCasSk, sqliteUtcToIso } from '../datum';
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
	/** podpriečinok v NA ODPIS pre čaká-režim (Robust/Slide/Bazen/Pergola/Clip/Fix) */
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
	 *  objednávky; blokuje LEN pre live=1 (#307); `uz-odpisane` = tá istá zákazka/OP už má v tomto
	 *  module odoslaný odpis a operátor nepotvrdil „Odoslať ako dorobenie" (alebo potvrdil voči
	 *  zastaranému stavu — refresh výsledku, dvojklik) — live AJ test, dedup platil vždy pre oba (#608). */
	reason?: 'ledger-duplicate' | 'unknown-kod' | 'prehodene-polia' | 'uz-odpisane';
	live: boolean;
	target: string;
	filename: string;
	/** `duplicate`: kedy vznikol kolidujúci záznam; `uz-odpisane`: kedy bol POSLEDNÝ existujúci odpis
	 *  tejto zákazky/OP v module (SQLite UTC `datetime('now')`). */
	duplicateCreatedAt?: string;
	/** len `reason==='uz-odpisane'`: kto poslal posledný existujúci odpis (#608) */
	duplicateCreatedBy?: string;
	/** len `reason==='uz-odpisane'`: najvyššie poradie existujúcich odpisov tejto zákazky/OP v module =
	 *  token, voči ktorému operátor potvrdzuje dorobenie (`OdpisOverride.dorobeniePo`), #608 */
	poradieMax?: number;
	/** len `reason==='uz-odpisane'`: koľko odpisov tejto zákazky/OP v module už existuje (#608) */
	pocetOdpisov?: number;
	/** len `status==='written'`: poradie zapísaného odpisu (1 = prvý, > 1 = dorobenie č. N), #608 */
	poradie?: number;
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

/** Hláška pre operátora, keď tá istá zákazka/OP už má v module odoslaný odpis (#608,
 *  `reason==='uz-odpisane'`): kedy (Europe/Bratislava) + kto, a vedomá cesta „Odoslať ako dorobenie". */
function blokUzOdpisaneHlaska(outcome: OdpisOutcome, zak: string, op: string): string {
	const pocet = outcome.pocetOdpisov ?? 1;
	const kedy = outcome.duplicateCreatedAt
		? ` ${formatDatumCasSk(sqliteUtcToIso(outcome.duplicateCreatedAt))}`
		: '';
	const kto = outcome.duplicateCreatedBy ? ` (${outcome.duplicateCreatedBy})` : '';
	const dalsie = (outcome.poradieMax ?? pocet) + 1;
	return (
		`Zákazka ${zak} (OP ${op}) už bola odpísaná` +
		(pocet > 1 ? ` ${pocet}× — naposledy` : '') +
		`${kedy}${kto}. Znova ju bez potvrdenia NEposielam (poistka proti dvojitému odoslaniu — ` +
		`dvojklik, obnovenie stránky). Ak ide o DOROBENIE (napr. zlé zameranie a posuv sa vyrába znova), ` +
		`potvrď to tlačidlom „Odoslať ako dorobenie" nižšie — prvý odpis ostane v histórii a do Money ` +
		`pôjde ďalší doklad (dorobenie č. ${dalsie}).`
	);
}

/** Jeden zdroj pravdy pre hlášku bloku vo všetkých moduloch — vyberie správnu podľa `reason`. */
export function blokHlaska(outcome: OdpisOutcome, zak: string, op: string): string {
	if (outcome.reason === 'unknown-kod') return blokKodyHlaska(outcome.chybajuceKody ?? []);
	if (outcome.reason === 'prehodene-polia') return blokPrehodeneHlaska(zak, op);
	if (outcome.reason === 'uz-odpisane') return blokUzOdpisaneHlaska(outcome, zak, op);
	return blokLedgerHlaska(zak, op, outcome.ledgerImportedAt);
}

/** Vedomé, AUDITOVANÉ prekonanie blokov `writeOdpis` (re-submit z `OdpisBlok`). */
export interface OdpisOverride {
	overrideKody?: boolean;
	overrideLedger?: boolean;
	overridePrehodene?: boolean;
	/** (#608) „Odoslať ako dorobenie" — prijme sa LEN spolu s `dorobeniePo` = aktuálne najvyššie
	 *  poradie odpisov tejto zákazky/OP v module (token zo zobrazeného bloku). */
	overrideDorobenie?: boolean;
	/** (#608) poradie, voči ktorému operátor potvrdil dorobenie; iné aktuálne max poradie (refresh
	 *  výsledku, dvojklik, súbežné dorobenie) = potvrdenie je zastarané → znova blok. */
	dorobeniePo?: number;
}

/**
 * (#300) „Odoslať aj tak" mapovanie: skryté pole(-a) `override` z re-submit formulára → override
 * flagy pre `writeOdpis`. `unknown-kod` ⇒ `overrideKody`, `ledger-duplicate` ⇒ `overrideLedger`,
 * `prehodene-polia` ⇒ `overridePrehodene` (#307), `uz-odpisane` ⇒ `overrideDorobenie` + token
 * `dorobenie_po` (#608). Číta VŠETKY `override` hodnoty (`getAll`) — jeden
 * doklad môže naraz naraziť na VIAC blokov (Money kód, čo snapshot ešte nemá, + identický obsah po
 * „Uvoľniť", + prehodené polia); vtedy ďalšie „Odoslať aj tak" nesie VŠETKY hodnoty, takže sa
 * prekonajú NARAZ (bez donekonečna sa striedajúceho ping-pongu, #300 review 🟡). Bežný (prvý) submit
 * nemá `override` pole → všetky flagy false = žiadny bypass.
 */
export function overrideOpts(form: FormData): OdpisOverride {
	const o = form.getAll('override').map(String);
	const po = Number(form.get('dorobenie_po'));
	return {
		overrideKody: o.includes('unknown-kod'),
		overrideLedger: o.includes('ledger-duplicate'),
		overridePrehodene: o.includes('prehodene-polia'),
		overrideDorobenie: o.includes('uz-odpisane'),
		dorobeniePo: Number.isInteger(po) && po >= 1 ? po : undefined
	};
}

/**
 * (#300) Surové string polia POST-u pre re-render „Odoslať aj tak". Zachová operátorove ručné úpravy
 * množstiev (`qty_*`), vstup AJ už potvrdené `override` hodnoty (aby sa pri druhom bloku nestratil
 * prvý override — #300 review 🟡; `OdpisBlok` dopĺňa len chýbajúcu hodnotu). Re-submit tak postaví
 * IDENTICKÝ job (rovnaký content_hash → override mieri na správny tuple). `File` hodnoty sa vynechajú
 * (odpis formuláre sú čisto textové).
 * (#608) Pri bloku `uz-odpisane` sa pripojí token `dorobenie_po` = AKTUÁLNE najvyššie poradie (starý
 * token z predošlého potvrdenia sa nahradí) — „Odoslať ako dorobenie" tak potvrdzuje presne stav,
 * ktorý operátor vidí. `outcome` je povinný, aby žiadny modul nezabudol token prevliecť.
 */
export function rawFormEntries(
	form: FormData,
	outcome: Pick<OdpisOutcome, 'reason' | 'poradieMax'>
): [string, string][] {
	const token = outcome.reason === 'uz-odpisane' && outcome.poradieMax !== undefined;
	const out: [string, string][] = [];
	for (const [k, v] of form.entries()) {
		if (typeof v !== 'string') continue;
		if (token && k === 'dorobenie_po') continue;
		out.push([k, v]);
	}
	if (token) out.push(['dorobenie_po', String(outcome.poradieMax)]);
	return out;
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
 *
 * #608: DOROBENIE (poradie > 1) dostane marker „dorobenie-N" pred hash — identický obsah tej istej
 * zákazky by inak mal ROVNAKÝ názov a prepísal by prvý doklad, ktorý Money ešte nespracoval (alebo
 * parkovaný v NA ODPIS). Prvý odpis (poradie 1) má názov bez zmeny.
 */
export function filenameFor(
	job: Pick<OdpisJob, 'zak' | 'op' | 'zakaznik' | 'polozky' | 'rezervacia'>,
	poradie = 1
): string {
	const hash = contentHash(`${job.zak}|OP${job.op}`, job.polozky);
	// #221: rezervačný odpis dostane marker „REZ" pred hash — v Money import priečinku
	// je hneď vidno, že ide o rezerváciu, a #227 (aktualizácia na reálne čísla) ju
	// vie nájsť/napárovať podľa ZAK + (hash nesie OP). Bežný odpis marker nemá.
	const rez = job.rezervacia ? 'REZ ' : '';
	const dorobenie = poradie > 1 ? `dorobenie-${poradie} ` : '';
	return `${safe(job.zak)} - ${safe(job.zakaznik)} ${rez}${dorobenie}[${hash}].xlsx`;
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
 * Zapíše odpis (alebo vráti duplicate / blocked). Vyhadzuje výnimku len pri zlyhaní
 * zápisu súboru — vtedy je dedup záznam už odstránený a odoslanie sa dá
 * bezpečne zopakovať.
 */
export async function writeOdpis(job: OdpisJob, opts: OdpisOverride = {}): Promise<OdpisOutcome> {
	const live = isLive() ? 1 : 0;
	const zakNorm = normZak(job.zak);
	const opNorm = normOp(job.op);
	// content_hash pre ledger AJ pre odpis_log — normalizovaný zak (planHash guard modulov je
	// oddelený, počíta si vlastný hash z RAW zak; toto je iba dedup/ledger kľúč, žiadny konzument
	// logiky ho z odpis_log nečíta — overené grepom).
	const ledgerHash = contentHash(zakNorm, job.polozky);
	const dir = targetDirFor(job.cakaSubdir, job.caka);
	// (#608) názov/cieľ sa po určení poradia (dorobenie) prepočíta nižšie — bloky pred dedupom vracajú
	// názov prvého odpisu (informatívne, nič sa nezapisuje)
	let filename = filenameFor(job);
	let target = path.join(dir, filename);

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
		// #599: validácia je async (Odoo `product.product`, fallback snapshot) — await je PRED
		// synchrónnym blokom dedup precheck→claim nižšie, takže jeho atomicita ostáva zachovaná.
		const val = await validateOdpisKody(job.polozky);
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

	// (#380) CROSS-MODUL identický-obsah dedup — FIX z CADu (modul='fix') reusuje presne pergola
	// katalóg, takže identický CAD nárez dá identický content_hash (a názov súboru) pod modul='fix'
	// aj modul='pergola'. Dedup aj ledger sú kľúčované na modul, takže bez tejto poistky by operátor
	// obišiel dedup presunutím identického nárezu z /pergola (Duplikát) do /fix/cad → dvojitý odpis
	// rovnakého materiálu + prepis súboru v import priečinku. RÔZNY obsah (pergola + fix na tej istej
	// ZAK+OP) má RÔZNY hash → NEblokuje sa (legitímna koexistencia). Kľúč = (live,zak,op,hash) bez modulu.
	// (#608) Kontroluje sa PRED blokom `uz-odpisane` a je TVRDÝ aj pri potvrdenom dorobení — dorobenie
	// je per modul, presun toho istého nárezu do iného modulu sa ním „prepašovať" nedá (a operátorovi
	// sa neponúkne dorobenie, ktoré by aj tak skončilo týmto duplikátom).
	const crossDup = db
		.prepare(
			'SELECT modul, created_at FROM odpis_log WHERE live = ? AND zak_norm = ? AND op_norm = ? AND content_hash = ? AND modul != ?'
		)
		.get(live, zakNorm, opNorm, ledgerHash, job.modul) as
		{ modul: string; created_at: string } | undefined;
	if (crossDup) {
		log.warn('odpis duplikát — identický obsah už zapísaný pod iným modulom, nič sa nezapisuje', {
			modul: job.modul,
			existujuciModul: crossDup.modul,
			zak: job.zak,
			op: job.op,
			zakNorm,
			opNorm,
			live: isLive(),
			existingCreatedAt: crossDup.created_at
		});
		return {
			status: 'duplicate',
			live: isLive(),
			target,
			filename,
			duplicateCreatedAt: crossDup.created_at
		};
	}

	// (#294) normalizovaný dedup precheck — OP260286 ≡ 260286 obíde RAW UNIQUE, tak dedup-ujeme na
	// normalizovaných stĺpcoch. RAW UNIQUE(modul,zak,op,live,poradie) nižšie kryje ATOMICKY len race
	// IDENTICKÉHO zápisu (rovnaké raw zak/op). Cross-spelling race (OP260286 vs 260286 súbežne) NEMÁ
	// DB constraint — kryje ho len to, že precheck→claim beží BEZ `await` v jednom synchrónnom bloku
	// (jeden proces, better-sqlite3 synchrónne). NEVKLADAJ `await` medzi tento precheck a INSERT
	// nižšie — otvoril by cross-spelling double-import okno (aj súbežné dorobenie s rovnakým tokenom).
	// (#608) Množina existujúcich odpisov = normalizovaný kľúč ∪ RAW kľúč (zak, op) — RAW vetva je
	// presne kľúč DB UNIQUE, takže dedup nerozširuje; zachytí legacy riadky spred v27 (`op_norm` je
	// tam RAW kópia, napr. '01' vs normOp 'OP01'), ktoré by inak skončili až na UNIQUE poistke ako
	// dead-end `duplicate` bez ponuky dorobenia. Zápisová sémantika `zak_norm`/`op_norm` sa nemení.
	const kluc =
		'modul = ? AND live = ? AND ((zak_norm = ? AND op_norm = ?) OR (zak = ? AND op = ?))';
	const klucArgs = [job.modul, live, zakNorm, opNorm, job.zak, job.op];
	const existujuce = db
		.prepare(
			`SELECT COUNT(*) AS pocet, MAX(poradie) AS maxPoradie,
			        MAX(CASE WHEN json_valid(detail)
			                 THEN (CASE WHEN json_extract(detail, '$.rezervacia') = 1 THEN 1 ELSE 0 END)
			                 ELSE 0 END) AS rezervacia
			 FROM odpis_log WHERE ${kluc}`
		)
		.get(...klucArgs) as {
		pocet: number;
		maxPoradie: number | null;
		rezervacia: number | null;
	};
	let poradie = 1;
	let overridingDorobenie = false;
	if (existujuce.pocet > 0) {
		const posledny = db
			.prepare(
				`SELECT created_at, created_by FROM odpis_log WHERE ${kluc} ORDER BY id DESC LIMIT 1`
			)
			.get(...klucArgs) as { created_at: string; created_by: string };
		const maxPoradie = existujuce.maxPoradie ?? 1;
		if (job.rezervacia === true || existujuce.rezervacia === 1) {
			// (#221) pergola rezervácia a CAD odpis tej istej ZAK+OP kolidujú ZÁMERNE (rezervácia už
			// materiál odpísala — CAD odpis by ho odpísal druhýkrát). Ostáva TVRDÝ duplikát bez ponuky
			// dorobenia (#608 sa rezervácie netýka; oprava = „Uvoľniť" v histórii).
			log.warn('odpis duplikát — rezervácia ⇄ odpis tej istej zákazky, nič sa nezapisuje', {
				modul: job.modul,
				zak: job.zak,
				op: job.op,
				zakNorm,
				opNorm,
				live: isLive(),
				novyJeRezervacia: job.rezervacia === true,
				existingCreatedAt: posledny.created_at
			});
			return {
				status: 'duplicate',
				live: isLive(),
				target,
				filename,
				duplicateCreatedAt: posledny.created_at
			};
		}
		// (#608) DOROBENIE len VEDOME: potvrdenie „Odoslať ako dorobenie" platí LEN voči poradiu, ktoré
		// operátor videl (`dorobeniePo` = aktuálne max). Bez potvrdenia (náhodný dvojklik / refresh) ALEBO
		// so zastaraným potvrdením (refresh výsledku dorobenia, dvojklik na dorobenie, súbežné dorobenie)
		// → blok PRED akýmkoľvek DB/file zápisom. Platí pre live AJ test (dedup platil vždy pre oba).
		if (opts.overrideDorobenie !== true || opts.dorobeniePo !== maxPoradie) {
			log.warn('odpis blokovaný — zákazka/OP už odpísaná, dorobenie len vedome (#608)', {
				modul: job.modul,
				zak: job.zak,
				op: job.op,
				zakNorm,
				opNorm,
				live: isLive(),
				pocetOdpisov: existujuce.pocet,
				maxPoradie,
				potvrdenie: opts.overrideDorobenie === true,
				dorobeniePo: opts.dorobeniePo,
				existingCreatedAt: posledny.created_at
			});
			return {
				status: 'blocked',
				reason: 'uz-odpisane',
				live: isLive(),
				target,
				filename,
				duplicateCreatedAt: posledny.created_at,
				duplicateCreatedBy: posledny.created_by,
				poradieMax: maxPoradie,
				pocetOdpisov: existujuce.pocet
			};
		}
		poradie = maxPoradie + 1;
		overridingDorobenie = true;
		// vlastný súbor dorobenia — identický obsah by inak prepísal prvý (ešte nespracovaný) doklad
		filename = filenameFor(job, poradie);
		target = path.join(dir, filename);
	}

	// (#294) APPEND-ONLY ledger safety-net — identický obsah tej istej zákazky (per-order tuple +
	// content_hash) už bol importovaný do Money a nebol RE-autorizovaný override-om (`povolitReimport`).
	// Toto je poistka, ktorú „Uvoľniť" NEZMAŽE: releaseOdpis maže len `odpis_log`, ledger ostáva.
	// (#608) Vedomé dorobenie ju prekoná TÝM ISTÝM potvrdením — identický obsah je typické dorobenie
	// (ten istý posuv sa vyrába znova): jedno kliknutie, nie dva bloky za sebou. Dorobenie bez
	// existujúceho riadku (napr. medzitým „Uvoľniť") sa NEuplatní (`overridingDorobenie` je false).
	const led = ledgerCounts(job.modul, zakNorm, opNorm, live, ledgerHash);
	const ledgerWouldBlock = led.imports > led.overrides;
	if (ledgerWouldBlock && opts.overrideLedger !== true && !overridingDorobenie) {
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
	const overridingLedger =
		ledgerWouldBlock && (opts.overrideLedger === true || overridingDorobenie);

	let rowId: number | bigint;
	// (#294) id ledger 'import' riadku — zapíše sa ATOMICKY s claim-om (nižšie), pri zlyhaní
	// zápisu súboru (kompenzácia) sa podľa neho zruší.
	let ledgerImportId: number | bigint = 0;
	try {
		// odpis_log + odpis_polozky + ledger 'import' v JEDNEJ transakcii (#154 fáza 1 + #294):
		// položky sú 1:1 s tým, čo odišlo do Money a musia vzniknúť/zaniknúť SPOLU s dedup
		// záznamom. UNIQUE (dedup) aj FK zlyhanie automaticky rollbackne CELÚ transakciu.
		const insLog = db.prepare(
			`INSERT INTO odpis_log (modul, zak, op, zakaznik, caka, live, target, filename, content_hash, detail, created_by, zak_norm, op_norm, poradie)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
					overridingDorobenie
						? `dorobenie č. ${poradie} — vedomý ďalší odpis tej istej zákazky (identický obsah, „Odoslať ako dorobenie")`
						: 'override z modulu — „Odoslať aj tak" po zmazaní importu v Money (ledger-duplicate)'
				);
				// dorobenie má VLASTNÝ audit (nižšie, spomenie aj prekonaný ledger) — jeden riadok, nie dva
				if (!overridingDorobenie) auditOverrideLedger(job);
			}
			// (#608) audit vedomého dorobenia AŽ TU — atomicky so zápisom (vzor #300 review 🟡).
			if (overridingDorobenie) auditOverrideDorobenie(job, poradie, overridingLedger);
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
				opNorm,
				poradie
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
		// (#608) precheck vyššie pokrýva normalizovaný AJ RAW kľúč v tom istom synchrónnom bloku, takže
		// v jednom procese sem UNIQUE nedorazí — vetva ostáva ako posledná poistka DB (žiadny tichý zápis).
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
		caka: job.caka,
		poradie
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
			poradie,
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

	return { status: 'written', live: isLive(), target, filename, poradie };
}

// História odpisov (listOdpisy / getOdpis / listOdpisPolozky) + „Uvoľniť" / „Povoliť rovnaký" →
// `money-historia.ts` (#608 large-file-split, pure move); re-export drží verejnú plochu nezmenenú.
export {
	listOdpisy,
	releaseOdpis,
	povolitReimport,
	getOdpis,
	listOdpisPolozky,
	type OdpisLogRow
} from './money-historia';
