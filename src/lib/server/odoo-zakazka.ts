// #340: interný zoznam profilov/komponentov + cena zákazky → INTERNÁ poznámka na `sale.order`
// v Montalu Odoo. Šéf ho vidí PRI zákazke v Odoo; ZÁKAZNÍK ho NIKDY nevidí.
//
// TVRDÁ PODMIENKA (zákazník to nevidí) — poznámka sa postuje ako Odoo LOG-NOTE:
//   message_post(subtype_xmlid='mail.mt_note', message_type='comment', partner_ids=[])
// `mail.mt_note` má `internal=true` (overené na prode) → viditeľné LEN interným Odoo
// používateľom, nikdy portál/e-mail/tlačová zostava/zákazník. `partner_ids=[]` = žiaden
// follower/notifikácia. „Interné" = všetci interní Odoo používatelia (Sales), nie len šéf
// — vedomé rozhodnutie (#340 design). Poznámka NESIE interné ceny (predaj/nákup) — práve
// preto smie ísť LEN do log-note.
//
// TOPOLÓGIA: push PRI odpise (event-driven, najčerstvejšie). Composition root
// (`hooks.server.ts`) registruje `queueZakazkaPush` ako `setOdpisWrittenHook` v money.ts;
// po každom úspešnom zápise odpisu sa fire-and-forget postne AKTUÁLNY agregát zákazky. Každá
// poznámka je ÚPLNÝ snapshot (nahrádza predchádzajúce, chatter ukazuje najnovší navrchu).
//
// MATCH: `sale.order.name === normOp(op)` (objednávka `OP…`/`OPDL…`). 0 zhôd (objednávka je
// ešte ponuka / nie je v Odoo) → zaloguj a preskoč (bez pádu); >1 → postni na všetky + zaloguj.
//
// MONEY-NEUTRÁLNE: NEPÍŠE do `/data`, NEMENÍ dedup, NEDOTÝKA sa `MONEY_LIVE`; z money.ts
// používa LEN čistý `normOp`. Ceny číta z denného Money snapshotu (`enrichPolozky`, read-only).
//
// ROZŠÍRITEĽNÉ: `sekcie[]` — dnes „Profily a komponenty"; sklá z nárezákov pribudnú neskôr
// ako ĎALŠIA sekcia bez zmeny štruktúry (#340 zadanie bod 3).
import { logger } from './log';
import { authenticate, executeKw, odooConfig, xmlEscape, type OdooConfig } from './odoo-rpc';
import { normOp, normZak } from './money';
import { zakazkaPrehlad, type ZakazkaPrehlad } from './zakazka-ceny';
import { enrichPolozky, type CenaRiadok, type CenyResult } from './ceny';
import {
	expireStaleZakazkaPushes,
	getPendingZakazkaPushes,
	isPendingZakazkaPush,
	recordZakazkaPushFailed,
	recordZakazkaPushMissing,
	recordZakazkaPushNoOrder,
	recordZakazkaPushPosted
} from './odoo-zakazka-store';

const log = logger('odoo-zakazka');

/** Max GENUINE zlyhaní (Odoo/sieť) na jeden (zak, op) — po vyčerpaní sa naň už netlačí donekonečna
 *  (poison-pill ako #278). `no-order` sa do tohto NEPOČÍTA (viac v store). */
export const MAX_ATTEMPTS = 5;
/** Koľko pending pushov spracuje jeden retry sweep (ohraničenie záťaže na Odoo, vzor #278). */
const RETRY_BATCH = 20;
/** Časový strop pre `no-order` zombie (objednávka sa nikdy neobjaví v Odoo). Po ňom sa pending
 *  riadok prestane skúšať — čas, nie počet pokusov (arrival sweep beží podľa nesúvisiacej aktivity). */
const MAX_NO_ORDER_AGE_DAYS = 90;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const round2 = (x: number) => Math.round(x * 100) / 100;
/** eur formát so slovenskou desatinnou čiarkou (poznámka je pre šéfa). */
const fmtEur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;

// ---- Typovaný model poznámky (rozšíriteľný — sklá pribudnú ako ďalšia sekcia) ----------

export interface NotePolozka {
	kod: string;
	nazov: string;
	qty: number;
	mj: string;
	/** cena za CELÉ množstvo (qty × jednotková predajná VO), `null` = cena neznáma. */
	cena: number | null;
}

export interface NoteSekcia {
	nadpis: string;
	polozky: NotePolozka[];
}

