// (#299) Detekcia RUČNÉHO presunu parkovaného (`caka=1`) LIVE odpisu zo staging „NA ODPIS" do
// ostrého Money import dir. Extrahované z `money.ts` (large-file-split, aby `money.ts` zostal pod
// 1000-riadkovým stropom). Importuje `ledgerCounts` z `money.ts` — JEDNOSMERNE (money.ts sem
// NEimportuje), takže žiadny cyklický import (vzor `compute-*` vrstvenia, large-file-split rule).
//
// `caka=1` súbor appka zapísala do `NA ODPIS/<subdir>`; Money ho NEIMPORTUJE, kým ho ČLOVEK ručne
// nepresunie do rootu `dlv-import` — krok ÚPLNE MIMO appky. `caka` je po inserte NEMENNÉ, takže bez
// tejto detekcie by presunutý odpis ostal navždy „parkovaný" (#308 readback ho vylučuje, #294 ledger
// nemá signál o presune → double-import cesta „D" verdiktu #294).
//
// (#315) ASYNC + TVRDÝ ROZPOČET. Na PRODE `target` cesty ležia na CIFS/SMB share cez WireGuard
// (`//192.168.1.200/...`, soft, actimeo=1) — SYNCHRÓNNY `fs.statSync` tam trval 0,7–8,8 s/súbor a
// blokoval event loop na desiatky sekúnd (aj /health zamrzol, celá appka „stuhla"). Preto je celá
// detekcia async cez `fs.promises` s wall-clock rozpočtom (`Promise.race` proti zvyšku rozpočtu):
// pri prekročení sa detekcia ČESTNE preskočí (riadky ostávajú parkované, WARN log) a stránka sa VŽDY
// načíta. Aby na visiacom mounte NEBEŽAL viac než 1 libuv threadpool worker z tohto kódu, beží
// SEKVENČNE (max 1 fs op naraz) a je len JEDNA in-flight detekcia v procese (`detectBusy`) — a gate
// sa otvorí až keď VŠETKY fs ops reálne doznejú (aj tie, ktoré `race` na timeoute opustil).
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db';
import { logger } from './log';
import { ledgerCounts } from './money';

// forenzný sub-modul `money:presun` → #297 money-audit sink (prežije redeploy), distinktne grepnuteľné.
const log = logger('money').child('presun');

// Celkový wall-clock rozpočet na FS dotazy JEDNÉHO behu detekcie. Prekročenie = detekcia sa preskočí
// (riadky ostávajú parkované), NIKDY sa neblokuje event loop ani nefalošuje presun. Prepínateľné env.
const BUDGET_MS = Number(process.env.PRESUN_DETECT_BUDGET_MS) || 2500;

// Jedna in-flight detekcia v procese: na visiacom mounte drží orphan `readdir`/`stat` (opustený na
// timeoute) libuv threadpool vlákno aj po návrate — súbežné /odpisy loady by inak hromadili visiace
// workery. `detectBusy` sa uvoľní až keď VŠETKY fs ops bežiacej detekcie doznejú (Promise.allSettled).
let detectBusy = false;
let detectBusySince = 0; // Date.now() keď sa gate zavrel — pre max-hold wedge detekciu (#315)
let detectGen = 0; // generácia detekcie — neskoro doznený orphan z force-reopnutej gen nezhodí novšiu gate
// Ak orphan fs op NIKDY nedoznie (hard mount / kernel wedge — PROD je `soft`, tam sa ops vždy dokončia),
// gate by ostal navždy zavretý a detekcia ticho vypnutá. Po tomto max-holde ju force-reopneme + ERROR log.
const MAX_HOLD_MS = Number(process.env.PRESUN_DETECT_MAX_HOLD_MS) || 60_000;

export interface ManualMoveDetected {
	id: number;
	modul: string;
	zak: string;
	op: string;
	filename: string;
}

/** Injektovateľné závislosti (test) — default reálne `fs.promises` + `Date.now`. */
export interface DetectDeps {
	readdir?: (dir: string) => Promise<string[]>;
	stat?: (p: string) => Promise<unknown>;
	now?: () => number;
	budgetMs?: number;
	maxHoldMs?: number;
}

interface ParkedRow {
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
}

const TIMED_OUT = Symbol('timed-out');

/**
 * `p` vs rozpočet `ms`: vráti hodnotu `p`, alebo `TIMED_OUT` keď `p` nestihne. `p` sa NIKDY neruší
 * (nedá sa) — ostáva v `bgOps` a gate ho počká, aby sa nehromadili visiace workery. `p` reject
 * PREPADNE (napr. ENOENT pri stat) — volajúci ho chytá.
 */
