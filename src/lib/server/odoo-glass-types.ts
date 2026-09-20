// #540: zoznam typov skla z Odoo `montalu.glass.type` pre OBJEDNÁVKOVÝ picker (`/objednavka-skla`).
//
// SAMOSLUŽNÝ zdroj pravdy: Patrik si typ skla dohodí v Odoo a appka ho ponúkne v objednávke BEZ
// releasu. Money-NEUTRÁLNE — je to LEN ordering zoznam pre `glass_order.items[].type`; výpočtový
// katalóg `glass_types` (sklo → skloHrubka → profily → Money kódy) je NEDOTKNUTÝ a ostáva v SQLite
// migráciách (viď `.claude/rules/glass-catalog.md`).
//
// Vlastný modul (nie v `odoo-json2.ts`) zámerne: `odoo-json2.ts` je ČISTÝ transport bez `db`
// väzby (jeho testy ho importujú bez native better-sqlite3). Fallback tu potrebuje lokálny katalóg
// (`listGlassTypes` → `db`), preto žije tu, nad tenkým `searchReadJson2` z transportu.
//
// Fallback: pri akomkoľvek zlyhaní Odoo readu (403/sieť/timeout) alebo keď integrácia nie je
// nakonfigurovaná (dev/test) vráti LOKÁLNY zoznam odvodený z `glass_types` — nikdy tichý prázdny
// select. Warn LEN RAZ za proces (skutočná chyba; config-absent v deve nie je chyba, nevaruje).
// In-process cache: 5 min pri Odoo úspechu, 60 s pri fallbacku (rýchly auto-heal, žiadny fan-out).
import { logger } from './log';
import { odooJson2Config, searchReadJson2, OdooJson2Error } from './odoo-json2';
import { listGlassTypes } from './db';
import { matchOdooGlassType } from './glass-match';

const log = logger('odoo-glass-types');

const CACHE_TTL_MS = 5 * 60 * 1000;
const FALLBACK_TTL_MS = 60 * 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 3000;
const GLASS_TYPE_MODEL = 'montalu.glass.type';

/**
 * Jedna položka objednávkového pickera typov skla. `value` sa uloží do `typ_skla` =
 * `glass_order.items[].glass_type` (Odoo `resolve_glass_type` páruje `cennik_code` → presný `name`
 * → `composition`). `value = cennik_code || name` (keď `cennik_code` chýba, posiela sa presný
 * `name`). `label` = `name` (+ ' · ' + composition, ak je) pre operátora. `category` = Odoo
 * `montalu.glass.type.category` (skupina — IZO / VSG / jednosklo …).
 */
export interface GlassTypeOption {
	value: string;
	label: string;
	category: string;
	/** #556: surový Odoo `name` (cenníkový názov pre nárezák popis + matcher). */
	name: string;
	/** #556: surový Odoo `composition` (napr. „4/8/4") — matcher normalizuje na „4-8-4". */
	composition: string;
}

export interface GlassTypesResult {
	items: GlassTypeOption[];
	/** 'odoo' = živý katalóg `montalu.glass.type`; 'local' = fallback z appkovho `glass_types`. */
	source: 'odoo' | 'local';
}

/**
 * Normalizuj surovú Odoo JSON-2 hodnotu char poľa na string (#551). Odoo `search_read` vracia pre
 * NEVYPLNENÉ char polia boolean `false` (nie `null`/`''`); `String(false ?? '')` = `"false"` (po
 * `.trim()` truthy) → typy bez `cennik_code` dostávali `value === "false"` → duplicitné `{#each …
 * (t.value)}` kľúče → PROD `each_key_duplicate` hydration crash. `false` (a `null`/`undefined`) =
 * prázdne pole. Rovnaký gotcha rieši `odoo-prices.ts:numOrNull` pre číselné polia.
 */
function s(v: unknown): string {
	if (v == null || v === false) return '';
	return String(v).trim();
}

