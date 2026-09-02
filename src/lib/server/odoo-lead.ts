// Zrkadlenie verejného zákazníckeho dopytu (#277) do Odoo CRM leadu (#278). Každý dopyt z
// verejného konfigurátora pergoly vznikne ako `crm.lead` v Montalu Odoo (`erp.montalu.cloud`,
// db `odoo`) cez XML-RPC, s pripojenou PDF ponukou (`ir.attachment`, best-effort).
//
// KĽÚČOVÝ KONTRAKT (#278): dopyt sa NIKDY nestratí a zákazníkovo PDF sa NIKDY neoneskorí ani
// nezhodí kvôli Odoo. Preto:
//   • `dopyt-action` volá `queueLeadCreation()` FIRE-AND-FORGET až po pripravení PDF odpovede
//     — tvorba leadu beží async mimo request/response cesty (synchrónny `void` wrapper).
//   • Odoo nedostupné/chyba ⇒ `odoo_attempts++` + `odoo_last_error` (migrácia v26), dopyt
//     ostáva pending → `retryPendingLeads()` sweep ho neskôr spracuje (bounded MAX pokusmi).
//   • chýbajúci env (feature disabled) ⇒ dopyt ostáva pending, žiadny pokus sa neminie.
//
// XML-RPC klient je MINIMALISTICKÝ hand-rolled cez `fetch` (žiadna npm závislosť) — Node nemá
// builtin XML-RPC a bundling hotového balíka pod Vite SSR + adapter-node + `npm prune` je
// integračné riziko neoveriteľné v Tier-0 worktree (rovnaká disciplína ako `log.ts`/`dejavu.ts`;
// viď dizajn komentár #278). Encoder pokrýva int/string/bool/struct/array; decoder skalár
// (int uid/id) + fault — presne to, čo reálne konzumujeme (authenticate → uid, create → id).
//
// CREDENTIALS: LEN runtime env (`ODOO_LEAD_URL`/`ODOO_LEAD_DB`/`ODOO_LEAD_LOGIN`/
// `ODOO_LEAD_API_KEY`), NIKDY v gite, žiadny default s tajomstvom — chýba ktorákoľvek ⇒ vypnuté.
//
// MONEY-NEUTRÁLNE: payload staviam len z `zhrnutieRiadky()`/kontaktu (bez cien); tento modul
// neimportuje money/pergola a nezapisuje do /data (guard `tests/odoo-lead.test.ts`).
import { logger } from './log';
import {
	getDopytForLead,
	getPendingLeadDopyty,
	markLeadCreated,
	markLeadFailed
} from './dopyt-store';
import type { DopytLeadRiadok } from './dopyt-store';
import { generatePonukaPdf } from './ponuka-pdf';
import { produktNazov } from '$lib/konfigurator-produkty';
import { sanitizePonukaConfig, zhrnutieRiadky, type PonukaConfig } from '$lib/ponuka';
import {
	xmlEscape,
	setOdooTransport,
	authenticate,
	createRecord,
	odooConfig,
	type OdooConfig,
	type OdooTransport
} from './odoo-rpc';

const log = logger('odoo-lead');

/** Max pokusov o vytvorenie leadu na jeden dopyt — po vyčerpaní zostáva `odoo_last_error`
 *  (dopyt NIE je stratený, len sa naň už netlačí donekonečna). */
export const MAX_ATTEMPTS = 5;
/** Koľko pending dopytov spracuje jeden retry sweep (ohraničenie záťaže na Odoo). */
const RETRY_BATCH = 20;
// ---- Nízkoúrovňový XML-RPC klient je zdieľaný v `odoo-rpc.ts` (#340) --------------------
// Encoder/decoder/transport/authenticate/createRecord/config žijú tam (zdieľané s
// `odoo-zakazka.ts`). Verejná plocha (testy) je tu zachovaná cez tenké aliasy.

/** TEST hook (kompat): nahraď XML-RPC transport (mock); `null` = späť na `fetch`. */
export const _setLeadTransport = (t: OdooTransport | null): void => setOdooTransport(t);
export type LeadTransport = OdooTransport;
export type LeadConfig = OdooConfig;
/** Prečíta `ODOO_LEAD_*` env; chýba ktorákoľvek zo 4 ⇒ `null` (feature vypnutá). */
export const leadConfig = odooConfig;

