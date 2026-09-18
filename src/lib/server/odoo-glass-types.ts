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
// In-process cache ~5 min (aj fallback) → auto-heal: po nasadení/oprave Odoo sa zoznam obnoví sám.
import { logger } from './log';
import { odooJson2Config, searchReadJson2, OdooJson2Error } from './odoo-json2';
import { listGlassTypes } from './db';

const log = logger('odoo-glass-types');

const CACHE_TTL_MS = 5 * 60 * 1000;
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

let _cache: { result: GlassTypesResult; ts: number } | null = null;
let _warned = false;

/** TEST hook: vyprázdni cache (aby ďalší test videl fetch/fallback znova). */
export function _resetGlassTypesCache(): void {
	_cache = null;
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
		items.push({ value: name, label: name, category: '' });
	}
	items.sort((a, b) => a.label.localeCompare(b.label, 'sk'));
	return { items, source: 'local' };
}

/**
 * Zoznam typov skla pre objednávkový picker. Živý `montalu.glass.type` z Odoo (aktívne, zoradené
 * podľa názvu), pri chybe/nedostupnosti lokálny fallback. In-process cache ~5 min. NIKDY nehádže.
 */
export async function fetchGlassTypes(): Promise<GlassTypesResult> {
	const now = Date.now();
	if (_cache && now - _cache.ts < CACHE_TTL_MS) return _cache.result;

	const cfg = odooJson2Config();
	if (!cfg) {
		// integrácia nie je nakonfigurovaná (dev/test) — očakávané, NIE chyba → žiadny warn
		const local = localFallback();
		_cache = { result: local, ts: now };
		return local;
	}

	try {
		// #546: SKUTOČNÉ polia `montalu.glass.type` (relay #540): name/category/cennik_code/composition/
		// active — nie code/composition_spec (tie na PROD → Odoo 500 → fallback). `value = cennik_code
		// || name` (Odoo `resolve_glass_type` páruje kód → presný názov → zloženie).
		const rows = await searchReadJson2(
			cfg,
			GLASS_TYPE_MODEL,
			[['active', '=', true]],
			['name', 'category', 'cennik_code', 'composition', 'active'],
			{ order: 'name' }
		);
		const mapped: GlassTypeOption[] = rows
			.map((r) => {
				const name = s(r.name);
				const cennik = s(r.cennik_code);
				const composition = s(r.composition);
				return {
					value: cennik || name,
					label: composition ? `${name} · ${composition}` : name,
					category: s(r.category)
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
		_cache = { result, ts: now };
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
		_cache = { result: local, ts: now };
		return local;
	}
}