let _cache: { result: GlassTypesResult; ts: number; ttl: number } | null = null;
let _inflight: Promise<GlassTypesResult> | null = null;
let _warned = false;

/** TEST hook: vyprázdni cache (aby ďalší test videl fetch/fallback znova). */
export function _resetGlassTypesCache(): void {
	_cache = null;
	_inflight = null;
}

/** TEST hook: vynuluj „warn raz za proces" state. */
export function _resetGlassTypesWarn(): void {
	_warned = false;
}

/**
 * Lokálny fallback zoznam z appkovho `glass_types` katalógu. Dedup podľa názvu (to isté sklo môže
 * legitímne existovať vo viacerých systémoch — #214), `value = label = nazov` (lokálne appka nemá
 * Odoo kódy ani kategórie). LEN pre objednávkový picker — výpočtový katalóg sa nemení.
 */
function localFallback(): GlassTypesResult {
	const seen = new Set<string>();
	const items: GlassTypeOption[] = [];
	for (const g of listGlassTypes()) {
		const name = (g.nazov ?? '').trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		// #556: lokálny fallback nemá Odoo composition/category → prázdne (matcher gatuje na
		// source==='odoo', takže sa lokálne názvy neparujú samé na seba).
		items.push({ value: name, label: name, category: '', name, composition: '' });
	}
	items.sort((a, b) => a.label.localeCompare(b.label, 'sk'));
	return { items, source: 'local' };
}

/**
 * Zoznam typov skla pre objednávkový picker. Živý `montalu.glass.type` z Odoo (aktívne, zoradené
 * podľa názvu), pri chybe/nedostupnosti/timeoute lokálny fallback. NIKDY nehádže a NIKDY neblokuje
 * page load na dlho: `timeoutMs` (default 3000) obmedzí Odoo read, aby pomalé-ale-nepadajúce Odoo
 * nezdržalo `+page.server.ts` load nad E2E limit (#551 noha 2). In-process cache: 5 min pre Odoo
 * úspech, len 60 s pre fallback (rýchly auto-heal + žiadny fan-out na každý request). Single-flight:
 * súbežní volajúci zdieľajú JEDEN in-flight fetch (žiadne thundering-herd na Odoo).
 */