// ---- Payload leadu (čisté, testovateľné, BEZ CIEN) -----------------------------------

export interface LeadPayload extends Record<string, string> {
	name: string;
	contact_name: string;
	email_from: string;
	phone: string;
	description: string;
	type: string;
}

function leadName(produktNaz: string, meno: string, miesto: string, jeObjednavka: boolean): string {
	const kto = meno || 'neznámy záujemca';
	// #319: objednávka nesie v NÁZVE „OBJEDNÁVKA" (obchod rozozná objednávku od nezáväzného dopytu
	// hneď zo zoznamu), dopyt ostáva „dopyt". #384: prefix je produkt-aware (`produktNaz` — „Pergola",
	// „Bazénové zastrešenie", …; NULL/starý dopyt → „Pergola", byte-identicky s pôvodným tvarom).
	const label = jeObjednavka ? 'OBJEDNÁVKA' : 'dopyt';
	return miesto
		? `${produktNaz} – ${label}: ${kto} (${miesto})`
		: `${produktNaz} – ${label}: ${kto}`;
}

/**
 * Popis leadu: (pri objednávke) hlavička + fakturačný blok, potom miesto stavby + poznámka
 * zákazníka + súhrn konfigurácie (`zhrnutieRiadky`). Zákaznícke hodnoty HTML-escapujem
 * (`crm.lead.description` je Html pole — obrana proti vloženému markupu); riadky delím literálom
 * `<br>`. ŽIADNA cena (zhrnutieRiadky je bez cien; objednaná cena je zapečatená v DB, do leadu
 * NEJDE — Money-neutralita payloadu, #319 dizajn Prístup 3 zamietnutý).
 */
function buildDescription(row: DopytLeadRiadok, cfg: PonukaConfig): string {
	const jeObjednavka = !!row.je_objednavka;
	// #384: produkt-aware zdroj/hlavička (NULL/starý pergolový dopyt → „Pergola").
	const produktNaz = produktNazov(row.produkt);
	const lines: string[] = [];
	if (jeObjednavka) {
		lines.push(`ZÁVÄZNÁ OBJEDNÁVKA z verejného konfigurátora Montalu (${produktNaz}).`);
		lines.push('');
		lines.push('Fakturačné údaje:');
		if (row.fakt_meno) lines.push(`Meno / firma: ${xmlEscape(row.fakt_meno)}`);
		if (row.fakt_adresa) lines.push(`Adresa: ${xmlEscape(row.fakt_adresa)}`);
		if (row.fakt_ico) lines.push(`IČO: ${xmlEscape(row.fakt_ico)}`);
		if (row.fakt_dic) lines.push(`DIČ: ${xmlEscape(row.fakt_dic)}`);
		lines.push('');
	}
	if (row.miesto) lines.push(`Miesto stavby: ${xmlEscape(row.miesto)}`);
	if (row.poznamka) lines.push(`Poznámka zákazníka: ${xmlEscape(row.poznamka)}`);
	if (row.miesto || row.poznamka) lines.push('');
	lines.push('Konfigurácia z verejného konfigurátora:');
	const rows = zhrnutieRiadky(cfg);
	if (rows.length === 0) lines.push('(bez detailov konfigurácie)');
	else for (const r of rows) lines.push(`${xmlEscape(r.label)}: ${xmlEscape(r.value)}`);
	lines.push('');
	lines.push(
		jeObjednavka
			? `Zdroj: verejný konfigurátor Montalu – ${produktNaz} (app.montalu.cloud). ZÁVÄZNÁ OBJEDNÁVKA (bez online platby) — potvrďte a ozvite sa zákazníkovi.`
			: `Zdroj: verejný konfigurátor Montalu – ${produktNaz} (app.montalu.cloud). Nezáväzný dopyt, nie cenová ponuka.`
	);
	return lines.join('<br>\n');
}

/** Postaví `crm.lead` payload z uloženého dopytu/objednávky (kontakt + konfigurácia). BEZ CIEN.
 *  #319: objednávka (`je_objednavka=1`) → `type:'opportunity'` (vyšší stupeň v CRM než `lead` —
 *  z inboxu leadov do pipeline príležitostí) + názov „OBJEDNÁVKA" + fakturačný blok v popise. */
