// #599 (krok 1 plánu „appka len z Odoo"): katalóg artiklov z Odoo `product.product` cez JSON-2
// `search_read`, kľúč = `default_code` (= Money kód; Odoo katalóg je syncovaný z Money, rovnaké kódy).
// JEDEN zdieľaný modul pre všetky čítania katalógu z Odoo (kontrola kódov odpisu `ceny.ts`
// `validateOdpisKody`, názov skla `odoo-nazov-skla.ts`, ďalšie kroky #599 — ceny/rozvin).
//
// Vzor `odoo-glass-types.ts` (`.claude/rules/glass-catalog.md` „NIKDY neblokuj page load na Odoo"):
//   - krátky PER-VOLANIE timeout (default 3 s) — pomalé Odoo nikdy nezdrží request,
//   - cache per kód 5 min pri úspechu (aj „Odoo kód nepozná"), nedostupnosť 60 s (rýchly auto-heal,
//     žiadny fan-out na Odoo počas výpadku),
//   - single-flight (súbežní volajúci zdieľajú JEDEN in-flight read),
//   - warn LEN RAZ za proces; nenakonfigurovaná integrácia (dev/test/CI) = bez volania, bez warnu.
//
// NIKDY nehádže — nedostupné Odoo vráti `{ zdroj: 'nedostupne' }` a volajúci rozhodne o fallbacku
// (validácia kódov → Money snapshot). Read-only, Money-neutrálne.
//
// `qty_available` sa ZÁMERNE NEČÍTA: technický účet appky naň na PROD dostane 403 (výpočet siaha na
// `mrp.bom`, sonda 30.9.) a jedno zakázané pole zhodí CELÝ read. Stav skladu ostáva na Money snapshote
// (#599 nález; alternatíva `stock.quant` čaká na rozhodnutie).
import { logger } from './log';
import { odooJson2Config, searchReadJson2, OdooJson2Error } from './odoo-json2';

const log = logger('odoo-katalog');

const CACHE_TTL_MS = 5 * 60 * 1000;
const FALLBACK_TTL_MS = 60 * 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 3000;
const PRODUCT_MODEL = 'product.product';
const FIELDS = ['default_code', 'name', 'uom_id', 'is_storable', 'active'];

/** Jeden aktívny Odoo produkt podľa `default_code`. */
export interface OdooProdukt {
	/** `default_code` (= Money kód artikla). */
	kod: string;
	/** Odoo `name` (`''` keď nevyplnené). */
	nazov: string;
	/** názov mernej jednotky z `uom_id` (napr. `m`, `Units`, `m²`; `''` keď chýba). */
	mj: string;
	/** Odoo `is_storable` („Track Inventory") — sleduje sa skladom. */
	skladovy: boolean;
}

export type OdooKatalogVysledok =
	/** Odoo odpovedalo: `produkty` obsahuje LEN kódy, ktoré Odoo pozná (aktívne). */
	| { zdroj: 'odoo'; produkty: Map<string, OdooProdukt> }
	/** Odoo sa nedá použiť: `config` = integrácia nenakonfigurovaná (dev/test/CI, očakávané),
	 *  `chyba` = HTTP/sieť/timeout/403 (skutočný výpadok, zalogovaný). */
	| { zdroj: 'nedostupne'; dovod: 'config' | 'chyba' };

/** kód → produkt (`null` = Odoo ho nepozná) s časom platnosti. */
const _cache = new Map<string, { produkt: OdooProdukt | null; exp: number }>();
let _inflight: Promise<void> | null = null;
/** Do kedy (ms) je Odoo považované za nedostupné — počas tejto doby sa nevolá (žiadny fan-out). */
let _nedostupneDo = 0;
let _warned = false;

/** TEST hook: vyprázdni cache + single-flight + nedostupnosť + „warn raz" stav. */
export function _resetOdooKatalogCache(): void {
	_cache.clear();
	_inflight = null;
	_nedostupneDo = 0;
	_warned = false;
}

