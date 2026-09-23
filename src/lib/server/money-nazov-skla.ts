// #563 (d): zobrazovací názov typu skla na podklade objednávky = REÁLNY Money názov článku
// (Patrik, Odoo úloha 625: „Typ skla musí byť podľa reálneho názvu !!!", vzor
// „Izolačné sklo 4/16/4- číre (Ug=1,1)"). LEN ZOBRAZENIE — uložený `typ_skla`, `glass_types.money_kod`
// ani Odoo payload sa NEMENIA → Money odpis byte-identický, žiadna migrácia.
//
// Reťazec (prvý úspech vyhráva, nikdy chyba):
//   1. lokálny názov → `glass_types.money_kod` (len jednoznačný, `glassMoneyKodPodlaNazvu`) →
//      Odoo `product.product` `default_code` → `name` (katalóg syncovaný z Money),
//   2. Odoo cenníková hodnota (`typ_skla` z pickera = `cennik_code || name`) → `montalu.glass.type.name`
//      z existujúcej `fetchGlassTypes` cache,
//   3. inak uložený `typ_skla` (lokálny názov).
//
// Vzor `odoo-glass-types.ts`: krátky timeout (3 s — page load sa nikdy nezdrží), in-process cache
// 5 min pri úspechu / 60 s pri chybe (rýchly auto-heal), single-flight (žiadny fan-out na Odoo),
// warn LEN RAZ za proces; nenakonfigurovaná integrácia (dev/test) = očakávané, bez volania + bez warnu.
// Dávka: JEDEN `product.product` read pre všetky chýbajúce kódy riadkov podkladu.
import { logger } from './log';
import { odooJson2Config, searchReadJson2, OdooJson2Error } from './odoo-json2';
import { glassMoneyKodPodlaNazvu } from './db';
import { fetchGlassTypes } from './odoo-glass-types';

const log = logger('money-nazov-skla');

const CACHE_TTL_MS = 5 * 60 * 1000;
const FALLBACK_TTL_MS = 60 * 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 3000;
const PRODUCT_MODEL = 'product.product';

/** Money kód → Money názov (`null` = Odoo ho nepozná / chyba) s časom platnosti. */
const _cache = new Map<string, { nazov: string | null; exp: number }>();
let _inflight: Promise<void> | null = null;
let _warned = false;

/** TEST hook: vyprázdni cache + single-flight + „warn raz" stav. */
export function _resetMoneyNazvyCache(): void {
	_cache.clear();
	_inflight = null;
	_warned = false;
}

/** Odoo char pole → string (`false`/`null` = prázdne; rovnaká pasca ako `odoo-glass-types` #551). */
function s(v: unknown): string {
	if (v == null || v === false) return '';
	return String(v).trim();
}

function platne(kod: string, now: number): boolean {
	const c = _cache.get(kod);
	return !!c && c.exp > now;
}

/** Jeden `product.product` read pre `kody`; výsledok (aj neúspech) zapíše do `_cache`. Nehádže. */
async function nacitajKody(kody: string[], timeoutMs: number): Promise<void> {
	const cfg = odooJson2Config();
	if (!cfg) return; // dev/test bez integrácie — očakávané, nič sa necacheuje
	try {
		const rows = await searchReadJson2(
			cfg,
			PRODUCT_MODEL,
			[['default_code', 'in', kody]],
			['default_code', 'name'],
			{ timeoutMs }
		);
		const exp = Date.now() + CACHE_TTL_MS;
		const nazvy = new Map<string, string>();
		for (const r of rows) {
			const kod = s(r.default_code);
			const nazov = s(r.name);
			if (kod && nazov && !nazvy.has(kod)) nazvy.set(kod, nazov);
		}
		for (const kod of kody) _cache.set(kod, { nazov: nazvy.get(kod) ?? null, exp });
		const chyba = kody.filter((k) => !nazvy.has(k));
		if (chyba.length > 0)
			log.info('Money názov skla: kód nie je v Odoo katalógu — zobrazí sa lokálny názov', {
				kody: chyba
			});
	} catch (e) {
		if (!_warned) {
			log.warn('Money názov skla: Odoo product.product nedostupné — zobrazím lokálne názvy', {
				status: e instanceof OdooJson2Error ? e.status : 0,
				err: e instanceof Error ? e.message : String(e)
			});
			_warned = true;
		}
		const exp = Date.now() + FALLBACK_TTL_MS;
		for (const kod of kody) _cache.set(kod, { nazov: null, exp });
	}
}

/** Money názvy pre kódy (z cache; chýbajúce dotiahne JEDNÝM readom, single-flight). */
async function nazvyPreKody(kody: string[], timeoutMs: number): Promise<Map<string, string>> {
	if (kody.length > 0) {
		// súbežný fetch už beží → počkaj naň (môže pokryť aj naše kódy), potom dotiahni zvyšok
		if (_inflight) await _inflight;
		const chybajuce = kody.filter((k) => !platne(k, Date.now()));
		if (chybajuce.length > 0) {
			_inflight = nacitajKody(chybajuce, timeoutMs);
			try {
				await _inflight;
			} finally {
				_inflight = null;
			}
		}
	}
	const out = new Map<string, string>();
	for (const kod of kody) {
		const n = _cache.get(kod)?.nazov;
		if (n) out.set(kod, n);
	}
	return out;
}

/**
 * Zobrazovacie názvy typov skla pre riadky podkladu: `{ [typSkla]: názov }` pre KAŽDÝ vstupný typ
 * (fallback = samotný `typSkla`). NIKDY nehádže a neblokuje page load dlhšie než `timeoutMs`.
 */
export async function moneyNazvySkiel(
	typy: string[],
	opts: { timeoutMs?: number } = {}
): Promise<Record<string, string>> {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
	const unikatne = [...new Set(typy.map((t) => t.trim()).filter((t) => t.length > 0))];
	const out: Record<string, string> = {};
	for (const t of typy) out[t] = t;
	if (unikatne.length === 0) return out;

	// 1. lokálny názov → jednoznačný Money kód → Money názov z Odoo katalógu
	const kodPreTyp = new Map<string, string>();
	for (const t of unikatne) {
		const kod = glassMoneyKodPodlaNazvu(t);
		if (kod) kodPreTyp.set(t, kod);
	}
	const moneyNazvy = await nazvyPreKody([...new Set(kodPreTyp.values())], timeoutMs);

	// 2. Odoo cenníková hodnota (picker) → názov `montalu.glass.type` (zdieľaná cache pickera)
	const zvysok = unikatne.filter((t) => !moneyNazvy.has(kodPreTyp.get(t) ?? ''));
	const odooNazvy = new Map<string, string>();
	if (zvysok.length > 0) {
		const { items } = await fetchGlassTypes({ timeoutMs });
		for (const it of items)
			if (it.name && !odooNazvy.has(it.value)) odooNazvy.set(it.value, it.name);
	}

	for (const t of typy) {
		const k = t.trim();
		if (!k) continue;
		const kod = kodPreTyp.get(k);
		out[t] = (kod && moneyNazvy.get(kod)) || odooNazvy.get(k) || t;
	}
	return out;
}

/** Jeden typ skla → zobrazovací (Money) názov; pohodlný obal nad `moneyNazvySkiel`. */
export async function moneyNazovSkla(typSkla: string): Promise<string> {
	// `moneyNazvySkiel` vracia kľúč pre KAŽDÝ vstupný typ (fallback = typ sám)
	return (await moneyNazvySkiel([typSkla]))[typSkla]!;
}