export function buildLeadPayload(row: DopytLeadRiadok): LeadPayload {
	const cfg = sanitizePonukaConfig(row.konfiguracia);
	const jeObjednavka = !!row.je_objednavka;
	return {
		name: leadName(produktNazov(row.produkt), row.meno, row.miesto, jeObjednavka),
		contact_name: row.meno,
		email_from: row.email,
		phone: row.telefon,
		description: buildDescription(row, cfg),
		type: jeObjednavka ? 'opportunity' : 'lead'
	};
}

function leadFilename(createdAt: string): string {
	const den = (createdAt || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
	return `Montalu-ponuka-${den}.pdf`;
}

// ---- Tvorba leadu + best-effort príloha ----------------------------------------------

/**
 * Vytvorí `crm.lead` a (best-effort) pripojí PDF ako `ir.attachment`. Pád PRÍLOHY NEZHODÍ
 * lead (lead už existuje) — len sa zaloguje. Vracia `leadId`.
 */
export async function createLeadViaXmlRpc(
	cfg: LeadConfig,
	payload: LeadPayload,
	pdfBase64?: string,
	filename = 'Montalu-ponuka.pdf'
): Promise<number> {
	const uid = await authenticate(cfg);
	const leadId = await createRecord(cfg, uid, 'crm.lead', payload);
	if (pdfBase64) {
		try {
			await createRecord(cfg, uid, 'ir.attachment', {
				name: filename,
				datas: pdfBase64,
				res_model: 'crm.lead',
				res_id: leadId,
				mimetype: 'application/pdf',
				type: 'binary'
			});
			log.info('lead: PDF príloha pripojená', { leadId });
		} catch (e) {
			log.warn('lead: PDF príloha zlyhala (best-effort, lead ostáva)', {
				leadId,
				err: e instanceof Error ? e.message : String(e)
			});
		}
	}
	return leadId;
}

/** Regeneruje PDF z uloženej konfigurácie (retry cesta — pôvodný render sa neukladá).
 *  Best-effort: pád regenerácie ⇒ `undefined` (lead vznikne bez prílohy). #404: `produkt` sa
 *  MUSÍ zaniesť — inak by príloha retry-leadu (a) mala pergolový nadpis pre bazén a (b) sfalšovaná
 *  bazénová cfg s pergolovými poľami (`hlbka`+`model`) by cez `maCenovyZdroj(null)=true` dostala
 *  NESPRÁVNU pergolovú cenu; s `produkt` sa cena počíta produkt-aware (`cenaZCfgProdukt`). */
async function regeneratePdfBase64(
	konfiguraciaJson: string,
	produkt: string | null
): Promise<string | undefined> {
	try {
		const cfg = sanitizePonukaConfig(konfiguraciaJson);
		const bytes = await generatePonukaPdf(cfg, { produkt });
		return Buffer.from(bytes).toString('base64');
	} catch (e) {
		log.warn('lead retry: regenerácia PDF zlyhala (príloha sa vynechá)', {
			err: e instanceof Error ? e.message : String(e)
		});
		return undefined;
	}
}

export type LeadSubmitResult = 'created' | 'failed' | 'disabled' | 'missing' | 'skipped';

/** ID-čka dopytov, ktorých lead sa PRÁVE async vytvára. Kým beží tvorba, DB riadok má stále
 *  `odoo_lead_id IS NULL`, takže by ho súbežný sweep (z iného dopytu) vzal a vytvoril DRUHÝ
 *  lead. Beh je single-process (adapter-node), preto in-process Set spoľahlivo serializuje
 *  per-dopyt tvorbu (#278 review). */
const inFlight = new Set<number>();

/**
 * Zrkadlí jeden dopyt do Odoo leadu. `pdfBase64` = z pôvodného submitu (initial cesta);
 * bez neho (retry cesta) sa PDF regeneruje. Chyba ⇒ `markLeadFailed` (dopyt ostáva, retry).
 * NIKDY nehádže — všetko sa loguje a mapuje na výsledok.
 */
export async function submitDopytLead(
	dopytId: number,
	pdfBase64?: string
): Promise<LeadSubmitResult> {
	const cfg = leadConfig();
	if (!cfg) {
		log.debug('Odoo lead vypnutý (chýba env) — dopyt ostáva pending', { dopytId });
		return 'disabled';
	}
	const row = getDopytForLead(dopytId);
	if (!row) {
		log.warn('lead submit: dopyt neexistuje', { dopytId });
		return 'missing';
	}
	if (row.odoo_lead_id != null) return 'skipped'; // už zrkadlený
	if (row.odoo_attempts >= MAX_ATTEMPTS) return 'skipped'; // vzdané po MAX pokusoch
	if (inFlight.has(dopytId)) return 'skipped'; // práve sa vytvára (súbeh) — neduplikuj lead
	inFlight.add(dopytId);

	try {
		const payload = buildLeadPayload(row);
		const pdf = pdfBase64 ?? (await regeneratePdfBase64(row.konfiguracia, row.produkt));
		try {
			const leadId = await createLeadViaXmlRpc(cfg, payload, pdf, leadFilename(row.created_at));
			markLeadCreated(dopytId, leadId);
			log.info('dopyt zrkadlený do Odoo CRM leadu', {
				dopytId,
				leadId,
				pokus: row.odoo_attempts + 1
			});
			return 'created';
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			markLeadFailed(dopytId, msg);
			log.error('lead do Odoo zlyhal — dopyt ostáva, retry neskôr', {
				dopytId,
				pokus: row.odoo_attempts + 1,
				err: msg
			});
			return 'failed';
		}
	} finally {
		inFlight.delete(dopytId);
	}
}

/**
 * Sweep dopytov čakajúcich na Odoo lead (Odoo bola dole / env pribudol neskôr). Sekvenčne
 * (netlačíme na Odoo naraz), ohraničené `RETRY_BATCH`. Vypnuté (chýba env) ⇒ žiadny DB dotaz.
 */
export async function retryPendingLeads(): Promise<void> {
	if (!leadConfig()) return;
	const pending = getPendingLeadDopyty(MAX_ATTEMPTS, RETRY_BATCH);
	if (pending.length === 0) return;
	log.info('lead retry sweep štart', { pocet: pending.length });
	let created = 0;
	for (const row of pending) {
		const r = await submitDopytLead(row.id);
		if (r === 'created') created++;
	}
	log.info('lead retry sweep hotový', { spracovanych: pending.length, vytvorenych: created });
}

/**
 * FIRE-AND-FORGET vstupný bod pre `dopyt-action`: zrkadlí TENTO dopyt a potom prebehne retry
 * sweep pre staré pending. Synchrónny `void` wrapper (kvôli `no-floating-promises`) — NIKDY
 * neblokuje ani nezhodí volajúceho (zákazníkovo PDF). Všetky chyby sú vnútri zachytené.
 */
export function queueLeadCreation(dopytId: number, pdfBase64?: string): void {
	void (async () => {
		let result: LeadSubmitResult = 'failed';
		try {
			result = await submitDopytLead(dopytId, pdfBase64);
		} catch (e) {
			log.error('lead queue: submit neočakávane hodil', {
				dopytId,
				err: e instanceof Error ? e.message : String(e)
			});
		}
		// Sweep starých pending LEN keď TENTO submit uspel — úspech je dôkaz, že Odoo je hore.
		// Pri výpadku (failed/disabled) by sweep len zbytočne míňal pokusy na starých riadkoch
		// (a poison-pill riadok by zožral MAX_ATTEMPTS podľa frekvencie príchodov) — #278 review.
		if (result !== 'created') return;
		try {
			await retryPendingLeads();
		} catch (e) {
			log.error('lead queue: retry sweep neočakávane hodil', {
				err: e instanceof Error ? e.message : String(e)
			});
		}
	})();
}

/**
 * Jednorazový sweep pri ŠTARTE servera (volá `hooks.server.ts`). Zotaví dopyty, ktoré čakali
 * na Odoo lead (Odoo bola dole / env pribudol) a medzitým sa appka reštartovala — inak by sa
 * arrival-triggered retry rozbehol až pri ĎALŠOM dopyte (#278 review, finding #2). Deploy =
 * reštart, takže tento sweep pokryje bežný „Odoo/env opravené → nasadené" prípad.
 * Fire-and-forget, chyby zachytené; vypnuté (chýba env) ⇒ okamžite no-op.
 */
export function runStartupLeadSweep(): void {
	if (!leadConfig()) return;
	void retryPendingLeads().catch((e) =>
		log.error('lead štartový sweep hodil', {
			err: e instanceof Error ? e.message : String(e)
		})
	);
}
