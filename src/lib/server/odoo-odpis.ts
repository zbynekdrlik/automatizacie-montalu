// #5825: odpis materiálu → Odoo model `montalu.material.odpis` cez `/json/2 create_from_app`, paralelne
// s Money xlsx („aj-aj" cutover, epic #5808). Router (`ODOO_ODPIS_MODE=note|model|both`, default `note`
// = dnešné správanie) + durable APPEND-ONLY push (retry BEZ straty dát) + release wiring.
//
// TVRDÉ PODMIENKY:
//  - Odoo zlyhanie NIKDY neblokuje/nezhodí Money zápis (fire-and-forget; enqueue je synchrónny, sieťový
//    push odložený). Idempotencia je na strane Odoo (dedup na content_hash) → dvojitý send = žiaden dup.
//  - Odpis sa NIKDY nezahodí: žiaden poison-pill drop, žiaden časový strop; retry cez `next_attempt_at`
//    (exponenciálny backoff), `pending=0` len pri úspechu alebo PAYLOAD-permanentnej chybe (Fable
//    dizajn-konzult #5825).
//  - `!live` → push sa PRESKOČÍ (bráni tomu, aby non-live inštancia namierená na PROD Odoo mislinkla)
//    okrem `ODOO_ODPIS_ALLOW_NONLIVE=1` (shadow akceptácia).
//
// MONEY-NEUTRÁLNE: NEPÍŠE do `/data`, NEMENÍ dedup/`MONEY_LIVE`. Znovupoužíva PROVEN vzor
// `odoo-zakazka.ts` (per-key serializer, sweep) + `/json/2` klient `odoo-json2.ts` (#5824).
import { logger } from './log';
import { queueZakazkaPush } from './odoo-zakazka';
import { json2Config, odooJson2, OdooJson2Error, type Json2Value } from './odoo-json2';
import type { OdpisWrittenEvent, OdpisReleasedEvent } from './money';
import {
	enqueueOdpisPush,
	markOdpisPushPosted,
	markOdpisPushFailed,
	markOdpisPushPermanent,
	pendingDueOdpisPushes,
	anyOdpisPushPending,
	isOdpisPushPending,
	type OdpisPushRow
} from './odoo-odpis-store';

const log = logger('odoo-odpis');

const ODPIS_MODEL = 'montalu.material.odpis';
const RETRY_BATCH = 50;
const BACKOFF_BASE_SEC = 30;
const BACKOFF_CAP_SEC = 3600; // 1 h strop
const TIMER_INTERVAL_MS = 60_000;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ---- Config / mode -----------------------------------------------------------------

export interface OdpisPushMode {
	note: boolean;
	model: boolean;
}

/** `ODOO_ODPIS_MODE`: `note` (default = dnešné) | `model` | `both`. Neznáma hodnota → `note` + warn
 *  (Money-safety sa vzťahuje aj na parse configu — NIKDY throw). */
export function odpisPushMode(): OdpisPushMode {
	const raw = (process.env.ODOO_ODPIS_MODE || 'note').trim().toLowerCase();
	switch (raw) {
		case 'note':
			return { note: true, model: false };
		case 'model':
			return { note: false, model: true };
		case 'both':
			return { note: true, model: true };
		default:
			log.warn('ODOO_ODPIS_MODE neznáma hodnota — použijem note (dnešné správanie)', { raw });
			return { note: true, model: false };
	}
}

const allowNonLive = (): boolean => process.env.ODOO_ODPIS_ALLOW_NONLIVE === '1';

// ---- Payload builders (tvar = #5817 create_from_app kontrakt) ------------------------

function buildImportPayload(ev: OdpisWrittenEvent): Record<string, unknown> {
	const j = ev.job;
	return {
		modul: j.modul,
		zak: j.zak,
		op: j.op,
		zakaznik: j.zakaznik,
		popis: j.popis,
		caka: j.caka,
		rezervacia: j.rezervacia ?? false,
		detail: j.detail,
		content_hash: ev.contentHash,
		app_user: j.createdBy,
		source: 'app',
		action: 'import',
		polozky: j.polozky.map((p) => ({ kod: p.kod, nazov: p.nazov, qty: p.qty, mj: p.mj ?? 'm' }))
	};
}

