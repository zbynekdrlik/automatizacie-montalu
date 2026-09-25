// #570: nárezák (rozpis rezov `lines` + grafický PDF + `cut_plan`) na kiosk „Čo rezať" pri KAŽDOM
// OSTROM odpise — obnovenie automatického triggera, ktorý #511 odstránil z `setOdpisWrittenHook`
// (kiosk odvtedy dostával riadky len z uloženia plánu na /plan-rezov, čo výroba nerobí → tablety
// prázdne od 20.9.).
//
// JEDEN ZDROJ PRAVDY s backfillom (#524): telo je zdieľané jadro `backfill-narezaky.ts`
// (`groupOdpisyPerOp` → `linesPreOp` → `odoslatNarezakPreOp`) — rekomputa z uloženého `detail`,
// kombinácia VŠETKÝCH modulov OP (lines upload nahrádza všetky riadky objednávky), doc_id per OP
// `backfill-narezak-<op>`, `cut_plan` v1/v2/v3 + 422 fallback + kill switch `ODOO_NAREZ_CUT_PLAN`
// (transport `uploadNarezak`). Žiadne CENY (na rozdiel od zmazaného `odoo-narezak-upload.ts`, ktorý
// posielal rozpis s cenami — to je dôvod #511 a ostáva zmazaný).
//
// Money-NEUTRÁLNE: iba READ (`odpis_log`/`odpis_polozky`) + Odoo upload. Fire-and-forget: práca sa
// odloží cez `setImmediate` MIMO request tick odpisu a NIKDY nehádže — odpis je už durable zapísaný.
// LEN pre ostré odpisy (`live=1`); test odpis nikdy nič neposiela. BEZ durable-retry (rovnako ako
// /plan-rezov cesta); zlyhaný upload sa zotaví ďalším odpisom OP alebo backfillom (`--zak`).
import { logger } from './log';
import { isNarezUploadEnabled, odooJson2Config } from './odoo-json2';
import { isLive, normOp } from './money';
import { loadCfg } from './db';
import {
	groupOdpisyPerOp,
	linesPreOp,
	odoslatNarezakPreOp,
	type NarezakLog
} from './backfill-narezaky';
import { listLiveOdpisyForOp, makeOdooBackfillDeps } from './backfill-narezaky-deps';

const log = logger('narezak-upload');
const logFn: NarezakLog = (lvl, msg, ctx) => log[lvl](msg, ctx);

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export type NarezakOdpisResult =
	'uploaded' | 'disabled' | 'no-odpis' | 'no-lines' | 'no-order' | 'failed';

export interface NarezakOdpisOutcome {
	result: NarezakOdpisResult;
	riadkov?: number;
	docId?: string;
	error?: string;
}

/**
 * Nahrá nárezák OP z jej ostrých odpisov na Odoo kiosk. Volajúci (queue) už overil `live=1`.
 * NIKDY nehádže — vracia výsledok.
 */
export async function uploadNarezakZOdpisu(zak: string, op: string): Promise<NarezakOdpisOutcome> {
	if (!isNarezUploadEnabled()) {
		log.debug('nárezák upload vypnutý (ODOO_NAREZ_UPLOAD_ENABLED !== 1)', { zak, op });
		return { result: 'disabled' };
	}
	const odooCfg = odooJson2Config();
	if (!odooCfg) {
		log.debug('nárezák upload vypnutý (chýba ODOO_JSON2_URL / ODOO_JSON2_API_KEY)', { zak, op });
		return { result: 'disabled' };
	}
	const opNorm = normOp(op);
	try {
		log.info('nárezák z odpisu: štart', { zak, op: opNorm });
		const g = groupOdpisyPerOp(listLiveOdpisyForOp(opNorm)).get(opNorm);
		if (!g) {
			// napr. OP má len bazén (mimo záberu rozpisu rezov) alebo prázdne OP
			log.info('nárezák z odpisu: OP nemá odpis s rozpisom rezov — nič neposielam', {
				zak,
				op: opNorm
			});
			return { result: 'no-odpis' };
		}
		const deps = makeOdooBackfillDeps(loadCfg(), odooCfg, logFn);
		const res = linesPreOp(opNorm, g, deps.cfg, deps.loadPolozky, logFn);
		if (res.lines.length === 0) {
			// napr. pergola rezervačný odpis bez rekonštruovateľného materiálu (skip zalogovaný v jadre)
			log.info('nárezák z odpisu: žiadne narezateľné riadky — nič neposielam', {
				zak,
				op: opNorm,
				skipy: res.skipy
			});
			return { result: 'no-lines' };
		}
		const up = await odoslatNarezakPreOp(
			opNorm,
			g,
			res.lines,
			res.material,
			deps.uploadLines,
			logFn,
			{
				zak,
				moduly: res.moduly
			}
		);
		if (up.akcia === 'uploaded') {
			log.info('nárezák z odpisu: ok', {
				zak,
				op: opNorm,
				docId: up.docId,
				linesCount: res.lines.length,
				cutPlanRejected: up.cutPlanRejected
			});
			return { result: 'uploaded', riadkov: res.lines.length, docId: up.docId };
		}
		if (up.akcia === 'skip-no-order')
			return { result: 'no-order', docId: up.docId, error: up.error };
		return { result: 'failed', docId: up.docId, error: up.error };
	} catch (e) {
		const msg = errMsg(e);
		log.error('nárezák z odpisu zlyhal', { zak, op: opNorm, err: msg });
		return { result: 'failed', error: msg };
	}
}

