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

/** Jedna položka objednávkového pickera typov skla (Odoo `code` ide do `glass_order.items[].type`). */
export interface GlassTypeOption {
	code: string;
	name: string;
	composition_spec: string;
}

export interface GlassTypesResult {
	items: GlassTypeOption[];
	/** 'odoo' = živý katalóg `montalu.glass.type`; 'local' = fallback z appkovho `glass_types`. */
	source: 'odoo' | 'local';
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
 * legitímne existovať vo viacerých systémoch — #214), `code = name = nazov` (lokálne appka nemá Odoo
 * kódy). LEN pre objednávkový picker — výpočtový katalóg sa nemení.
 */
function localFallback(): GlassTypesResult {
	const seen = new Set<string>();
	const items: GlassTypeOption[] = [];
	for (const g of listGlassTypes()) {
		const name = (g.nazov ?? '').trim();
		if (!name || seen.has(name)) continue;
		seen.add(name);
		items.push({ code: name, name, composition_spec: '' });
	}
	items.sort((a, b) => a.name.localeCompare(b.name, 'sk'));
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
		const rows = await searchReadJson2(
			cfg,
			GLASS_TYPE_MODEL,
			[['active', '=', true]],
			['code', 'name', 'composition_spec'],
			{ order: 'name' }
		);
		const items: GlassTypeOption[] = rows
			.map((r) => ({
				code: String(r.code ?? '').trim(),
				name: String(r.name ?? '').trim(),
				composition_spec: String(r.composition_spec ?? '').trim()
			}))
			// riadok bez `code` je pre `glass_order.items[].type` nepoužiteľný → vynechaj
			.filter((r) => r.code !== '');
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