function buildReleasePayload(ev: OdpisReleasedEvent): Record<string, unknown> {
	// Minimálny release payload — len identity (bez polozky); `released_without_import` edge-case
	// vie linkovať sale.order z op/zak.
	return {
		content_hash: ev.contentHash,
		action: 'release',
		source: 'app',
		app_user: ev.actor,
		zak: ev.zak,
		op: ev.op,
		modul: ev.modul
	};
}

// ---- Chyba: transient vs payload-permanent ------------------------------------------

function classifyError(e: unknown): 'transient' | 'permanent' {
	if (e instanceof OdooJson2Error) {
		// payload-permanentné Odoo výnimky (retry by VŽDY zlyhal) → prestaň skúšať, surface na /odpisy.
		if (/ValidationError|UserError|TypeError|ValueError/i.test(e.odooName)) return 'permanent';
	}
	// sieť/timeout/5xx/401-403/AccessError/„model or method not found" → TRANSIENT (retry, no data loss).
	return 'transient';
}

function backoffModifier(attempts: number): string {
	const sec = Math.min(BACKOFF_CAP_SEC, BACKOFF_BASE_SEC * 2 ** Math.min(attempts, 20));
	return `+${sec} seconds`;
}

function extractResult(res: unknown): { odooId: number | null; saleOrderId: number | null } {
	if (res && typeof res === 'object') {
		const o = res as { id?: unknown; sale_order_id?: unknown };
		return {
			odooId: typeof o.id === 'number' && o.id > 0 ? o.id : null,
			saleOrderId:
				typeof o.sale_order_id === 'number' && o.sale_order_id > 0 ? o.sale_order_id : null
		};
	}
	return { odooId: null, saleOrderId: null };
}

// ---- Push jedného riadku ------------------------------------------------------------

/** Pošle jeden store riadok cez `/json/2 create_from_app` a zaznamená výsledok. `true` = posted. */
async function pushOneRow(row: OdpisPushRow): Promise<boolean> {
	const cfg = json2Config();
	if (!cfg) {
		// mode=model ale chýba ODOO_URL/ODOO_API_KEY (napr. env ešte nedodané) → transient, riadok čaká.
		markOdpisPushFailed(
			row.id,
			'json2 nie je nakonfigurované (ODOO_URL/ODOO_API_KEY)',
			backoffModifier(row.attempts)
		);
		return false;
	}
	// JSON.parse návrat je z definície Json2Value (payload vznikol z JSON.stringify serializovateľného
	// create_from_app body) → cast je bezpečný a spĺňa `odooJson2` typ.
	let payload: Record<string, Json2Value>;
	try {
		payload = JSON.parse(row.payload) as Record<string, Json2Value>;
	} catch (e) {
		markOdpisPushPermanent(row.id, 'payload nie je platný JSON: ' + errMsg(e));
		return false;
	}
	try {
		const res = await odooJson2(cfg, ODPIS_MODEL, 'create_from_app', payload);
		const { odooId, saleOrderId } = extractResult(res);
		markOdpisPushPosted(row.id, odooId, saleOrderId);
		log.info('odpis → Odoo posted', {
			id: row.id,
			action: row.action,
			odooId,
			saleOrderId
		});
		return true;
	} catch (e) {
		if (classifyError(e) === 'permanent') {
			markOdpisPushPermanent(row.id, errMsg(e));
			log.error('odpis → Odoo PAYLOAD-permanentná chyba (prestávam skúšať; surface na /odpisy)', {
				id: row.id,
				action: row.action,
				err: errMsg(e)
			});
			return false;
		}
		markOdpisPushFailed(row.id, errMsg(e), backoffModifier(row.attempts));
		log.warn('odpis → Odoo transient chyba (retry cez next_attempt_at)', {
			id: row.id,
			action: row.action,
			attempts: row.attempts + 1,
			err: errMsg(e)
		});
		return false;
	}
}

// ---- Per-hash FIFO serializer (vzor #349) -------------------------------------------

const pushChains = new Map<string, Promise<unknown>>();
function serializeByKey<T>(key: string, task: () => Promise<T>): Promise<T> {
	const prev = pushChains.get(key) ?? Promise.resolve();
	const mine = prev.then(task, task);
	pushChains.set(key, mine);
	const cleanup = (): void => {
		if (pushChains.get(key) === mine) pushChains.delete(key);
	};
	void mine.then(cleanup, cleanup);
	return mine;
}

// ---- Sweep --------------------------------------------------------------------------

let sweepInFlight = false;