export interface ZakazkaNote {
	zak: string;
	op: string;
	zakaznik: string;
	scope: 'live' | 'test';
	parkovanych: number;
	bezPoloziek: number;
	odpisovVScope: number;
	sekcie: NoteSekcia[];
	/** súčet predajných VO cien; `null` = ceny vôbec nedostupné (žiadne položky). */
	cenaSpolu: number | null;
	/** `false` = aspoň jedna položka nemala cenu → súčet je NEÚPLNÝ (poznámka to prizná). */
	cenaKompletna: boolean;
	/** interný nákupný súčet (cenník) — pre šéfa; `null` = nedostupné. */
	cenaNakupSpolu: number | null;
	nakupKompletna: boolean;
}

/** Postaví typovaný model poznámky z agregátu zákazky + (voliteľných) cien. Čistá funkcia. */
export function buildZakazkaNote(
	prehlad: ZakazkaPrehlad,
	op: string,
	ceny: CenyResult | null
): ZakazkaNote {
	const cenaByKod = new Map<string, CenaRiadok>();
	if (ceny) for (const r of ceny.radky) cenaByKod.set(r.kod, r);
	const polozky: NotePolozka[] = prehlad.polozky.map((p) => {
		const unit = cenaByKod.get(p.kod)?.predajVo ?? null;
		return {
			kod: p.kod,
			nazov: p.nazov,
			qty: p.qty,
			mj: p.mj,
			cena: unit !== null ? round2(unit * p.qty) : null
		};
	});
	return {
		zak: prehlad.zak,
		op,
		zakaznik: prehlad.zakaznik,
		scope: prehlad.scope,
		parkovanych: prehlad.parkovanych,
		bezPoloziek: prehlad.bezPoloziek,
		odpisovVScope: prehlad.odpisovVScope,
		sekcie: [{ nadpis: 'Profily a komponenty', polozky }],
		cenaSpolu: ceny ? ceny.sucty.predajVo.suma : null,
		cenaKompletna: ceny ? ceny.sucty.predajVo.kompletne : false,
		cenaNakupSpolu: ceny ? ceny.sucty.nakupCennik.suma : null,
		nakupKompletna: ceny ? ceny.sucty.nakupCennik.kompletne : false
	};
}

/**
 * HTML telo log-note. DVE vrstvy escapovania: dynamické HODNOTY (kód/názov/zákazník)
 * `xmlEscape`-nem (aby `<script>` v názve renderoval ako TEXT v Html poli), ŠTRUKTÚRNE
 * tagy nechávam literálne — encoder ich potom raz XML-escapuje na drôte a Odoo dekóduje
 * späť na reálne tagy (rovnaká dvojvrstva ako `crm.lead.description`, #278). `now` je
 * injektovateľné pre testy.
 */
export function buildZakazkaNoteHtml(note: ZakazkaNote, now: Date = new Date()): string {
	const e = xmlEscape;
	const stav = now.toLocaleString('sk-SK', { timeZone: 'Europe/Bratislava' });
	const out: string[] = [];
	out.push('<div>');
	out.push('<p><strong>Interný zoznam materiálu k zákazke</strong></p>');
	out.push(
		`<p>Zákazka: <strong>${e(note.zak)}</strong> &middot; Objednávka: ${e(note.op)} &middot; ` +
			`Zákazník: ${e(note.zakaznik)}</p>`
	);
	out.push(
		`<p><em>Stav k ${e(stav)} &middot; nahrádza predchádzajúce &middot; interné (zákazník ` +
			`toto nevidí) &middot; zdroj: automatizácie Montalu.</em></p>`
	);
	if (note.scope === 'test')
		out.push('<p>⚠️ Sumár z <strong>TEST</strong> odpisov (zákazka nemá žiadny ostrý odpis).</p>');

	for (const sekcia of note.sekcie) {
		out.push(`<p><strong>${e(sekcia.nadpis)}</strong></p>`);
		if (sekcia.polozky.length === 0) {
			out.push('<p><em>(žiadne položky)</em></p>');
			continue;
		}
		out.push(
			'<table border="1" cellpadding="4" cellspacing="0">' +
				'<tr><th>Kód</th><th>Názov</th><th>Množstvo</th><th>MJ</th>' +
				'<th>Cena (predaj VO)</th></tr>'
		);
		for (const p of sekcia.polozky) {
			out.push(
				`<tr><td>${e(p.kod)}</td><td>${e(p.nazov)}</td><td>${e(String(p.qty))}</td>` +
					`<td>${e(p.mj)}</td><td>${p.cena !== null ? e(fmtEur(p.cena)) : '&mdash;'}</td></tr>`
			);
		}
		out.push('</table>');
	}

	if (note.cenaSpolu !== null) {
		const nekompl = note.cenaKompletna ? '' : ' (NEÚPLNÁ — niektoré položky bez ceny)';
		out.push(
			`<p><strong>Celková cena (predaj VO): ${e(fmtEur(note.cenaSpolu))}${nekompl}</strong></p>`
		);
	} else {
		out.push('<p><strong>Celková cena: nie je k dispozícii (položky bez cien)</strong></p>');
	}
	if (note.cenaNakupSpolu !== null) {
		const nekompl = note.nakupKompletna ? '' : ' (neúplná)';
		out.push(`<p>Nákup (cenník): ${e(fmtEur(note.cenaNakupSpolu))}${nekompl}</p>`);
	}
	if (note.parkovanych > 0)
		out.push(`<p>Vrátane ${note.parkovanych} parkovaných odpisov ⏳ (čakajú na ručný presun).</p>`);
	if (note.bezPoloziek > 0)
		out.push(
			`<p>⚠️ ${note.bezPoloziek} odpisov bez uložených položiek (spred fázy 1) — ich materiál ` +
				'v zozname CHÝBA.</p>'
		);
	out.push('</div>');
	return out.join('');
}