/** Odoo char pole → string (`false`/`null` = prázdne; pasca #551 v `glass-catalog.md`). */
function s(v: unknown): string {
	if (v == null || v === false) return '';
	return String(v).trim();
}

/** Odoo many2one `[id, názov]` → názov (`false` = nevyplnené → `''`). */
function m2oNazov(v: unknown): string {
	return Array.isArray(v) && v.length >= 2 ? s(v[1]) : '';
}

function platne(kod: string, now: number): boolean {
	const c = _cache.get(kod);
	return !!c && c.exp > now;
}

/** Jeden `product.product` read pre `kody`; výsledok zapíše do `_cache` (alebo nastaví
 *  nedostupnosť). Nehádže. Volá sa LEN s nakonfigurovanou integráciou. */
async function nacitajKody(kody: string[], timeoutMs: number): Promise<void> {
	const cfg = odooJson2Config();
	if (!cfg) return;
	try {
		const rows = await searchReadJson2(cfg, PRODUCT_MODEL, [['default_code', 'in', kody]], FIELDS, {
			timeoutMs
		});
		const exp = Date.now() + CACHE_TTL_MS;
		const najdene = new Map<string, OdooProdukt>();
		for (const r of rows) {
			const kod = s(r.default_code);
			// ten istý kód môže mať viac produktov (varianty, odoo-erp 8058) — prvý vyhráva
			if (!kod || najdene.has(kod)) continue;
			najdene.set(kod, {
				kod,
				nazov: s(r.name),
				mj: m2oNazov(r.uom_id),
				skladovy: r.is_storable === true
			});
		}
		for (const kod of kody) _cache.set(kod, { produkt: najdene.get(kod) ?? null, exp });
		const chyba = kody.filter((k) => !najdene.has(k));
		log.debug('product.product read OK', { kody: kody.length, najdene: najdene.size });
		if (chyba.length > 0) log.info('kódy, ktoré Odoo katalóg nepozná', { kody: chyba });
	} catch (e) {
		_nedostupneDo = Date.now() + FALLBACK_TTL_MS;
		if (!_warned) {
			log.warn('Odoo product.product nedostupné — volajúci použije fallback', {
				status: e instanceof OdooJson2Error ? e.status : 0,
				err: e instanceof Error ? e.message : String(e)
			});
			_warned = true;
		}
	}
}

/**
 * Aktívne Odoo produkty pre dané kódy (JEDEN read pre chýbajúce, zvyšok z cache). NIKDY nehádže.
 * Prázdne/medzerové kódy sa ignorujú; ostatné sa porovnávajú PRESNE (bez trimu, case-sensitive —
 * pokazený kód = „Odoo ho nepozná", zámerne konzervatívne ako snapshot `getPriceRow`).
 */
export async function odooProduktyPreKody(
	kody: string[],
	opts: { timeoutMs?: number } = {}
): Promise<OdooKatalogVysledok> {
	if (!odooJson2Config()) return { zdroj: 'nedostupne', dovod: 'config' };
	const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
	const unikatne = [...new Set(kody.filter((k) => typeof k === 'string' && k.trim().length > 0))];

	if (unikatne.length > 0) {
		// single-flight: počkaj na KAŽDÝ bežiaci read (môže pokryť aj naše kódy), až potom dotiahni zvyšok
		while (_inflight) await _inflight;
		if (Date.now() < _nedostupneDo) return { zdroj: 'nedostupne', dovod: 'chyba' };
		const chybajuce = unikatne.filter((k) => !platne(k, Date.now()));
		if (chybajuce.length > 0) {
			const p = nacitajKody(chybajuce, timeoutMs);
			_inflight = p;
			try {
				await p;
			} finally {
				if (_inflight === p) _inflight = null;
			}
			if (Date.now() < _nedostupneDo) return { zdroj: 'nedostupne', dovod: 'chyba' };
		}
	}

	const produkty = new Map<string, OdooProdukt>();
	for (const kod of unikatne) {
		const p = _cache.get(kod)?.produkt;
		if (p) produkty.set(kod, p);
	}
	return { zdroj: 'odoo', produkty };
}