export async function fetchGlassTypes(
	opts: { timeoutMs?: number } = {}
): Promise<GlassTypesResult> {
	const now = Date.now();
	if (_cache && now - _cache.ts < _cache.ttl) return _cache.result;
	// single-flight: ak už fetch beží, počkaj na ten istý promise (žiadny thundering herd na Odoo)
	if (_inflight) return _inflight;
	_inflight = _doFetch(opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
	try {
		return await _inflight;
	} finally {
		_inflight = null;
	}
}

/**
 * Jeden fetch typov skla (bez cache/single-flight vrstvy — tú rieši `fetchGlassTypes`). Nastaví
 * `_cache` s TTL podľa výsledku: Odoo úspech → 5 min, fallback (chyba/timeout/config chýba) → 60 s.
 */
async function _doFetch(timeoutMs: number): Promise<GlassTypesResult> {
	const cfg = odooJson2Config();
	if (!cfg) {
		// integrácia nie je nakonfigurovaná (dev/test) — očakávané, NIE chyba → žiadny warn
		const local = localFallback();
		_cache = { result: local, ts: Date.now(), ttl: FALLBACK_TTL_MS };
		return local;
	}

	try {
		// #546: SKUTOČNÉ polia `montalu.glass.type` (relay #540): name/category/cennik_code/composition/
		// active — nie code/composition_spec (tie na PROD → Odoo 500 → fallback). `value = cennik_code
		// || name` (Odoo `resolve_glass_type` páruje kód → presný názov → zloženie). #551 noha 2: krátky
		// `timeoutMs`, aby pomalé Odoo nezdržalo page load nad E2E limit.
		const rows = await searchReadJson2(
			cfg,
			GLASS_TYPE_MODEL,
			[['active', '=', true]],
			['name', 'category', 'cennik_code', 'composition', 'active'],
			{ order: 'name', timeoutMs }
		);
		const mapped: GlassTypeOption[] = rows
			.map((r) => {
				const name = s(r.name);
				const cennik = s(r.cennik_code);
				const composition = s(r.composition);
				return {
					value: cennik || name,
					label: composition ? `${name} · ${composition}` : name,
					category: s(r.category),
					// #556: surové polia pre matcher (`glass-match.ts`) + nárezák popis
					name,
					composition
				};
			})
			// riadok bez cennik_code AJ bez name je pre `glass_order.items[].glass_type` nepoužiteľný
			.filter((r) => r.value !== '');
		// #551: dedupe podľa `value` (kľúč pickera) — Odoo dáta nesmú picker zhodiť duplicitným
		// `{#each … (t.value)}` kľúčom (rovnaký `Set` idiom ako `localFallback`). Warn RAZ za fetch.
		const seen = new Set<string>();
		const items: GlassTypeOption[] = [];
		const dupes = new Set<string>();
		for (const it of mapped) {
			if (seen.has(it.value)) {
				dupes.add(it.value);
				continue;
			}
			seen.add(it.value);
			items.push(it);
		}
		if (dupes.size > 0) {
			log.warn('fetchGlassTypes: duplicitné hodnoty typov skla z Odoo — deduplikované', {
				dupes: [...dupes]
			});
		}
		const result: GlassTypesResult = { items, source: 'odoo' };
		_cache = { result, ts: Date.now(), ttl: CACHE_TTL_MS };
		return result;
	} catch (e) {
		if (!_warned) {
			const status = e instanceof OdooJson2Error ? e.status : 0;
			log.warn(
				'fetchGlassTypes: Odoo montalu.glass.type nedostupné — používam lokálny fallback zoznam',
				{ status, err: e instanceof Error ? e.message : String(e) }
			);
			_warned = true;
		}
		const local = localFallback();
		_cache = { result: local, ts: Date.now(), ttl: FALLBACK_TTL_MS };
		return local;
	}
}

/**
 * #556: pre riadky objednávky skla vytvorené Z VÝPOČTU (producenti zasklenia/fix/pergola) —
 * jednoznačnú zhodu lokálneho `typSkla` na Odoo `montalu.glass.type` uloží ako Odoo `value`
 * (`cennik_code || name`), takže riadok ide do Odoo presne (Patrik: „takto vie presné aké sklo
 * požadujem"). Pri „viac"/„ziadne" ostáva lokálny názov (operátor rozhodne na podklade cez badge
 * „nepriradené"). GATOVANÉ na `source==='odoo'` — pri lokálnom fallbacku (Odoo nedostupné) sa NIČ
 * nepriradzuje (bez Odoo dát niet na čo). Fetch RAZ pre celé pole (zdieľaná cache). Money-NEUTRÁLNE.
 */
export async function priradOdooTypy<T extends { typSkla: string }>(polozky: T[]): Promise<T[]> {
	if (polozky.length === 0) return polozky;
	const { items, source } = await fetchGlassTypes();
	if (source !== 'odoo') return polozky;
	return polozky.map((p) => {
		const m = matchOdooGlassType(p.typSkla, items);
		if (m.istota === 'jednoznacne' && m.typ) {
			// #556 review: zhoda je len zloženie ∧ kategória (pokov/plyn/Ug sa nerozlišuje) — logni
			// KAŽDÉ jednoznačné priradenie, aby bolo auditovateľné (kolízia pri jedno-variantovom katalógu).
			log.info('priradOdooTypy: lokálne sklo priradené na Odoo typ (jednoznačné)', {
				lokalne: p.typSkla,
				odoo: m.typ.value
			});
			return { ...p, typSkla: m.typ.value };
		}
		return p;
	});
}