// ---- Odoo operácie -----------------------------------------------------------------

/** Nájde `sale.order` id-čka podľa `name === normOp(op)` (objednávka `OP…`/`OPDL…`). */
async function findSaleOrderIds(cfg: OdooConfig, uid: number, name: string): Promise<number[]> {
	const res = await executeKw(cfg, uid, 'sale.order', 'search', [[['name', '=', name]]], {
		limit: 10
	});
	return Array.isArray(res) ? res.filter((x): x is number => typeof x === 'number') : [];
}

/** Postne INTERNÚ log-note (mt_note) na daný `sale.order`. Zákazník ju NIKDY nevidí. */
async function postInternalNote(
	cfg: OdooConfig,
	uid: number,
	saleOrderId: number,
	html: string
): Promise<void> {
	await executeKw(cfg, uid, 'sale.order', 'message_post', [[saleOrderId]], {
		body: html,
		subtype_xmlid: 'mail.mt_note', // internal=true → interné, nikdy k zákazníkovi
		message_type: 'comment',
		partner_ids: [] // explicitne prázdne — žiadny follower/notifikácia
	});
}

export type ZakazkaPushResult = 'posted' | 'no-order' | 'missing' | 'disabled' | 'failed';

/** Výsledok pushu + (pri `failed`) chybová správa pre durable `last_error` (#349). */
export interface ZakazkaPushOutcome {
	result: ZakazkaPushResult;
	error: string | null;
}

/**
 * Postne aktuálny interný zoznam materiálu zákazky do Odoo na `sale.order` objednávky `op` a vráti
 * DETAILNÝ výsledok (`{result, error}`) — `error` je vyplnené len pri `failed`, aby ho durable vrstva
 * (#349) uložila do `last_error`. NIKDY nehádže (fire-and-forget kontrakt). JEDINÁ cesta k
 * `message_post` (interná `mt_note`) — retry aj arrival ju zdieľajú, takže leak-kontrakt sa NEMÔŽE
 * rozísť s #340.
 */
export async function pushZakazkaToOdooDetailed(
	zak: string,
	op: string
): Promise<ZakazkaPushOutcome> {
	const cfg = odooConfig();
	if (!cfg) {
		log.debug('zakazka push vypnutý (chýba ODOO_LEAD_* env)', { zak, op });
		return { result: 'disabled', error: null };
	}
	try {
		// #340 review: zakazkaPrehlad (SQLite read) MUSÍ byť vnútri try — inak by DB chyba
		// prebublala von a porušila „NIKDY nehádže" kontrakt (aj pre budúceho priameho volajúceho).
		const prehlad = zakazkaPrehlad(zak);
		if (!prehlad) {
			log.warn('zakazka push: zákazka nemá žiadny odpis — nič neposielam', { zak });
			return { result: 'missing', error: null };
		}
		const ceny = prehlad.polozky.length > 0 ? enrichPolozky(prehlad.polozky) : null;
		const html = buildZakazkaNoteHtml(buildZakazkaNote(prehlad, op, ceny));
		const uid = await authenticate(cfg);
		const name = normOp(op);
		const ids = await findSaleOrderIds(cfg, uid, name);
		if (ids.length === 0) {
			log.info(
				'zakazka push: sale.order sa nenašiel (objednávka nie je v Odoo / je ešte ponuka) — preskakujem',
				{
					zak,
					op,
					name
				}
			);
			return { result: 'no-order', error: null };
		}
		if (ids.length > 1)
			log.warn('zakazka push: viac sale.order s rovnakým name — postnem na všetky', { name, ids });
		for (const id of ids) {
			await postInternalNote(cfg, uid, id, html);
			log.info('zakazka push: interná poznámka zapísaná na sale.order', {
				zak,
				op,
				name,
				saleOrderId: id
			});
		}
		return { result: 'posted', error: null };
	} catch (e) {
		const msg = errMsg(e);
		log.error('zakazka push zlyhal (odpis JE zapísaný; poznámka sa nepostla)', {
			zak,
			op,
			err: msg
		});
		return { result: 'failed', error: msg };
	}
}