function raceBudget<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<typeof TIMED_OUT>((res) => {
		timer = setTimeout(() => res(TIMED_OUT), Math.max(0, ms));
	});
	return Promise.race([p, timeout]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

/**
 * Diff staging dir ↔ `caka=1` riadky: riadok, ktorého uložený `target` súbor je PREČ (ale jeho
 * rodičovský dir STÁLE existuje — fail-safe proti dočasne odpojenému Samba share, inak by výpadok
 * mountu falošne označil VŠETKY parkované ako presunuté), sa považuje za ručne presunutý do Money.
 * Na detekcii (idempotentne, `presunute_at IS NULL` filter):
 *   1. `presunute_at = datetime('now')` → riadok VSTÚPI do #308 readback matchingu (reálny verdikt).
 *   2. Ledger (IDEMPOTENTNE): keď tuple+content EŠTE neblokuje (`imports <= overrides`), pridá
 *      `kind='import', reason=manuálny presun` riadok do `odpis_imported`.
 *   3. Forenzný money-audit log (#297, prežije redeploy).
 *
 * (#315) READ-ONLY na staging cez `fs.promises` (nič tam nemaže/nepíše/nepresúva). Postup:
 *   - `readdir` per unikátny adresár = súčasne kontrola DOSTUPNOSTI dir (úspech) aj lacná „prítomný?"
 *     množina (bez per-file statu). Normalizačne odolná (raw + NFC + NFD) → normalizačný/`case`
 *     rozdiel smie spôsobiť len bezpečný MISS, nikdy falošný mark.
 *   - Kandidáta, ktorého `readdir` NENAŠIEL, POTVRDÍME exact-path `stat` (autoritatívny ENOENT — OS
 *     rieši case aj normalizáciu). MARK LEN na čistý ENOENT; timeout/iná chyba → preskoč (parkované).
 * Vracia zoznam NOVO detekovaných presunov. `writeOdpis` (Money write cesta) sa NEDOTÝKA.
 */
export async function detectManualStagingMoves(
	deps: DetectDeps = {}
): Promise<ManualMoveDetected[]> {
	const now = deps.now ?? (() => Date.now());
	const maxHoldMs = deps.maxHoldMs ?? MAX_HOLD_MS;
	if (detectBusy) {
		if (now() - detectBusySince <= maxHoldMs) {
			log.warn('detekcia presunu už beží (pomalý mount?) — súbežné volanie preskočené (#315)');
			return [];
		}
		// gate držaný dlhšie než max-hold → mount pravdepodobne VISÍ (hard mount / kernel wedge). Na PROD
		// `soft` mounte sa každá fs op dokončí v sekundách, takže dlhý hold = wedge. Nahlás HLUČNE (ERROR)
		// a force-reopen — inak by orphan op, ktorý sa NIKDY nevyrieši, ticho vypol detekciu do reštartu.
		log.error('detekcia presunu zaseknutá nad rozpočet — visiaci mount? force-reopen gate (#315)', {
			drzanaMs: now() - detectBusySince,
			maxHoldMs
		});
	}
	detectBusy = true;
	detectBusySince = now();
	const gen = ++detectGen;
	const bgOps: Promise<unknown>[] = [];
	try {
		return await runDetect(deps, bgOps);
	} finally {
		// gate držíme, kým VŠETKY fs ops (aj orphan opustené `race`-om na timeoute) reálne doznejú — inak
		// by ďalší /odpisy load naštartoval druhú detekciu súbežne s visiacim libuv workerom. `gen` bráni
		// tomu, aby NESKORO doznený orphan z FORCE-REOPNUTEJ (wedged) generácie zhodil gate novšej.
		// allSettled NIKDY nehádže.
		void Promise.allSettled(bgOps).then(() => {
			if (detectGen === gen) detectBusy = false;
		});
	}
}

async function runDetect(
	deps: DetectDeps,
	bgOps: Promise<unknown>[]
): Promise<ManualMoveDetected[]> {
	const readdir = deps.readdir ?? ((d: string) => fs.promises.readdir(d));
	const statFn = deps.stat ?? ((p: string) => fs.promises.stat(p));
	const now = deps.now ?? (() => Date.now());
	const budgetMs = deps.budgetMs ?? BUDGET_MS;
	const deadline = now() + budgetMs;

	const rows = db
		.prepare(
			// `created_at <= now-10min`: RACE-guard. `writeOdpis` zaberie DB riadok (caka=1, target,
			// presunute_at NULL) ATOMICKY, ale súbor zapíše až PO `await buildXlsx` — v tom okne by
			// súbežný /odpisy load videl dir-existuje + target-chýba a označil čerstvo staged riadok ako
			// „presunutý" (trvalý false-positive). Človek nikdy nepresunie súbor do minút od staging.
			`SELECT id, modul, zak, op, live, target, filename, content_hash, zak_norm, op_norm
			 FROM odpis_log
			 WHERE live = 1 AND caka = 1 AND presunute_at IS NULL
			   AND created_at <= datetime('now', '-10 minutes')`
		)
		.all() as ParkedRow[];
	if (rows.length === 0) return [];

	// unikátne adresáre v poradí prvého výskytu (readdir raz na adresár, nie stat na súbor)
	const dirs: string[] = [];
	const seenDir = new Set<string>();
	for (const r of rows) {
		const d = path.dirname(r.target);
		if (!seenDir.has(d)) {
			seenDir.add(d);
			dirs.push(d);
		}
	}

	// 1) readdir per adresár = dostupnosť (úspech) + normalizačne odolná „prítomný?" množina
	const presentByDir = new Map<string, Set<string>>();
	let budgetHit = false;
	for (const d of dirs) {
		if (now() >= deadline) {
			budgetHit = true;
			break;
		}
		const op = readdir(d);
		bgOps.push(op);
		let names: string[];
		try {
			const res = await raceBudget(op, deadline - now());
			if (res === TIMED_OUT) {
				budgetHit = true;
				break;
			}
			names = res;
		} catch {
			// adresár nedostupný (odpojený mount / EACCES / …) → fail-safe: riadky ostanú parkované
			continue;
		}
		const present = new Set<string>();
		for (const n of names) {
			present.add(n);
			present.add(n.normalize('NFC'));
			present.add(n.normalize('NFD'));
		}
		presentByDir.set(d, present);
	}

	// 2) MARK len po POTVRDENÍ exact-path statom (autoritatívny ENOENT). Prítomné súbory stat nepotrebujú.
	const detected: ManualMoveDetected[] = [];
	const setPresunute = db.prepare(
		"UPDATE odpis_log SET presunute_at = datetime('now') WHERE id = ? AND presunute_at IS NULL"
	);
	const insManualMove = db.prepare(
		`INSERT INTO odpis_imported (modul, zak_norm, op_norm, live, content_hash, kind, filename, actor, reason)
		 VALUES (?, ?, ?, ?, ?, 'import', ?, ?, ?)`
	);
	for (const r of rows) {
		if (budgetHit) break;
		const present = presentByDir.get(path.dirname(r.target));
		if (!present) continue; // adresár preskočený/nedostupný → riadok ostáva parkovaný
		const base = path.basename(r.target);
		if (
			present.has(base) ||
			present.has(base.normalize('NFC')) ||
			present.has(base.normalize('NFD'))
		)
			continue; // súbor je v staging → reálne parkovaný, nepresunutý
		// readdir tvrdí „preč" → POTVRDÍME exact-path statom (nikdy nefalošuj presun na visiacom mounte)
		if (now() >= deadline) {
			budgetHit = true;
			break;
		}
		const op = statFn(r.target);
		bgOps.push(op);
		try {
			const res = await raceBudget(op, deadline - now());
			if (res === TIMED_OUT) {
				budgetHit = true;
				break;
			}
			continue; // stat prešiel → súbor existuje → NIE je presunutý
		} catch (e) {
			// LEN čistý ENOENT (dir dostupný, súbor naozaj nie je) = ručne presunutý. Timeout/EACCES/EIO/
			// stale handle NIE JE dôkaz presunu → preskoč, riadok ostáva parkovaný.
			if ((e as NodeJS.ErrnoException).code !== 'ENOENT') continue;
		}
		// súbor je preč. Ešte RAZ over, že RODIČOVSKÝ dir je STÁLE dostupný — `readdir` bol raz na začiatku
		// behu; keby strom medzitým zmizol (unmount do kontajnera / server-side zmazanie subdiru), ENOENT na
		// target by inak označil VŠETKY zvyšné kandidáty v jednom svepe (sub-ms ENOENT na zmiznutej lokálnej
		// ceste rozpočet nezastaví). Per-riadková re-kontrola dir tesne pred markom to okno zatvára (presne
		// ako pôvodný synchrónny kód, čo statoval dir pred KAŽDÝM target statom).
		if (now() >= deadline) {
			budgetHit = true;
			break;
		}
		const dirOp = statFn(path.dirname(r.target));
		bgOps.push(dirOp);
		try {
			const dres = await raceBudget(dirOp, deadline - now());
			if (dres === TIMED_OUT) {
				budgetHit = true;
				break;
			}
			// dir dostupný → target naozaj presunutý → MARK nižšie
		} catch {
			// rodičovský dir zmizol/nedostupný → strom zmizol, NIE dôkaz presunu → skip
			continue;
		}
		// súbor je preč a adresár je stále dostupný → ručne presunutý do Money importu.
		db.transaction(() => {
			setPresunute.run(r.id);
			// idempotentný ledger: len keď tuple+content EŠTE neblokuje appka-side re-send (imports<=overrides).
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

	if (budgetHit)
		log.warn('detekcia presunu prekročila rozpočet — časť riadkov ostáva parkovaná (#315)', {
			budgetMs,
			dirsCitane: presentByDir.size,
			dirsSpolu: dirs.length,
			oznacene: detected.length
		});
	return detected;
}
