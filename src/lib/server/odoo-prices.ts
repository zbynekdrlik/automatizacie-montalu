// #5808 noha 3: čítanie cien materiálu z Odoo namiesto Money snapshotu.
//
// Volá `montalu.automatizacie.catalog.get_prices` cez json/2 a vracia
// PRESNE rovnaký tvar, aký `ceny.ts::maybeImportSnapshot` očakáva:
//   { generatedAt: string | null, rows: PriceRow[], total: number }
//
// Env flag `ODOO_PRICES_ENABLED=1` zapne tento kanál; inak off (default).
// Keď Odoo volanie zlyhá → vráti `null` (volajúci fallbackne na snapshot).
//
// GAP: Odoo endpoint nevracia `rozvin` (m²/bm pre lakovanie, #369) — appka
// ho dostáva len zo snapshot súboru. Keď zdroj je Odoo, `rozvin` bude `null`
// (honest-null, `computeLakovanie` to zvládne). Follow-up: pridať `rozvin`
// do Odoo endpointu.
import { logger } from './log';
import { callJson2, json2Config, OdooJson2Error, type Json2Config } from './odoo-json2';

const log = logger('odoo-prices');

export interface OdooPriceRow {
	kod: string;
	nakupCennik: number | null;
	nakupPoslednaFaktura: number | null;
	predajVo: number | null;
	mena: string;
	sklad: number | null;
}

export interface OdooPricesResponse {
	generatedAt: string | null;
	rows: OdooPriceRow[];
	total: number;
}

/** Je Odoo-prices kanál zapnutý? */
export function isOdooPricesEnabled(): boolean {
	return process.env.ODOO_PRICES_ENABLED === '1';
}

/**
 * Stiahne celý katalóg cien z Odoo cez json/2 `get_prices`.
 *
 * @returns Rozparsovaná odpoveď v snapshot tvare, alebo `null` pri chybe
 *          (volajúci fallbackne na lokálny snapshot).
 */
export async function fetchOdooPrices(cfgOverride?: Json2Config): Promise<OdooPricesResponse | null> {
	const cfg = cfgOverride ?? json2Config();
	if (!cfg) {
		log.debug('odoo-prices vypnuté (chýba ODOO_JSON2_URL/ODOO_JSON2_API_KEY)');
		return null;
	}
	try {
		const raw = await callJson2<unknown>(
			cfg,
			'montalu.automatizacie.catalog',
			'get_prices'
		);
		return parseOdooPricesResponse(raw);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (e instanceof OdooJson2Error) {
			log.warn('odoo-prices: Odoo volanie zlyhalo — fallback na snapshot', { err: msg });
		} else {
			log.error('odoo-prices: neočakávaná chyba', { err: msg });
		}
		return null;
	}
}

/** Validácia a typovanie odpovede z Odoo. */
function parseOdooPricesResponse(raw: unknown): OdooPricesResponse {
	if (!raw || typeof raw !== 'object') {
		throw new OdooJson2Error('odoo-prices: odpoveď nie je objekt');
	}
	const obj = raw as Record<string, unknown>;
	const generatedAt = typeof obj.generatedAt === 'string' ? obj.generatedAt : null;
	const total = typeof obj.total === 'number' ? obj.total : 0;
	const rawRows = Array.isArray(obj.rows) ? obj.rows : [];

	const rows: OdooPriceRow[] = [];
	for (const r of rawRows) {
		if (!r || typeof r !== 'object') continue;
		const row = r as Record<string, unknown>;
		const kod = typeof row.kod === 'string' ? row.kod.trim() : '';
		if (!kod) continue;
		rows.push({
			kod,
			nakupCennik: numOrNull(row.nakupCennik),
			nakupPoslednaFaktura: numOrNull(row.nakupPoslednaFaktura),
			predajVo: numOrNull(row.predajVo),
			mena: typeof row.mena === 'string' && row.mena.trim() ? row.mena.trim() : 'EUR',
			sklad: numOrNull(row.sklad)
		});
	}

	return { generatedAt, rows, total };
}

/** Odoo vracia `null`/`None` pre chýbajúcu cenu; `False` (boolean) pre prázdne Odoo pole
 *  sa tu normalizuje na `null` (nikdy `false` do TS typového systému). */
function numOrNull(v: unknown): number | null {
	if (v === null || v === undefined || v === false) return null;
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	return null;
}

// Exposed for testing
export { parseOdooPricesResponse as _parseOdooPricesResponse };