/**
 * Tenký wrapper — vráti len `ZakazkaPushResult` (ZACHOVÁVA pôvodné #340 API + testy). Priamy
 * volajúci, ktorý nepotrebuje durable stav, používa tento; durable cesta (#349) volá `…Detailed`.
 */
export async function pushZakazkaToOdoo(zak: string, op: string): Promise<ZakazkaPushResult> {
	return (await pushZakazkaToOdooDetailed(zak, op)).result;
}

// ---- Durable retry + per-kľúč serializácia (#349) -----------------------------------

const pushKey = (zak: string, op: string): string => `${normZak(zak)} ${normOp(op)}`;

/**
 * Per-kľúč FIFO serializer súbežných pushov tej istej (zak, op). #349 zadanie bod 4: poradie
 * doručenia dvoch pushov tej istej zákazky nie je garantované — bez serializácie by sa mohol
 * NAJNOVŠÍ note v chatteri ukázať ako STARŠÍ snapshot (skoršia derivácia doručená neskôr). Chain
 * `Map<key, tailPromise>`: každý push pre kľúč počká na predchádzajúci a AŽ POTOM re-derivuje +
 * postne → najčerstvejší snapshot postne POSLEDNÝ (navrchu chattera). Zamietnuté skip-if-in-flight
 * (#278): preskočenie druhého pushu by stratilo dáta neskoršieho odpisu, ktoré derivácia bežiaceho
 * pushu nevidela. Single-process (adapter-node) → in-process chain je spoľahlivý per-kľúč zámok.
 * Guardy: (1) `.then(task, task)` — rejection predchodcu nesmie preskočiť náš task; (2) tail-compare
 * cleanup (zmaž kľúč len keď sme STÁLE tail, nie novší chained); (3) žiadny cross-key await v tasku
 * → žiadny deadlock. Rast Mapy je ohraničený frekvenciou odpisov (človekom riadené).
 */
const pushChains = new Map<string, Promise<unknown>>();
function serializeByKey<T>(key: string, task: () => Promise<T>): Promise<T> {
	const prev = pushChains.get(key) ?? Promise.resolve();
	const mine = prev.then(task, task);
	pushChains.set(key, mine);
	// Handluj OBE vetvy (fulfil aj reject) → žiadny unhandledRejection na uloženom tail-e; cleanup
	// len keď sme stále tail (novší chained push nesmieme zmazať).
	const cleanup = (): void => {
		if (pushChains.get(key) === mine) pushChains.delete(key);
	};
	void mine.then(cleanup, cleanup);
	return mine;
}

/**
 * Push + zápis durable stavu (#349). NIKDY nehádže (push nehádže; DB zápis je obalený). Podľa
 * výsledku: `posted` → vyrieš pending; `failed` → pending + inkrement poison-pill; `no-order` →
 * pending BEZ inkrementu (časový strop); `missing` → terminálny; `disabled` → netrackuj (feature off).
 */
async function pushAndRecord(zak: string, op: string): Promise<ZakazkaPushResult> {
	const { result, error } = await pushZakazkaToOdooDetailed(zak, op);
	try {
		switch (result) {
			case 'posted':
				recordZakazkaPushPosted(zak, op);
				break;
			case 'failed':
				recordZakazkaPushFailed(zak, op, error ?? 'neznáma chyba');
				break;
			case 'no-order':
				recordZakazkaPushNoOrder(zak, op);
				break;
			case 'missing':
				recordZakazkaPushMissing(zak, op);
				break;
			case 'disabled':
				break; // feature off — netrackuj (žiadny minutý pokus)
		}
	} catch (e) {
		log.error('zakazka push: zápis durable stavu do DB zlyhal (ignorované)', {
			zak,
			op,
			result,
			err: errMsg(e)
		});
	}
	return result;
}