/**
 * Spracuje splatné pending riadky v poradí `id` (per-hash FIFO + STOP-ON-FIRST-FAILURE per hash —
 * release nesmie predbehnúť ešte-pending import toho istého hashu, inak Odoo vytvorí stub a import
 * trafí idempotentnú vetvu a polozky nepristanú). Global guard proti prekrytiu (startup/arrival/timer).
 */
export async function runOdpisSweep(): Promise<void> {
	if (sweepInFlight) return;
	sweepInFlight = true;
	try {
		const rows = pendingDueOdpisPushes(RETRY_BATCH);
		if (rows.length === 0) return;
		const failedHashes = new Set<string>();
		for (const row of rows) {
			if (failedHashes.has(row.content_hash)) continue; // skorší riadok tohto hashu zlyhal → poradie
			const ok = await serializeByKey(row.content_hash, async () => {
				if (!isOdpisPushPending(row.id)) return true; // súbežný push ho už posted-ol
				return pushOneRow(row);
			});
			if (!ok) failedHashes.add(row.content_hash);
		}
	} finally {
		sweepInFlight = false;
	}
}

/** Odloží sweep na po aktuálnom sync stacku (release enqueue beží VNÚTRI db.transaction — sweep musí
 *  bežať až po commite). Fire-and-forget. */
function scheduleSweep(): void {
	queueMicrotask(
		() => void runOdpisSweep().catch((e) => log.error('odpis sweep hodil', { err: errMsg(e) }))
	);
}

// ---- Routery (registrované v hooks.server.ts) ---------------------------------------

/** Router po zápise odpisu: `note`→mt_note poznámka (dnešné), `model`→push do modelu, `both`→oba. */
export function dispatchOdpisImport(ev: OdpisWrittenEvent): void {
	const mode = odpisPushMode();
	if (mode.note) queueZakazkaPush(ev.job.zak, ev.job.op);
	if (!mode.model) return;
	if (!ev.live && !allowNonLive()) {
		log.info('odpis → Odoo skip: nie live (nastav ODOO_ODPIS_ALLOW_NONLIVE=1 pre shadow)', {
			zak: ev.job.zak,
			op: ev.job.op
		});
		return;
	}
	try {
		enqueueOdpisPush(ev.contentHash, 'import', buildImportPayload(ev)); // SYNCHRÓNNY durable enqueue
	} catch (e) {
		log.error('odpis push enqueue zlyhal (ignorované — odpis JE v Money)', {
			zak: ev.job.zak,
			op: ev.job.op,
			err: errMsg(e)
		});
		return;
	}
	scheduleSweep();
}

/** Router po uvoľnení odpisu — fírovaný VNÚTRI release-transakcie (enqueue je atomický s DELETE).
 *  `note` mode nemá release koncept (mt_note je agregát). */
export function dispatchOdpisRelease(ev: OdpisReleasedEvent): void {
	if (!odpisPushMode().model) return;
	if (!ev.live && !allowNonLive()) {
		log.info('odpis release → Odoo skip: nie live', { zak: ev.zak, op: ev.op });
		return;
	}
	enqueueOdpisPush(ev.contentHash, 'release', buildReleasePayload(ev)); // synchrónny, v transakcii
	scheduleSweep(); // beží až po commite transakcie (queueMicrotask)
}

// ---- Startup + periodic timer sweep -------------------------------------------------

/** Jednorazový sweep pri ŠTARTE (dopostne zaostalé pushe z minulých výpadkov). Vypnuté (mode!=model). */
export function runStartupOdpisSweep(): void {
	if (!odpisPushMode().model) return;
	void runOdpisSweep().catch((e) => log.error('odpis štartový sweep hodil', { err: errMsg(e) }));
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Periodický timer sweep (single-flight, len keď je čo, `unref`-ed) — arrival-only sweep by nechal
 *  POSLEDNÝ odpis dňa zaseknutý do zajtra/reštartu. Vypnuté (mode!=model). */
export function startOdpisTimerSweep(): void {
	if (timer || !odpisPushMode().model) return;
	timer = setInterval(() => {
		if (!anyOdpisPushPending()) return; // lacný check — sweep len keď je pending riadok
		void runOdpisSweep().catch((e) => log.error('odpis timer sweep hodil', { err: errMsg(e) }));
	}, TIMER_INTERVAL_MS);
	timer.unref?.(); // timer nesmie držať node proces nažive
}

export function stopOdpisTimerSweep(): void {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
}