/**
 * SÉRIOVANIE per OP (review 🟡 #570): `lines` upload NAHRÁDZA všetky riadky objednávky, takže dva
 * súbežné uploady tej istej OP (dva odpisy rýchlo po sebe) by mohli doraziť v opačnom poradí a starší
 * snapshot (len modul A) by prepísal novší (A+B). Preto per OP beží NAJVIAC JEDEN upload; odpis, ktorý
 * príde počas behu, len označí `dobeh` — po skončení prebehne JEDEN ďalší upload, ktorý si stav načíta
 * z DB NANOVO (obsahuje všetky moduly vrátane neskorších). N odpisov počas behu = 1 zlúčený dobeh.
 * Stav je len in-memory (jeden proces servera); reštart ho zahodí — nič durable sa nestratí, lebo
 * každý upload rekonštruuje celú OP z `odpis_log`.
 */
const bezi = new Map<string, { dobeh: boolean; zak: string; op: string }>();

function spustiSerioveho(opNorm: string, zak: string, op: string): void {
	const stav = { dobeh: false, zak, op };
	bezi.set(opNorm, stav);
	void uploadNarezakZOdpisu(zak, op)
		.catch((e) =>
			log.error('nárezák z odpisu queue: neočakávane hodil', { zak, op, err: errMsg(e) })
		)
		.finally(() => {
			if (stav.dobeh) {
				log.info('nárezák z odpisu: dobeh zlúčených odpisov OP', { op: opNorm });
				spustiSerioveho(opNorm, stav.zak, stav.op);
			} else {
				bezi.delete(opNorm);
			}
		});
}

/**
 * FIRE-AND-FORGET vstupný bod — registruje sa v `hooks.server.ts` `setOdpisWrittenHook` vedľa
 * `queueZakazkaPush`. `live` sa číta SYNCHRÓNNE v mieste volania (ten istý proces-flag, ktorým
 * `writeOdpis` práve zapísal `odpis_log.live`) — test odpis (`live=0`) neposiela NIČ. Celá práca
 * (SQLite read, rekomputa, PDF, upload) sa odloží cez `setImmediate` mimo request tick a je SÉRIOVÁ
 * per OP (viď `bezi` vyššie). NIKDY nehádže.
 */
export function queueNarezakUploadZOdpisu(zak: string, op: string): void {
	try {
		if (!isLive()) {
			log.debug('nárezák z odpisu: test odpis (live=0) — nič neposielam', { zak, op });
			return;
		}
		const opNorm = normOp(op);
		setImmediate(() => {
			const stav = bezi.get(opNorm);
			if (stav) {
				// upload tejto OP práve beží → po ňom prebehne JEDEN dobeh s čerstvým stavom z DB
				stav.dobeh = true;
				stav.zak = zak;
				stav.op = op;
				log.debug('nárezák z odpisu: upload OP beží — zaradený dobeh', { zak, op: opNorm });
				return;
			}
			spustiSerioveho(opNorm, zak, op);
		});
	} catch (e) {
		log.error('nárezák z odpisu queue: synchrónne hodil', { zak, op, err: errMsg(e) });
	}
}