// Jeden sweep naraz: štartový a arrival sweep môžu vzniknúť súbežne a bez tohto guardu by obidva
// prečítali tú istú pending množinu a duplikovali prácu (review #349 🔵). Neškodné (re-derivovaný
// snapshot, last-wins), ale zbytočné Odoo volania — guard ich zlúči.
let sweepInFlight = false;

/**
 * Retry sweep zaostalých pushov (Odoo bola dole / objednávka pribudla neskôr). Najprv exspiruj
 * zaseknuté riadky (časový strop), potom spracuj pending riadky SEKVENČNE cez ten istý per-kľúč
 * serializer (aby retry nezávodil so živým pushom tej istej zákazky). V serializovanom tasku ešte
 * re-checkne, či je riadok STÁLE pending (živý arrival push ho mohol medzitým vyriešiť). Vypnuté
 * (chýba env) ⇒ žiadny DB dotaz. Arrival-triggered (po úspešnom pushi = dôkaz že Odoo je hore, #278).
 */
export async function retryPendingZakazkaPushes(): Promise<void> {
	if (!odooConfig()) return;
	if (sweepInFlight) return;
	sweepInFlight = true;
	try {
		expireStaleZakazkaPushes(MAX_NO_ORDER_AGE_DAYS);
		const pending = getPendingZakazkaPushes(MAX_ATTEMPTS, MAX_NO_ORDER_AGE_DAYS, RETRY_BATCH);
		if (pending.length === 0) return;
		log.info('zakazka push retry sweep štart', { pocet: pending.length });
		let posted = 0;
		for (const row of pending) {
			const r = await serializeByKey(pushKey(row.zak, row.op), async () => {
				// re-check vnútri zámku: živý arrival push mohol tento kľúč medzitým vyriešiť
				if (!isPendingZakazkaPush(row.zak, row.op)) return 'skipped' as const;
				return pushAndRecord(row.zak, row.op);
			});
			if (r === 'posted') posted++;
		}
		log.info('zakazka push retry sweep hotový', {
			spracovanych: pending.length,
			postnutych: posted
		});
	} finally {
		sweepInFlight = false;
	}
}

/**
 * FIRE-AND-FORGET vstupný bod pre `setOdpisWrittenHook` (money.ts). Synchrónny `void` wrapper —
 * NIKDY neblokuje ani nezhodí volajúceho (`writeOdpis` je už zapísaný). Push ide cez per-kľúč
 * serializer (durable stav zaznamenaný v `pushAndRecord`); po ÚSPEŠNOM pushi (dôkaz že Odoo je hore)
 * sa spustí retry sweep zaostalých z minulých výpadkov (#349, vzor #278). Vonkajší try/catch chytí aj
 * prípadný SYNCHRÓNNY throw pred prvým `await`.
 */
export function queueZakazkaPush(zak: string, op: string): void {
	try {
		void serializeByKey(pushKey(zak, op), () => pushAndRecord(zak, op)).then(
			(result) => {
				// Sweep starých pending LEN keď TENTO push uspel (úspech = Odoo je hore) — pri výpadku by
				// sweep len míňal poison-pill pokusy na starých riadkoch (#278 review).
				if (result === 'posted')
					void retryPendingZakazkaPushes().catch((e) =>
						log.error('zakazka push queue: retry sweep neočakávane hodil', { err: errMsg(e) })
					);
			},
			(e) => log.error('zakazka push queue: submit neočakávane hodil', { zak, op, err: errMsg(e) })
		);
	} catch (e) {
		log.error('zakazka push queue: synchrónne hodil (ignorované — odpis je zapísaný)', {
			zak,
			op,
			err: errMsg(e)
		});
	}
}

/**
 * Jednorazový sweep pri ŠTARTE servera (volá `hooks.server.ts` po migráciách). Zotaví pushe, ktoré
 * čakali na Odoo (Odoo bola dole / objednávka medzitým pribudla) a appka sa reštartovala — inak by
 * arrival retry čakal až na ĎALŠÍ úspešný push (vzor #278 `runStartupLeadSweep`). Deploy = reštart,
 * takže pokrýva bežný „Odoo opravené → nasadené". Fire-and-forget; vypnuté (chýba env) ⇒ no-op.
 */
export function runStartupZakazkaSweep(): void {
	if (!odooConfig()) return;
	void retryPendingZakazkaPushes().catch((e) =>
		log.error('zakazka push štartový sweep hodil', { err: errMsg(e) })
	);
}
