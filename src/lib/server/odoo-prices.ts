// Kanál cien z Odoo (#5808 noha 3, #599 krok ceny — ROZHODNUTÉ owner 30.9. „ano prepnut ceny hned").
//
// ŽIADNY env flag: zdroj cien sa volí AUTOMATICKY podľa toho, či Odoo kanál ODPOVIE.
//   - materiál: `montalu.automatizacie.catalog/get_prices(codes=[…])` (odoo-erp
//     `company_montalu_automatizacie`, snapshot tvar `{generatedAt, rows:[{kod, nakupCennik,
//     nakupPoslednaFaktura, predajVo, mena, sklad, rozvin}], total}`),
//   - sklo: `montalu.glass.type` pole `price_m2` (€/m² z karty IZOS). SAMOSTATNÝ read — pole nesie
//     `groups=COST_VISIBILITY_GROUPS`, v spoločnom reade pickera (`odoo-glass-types.ts`) by 403
//     zhodilo celý picker na lokálny fallback.
// Kanál odpovedá (200) → volajúci (`ceny.ts`, `sklo-cena.ts`) berú ceny LEN z Odoo; chýbajúca cena =
// null (honest-null), nikdy Money per položka. Kanál chýba (404 — addon neinštalovaný, 403 — technický
// účet bez skupiny; dnešný PROD, odoo-erp 8706), výpadok, timeout alebo integrácia nenakonfigurovaná →
// `nedostupne` a volajúci ostane pri Money snapshote. Po sprístupnení v Odoo sa appka prepne SAMA
// (výpadok sa cachuje len 60 s) — bez releasu, bez reštartu.
//
// Vzor `odoo-katalog.ts` (`KodCache` z `odoo-kod-cache.ts`): 3 s timeout, cache per kód 5 min (aj
// „Odoo kód nepozná"), výpadok 60 s bez volania, single-flight, warn raz za výpadok. NIKDY nehádže.
import { logger } from './log';
import { callJson2, odooJson2Config, searchReadJson2, OdooJson2Error } from './odoo-json2';
import { KodCache } from './odoo-kod-cache';
import { hodnotyOdooTypov } from './glass-match';

const log = logger('odoo-prices');

const CENY_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 3000;
const CENY_MODEL = 'montalu.automatizacie.catalog';
const SKLO_MODEL = 'montalu.glass.type';
/** Jediný kľúč cache cien skla — `price_m2` sa číta pre VŠETKY aktívne typy naraz (desiatky). */
const SKLO_KLUC = '*';
/** Kód, ktorým `/health` sonduje kanál `get_prices` (bežný profil zasklenia; len čítanie). */
const SONDA_KOD = 'ZASP00014';

/** Jeden riadok `get_prices` (Odoo `false`/`None` → `null`). Ceny SUROVÉ — 0→null a `predajVo`
 *  non-ZASP gate robí `ceny.ts` `validateRow` rovnako ako pri snapshote. */
export interface OdooPriceRow {
	kod: string;
	nakupCennik: number | null;
	nakupPoslednaFaktura: number | null;
	predajVo: number | null;
	mena: string;
	sklad: number | null;
	/** m²/bm z `product.template.montalu_rozvin` (#369 lakovanie). */
	rozvin: number | null;
}

export interface OdooPricesResponse {
	generatedAt: string | null;
	rows: OdooPriceRow[];
	total: number;
}

/** Kanál sa nedá použiť: `config` = integrácia nenakonfigurovaná (dev/test/CI), `chyba` = 404/403/
 *  sieť/timeout/neplatná odpoveď (zalogované raz za výpadok v `KodCache`). */
type Nedostupne = { zdroj: 'nedostupne'; dovod: 'config' | 'chyba' };

export type OdooCenyVysledok =
	/** Kanál odpovedal: `ceny` obsahuje LEN kódy, ktoré Odoo vrátilo. */
	{ zdroj: 'odoo'; ceny: Map<string, OdooPriceRow> } | Nedostupne;

export type OdooSkloCenyVysledok =
	/** `price_m2` čitateľné: `value` typu skla (ako picker: `cennik_code`, pri zdieľanom/chýbajúcom
	 *  kóde `name`) → €/m² (`null` = 0/nevyplnené/nejednoznačné). */
	{ zdroj: 'odoo'; cenaPreHodnotu: Map<string, number | null> } | Nedostupne;

/** Zdroj cien pre UI a `/health`: `odoo` = kanál odpovedá, `snapshot` = denný Money snapshot. */
export type CenyZdroj = 'odoo' | 'snapshot';

/** Validácia a typovanie odpovede `get_prices`. Bez poľa `rows` HÁDŽE — cudzia/prázdna 200 odpoveď
 *  nesmie vyzerať ako „Odoo nepozná žiadnu cenu" (prepla by zdroj na Odoo so všetkým neznámym). */
function parseOdooPricesResponse(raw: unknown): OdooPricesResponse {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new OdooJson2Error('odoo-prices: odpoveď nie je objekt');
	}
	const obj = raw as Record<string, unknown>;
	if (!Array.isArray(obj.rows)) {
		throw new OdooJson2Error('odoo-prices: odpoveď nemá pole rows');
	}
	const generatedAt = typeof obj.generatedAt === 'string' ? obj.generatedAt : null;
	const total = typeof obj.total === 'number' ? obj.total : 0;

	const rows: OdooPriceRow[] = [];
	for (const r of obj.rows) {
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
			sklad: numOrNull(row.sklad),
			rozvin: numOrNull(row.rozvin)
		});
	}

	return { generatedAt, rows, total };
}

/** Odoo vracia `null`/`None` pre chýbajúcu hodnotu; `False` (boolean) pre prázdne Odoo pole sa tu
 *  normalizuje na `null` (nikdy `false` do TS typového systému). */
function numOrNull(v: unknown): number | null {
	if (v === null || v === undefined || v === false) return null;
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	return null;
}

/** Odoo char pole → string (`false`/`null` = prázdne; pasca #551 v `glass-catalog.md`). */
function s(v: unknown): string {
	if (v == null || v === false) return '';
	return String(v).trim();
}

const _ceny = new KodCache<OdooPriceRow>(
	`${CENY_MODEL}.get_prices`,
	CENY_TTL_MS,
	async (kody, timeoutMs) => {
		const cfg = odooJson2Config()!;
		const raw = await callJson2(cfg, CENY_MODEL, 'get_prices', { codes: kody }, { timeoutMs });
		const data = parseOdooPricesResponse(raw);
		const najdene = new Map<string, OdooPriceRow>();
		for (const r of data.rows) if (!najdene.has(r.kod)) najdene.set(r.kod, r);
		log.debug('get_prices OK', {
			kody: kody.length,
			najdene: najdene.size,
			generatedAt: data.generatedAt
		});
		return najdene;
	},
	log
);

const _skloCeny = new KodCache<Map<string, number | null>>(
	`${SKLO_MODEL}.price_m2`,
	CENY_TTL_MS,
	async (_kody, timeoutMs) => {
		const cfg = odooJson2Config()!;
		const rows = await searchReadJson2(
			cfg,
			SKLO_MODEL,
			[['active', '=', true]],
			['name', 'cennik_code', 'price_m2'],
			{ timeoutMs }
		);
		const typy = rows
			.map((r) => ({
				value: s(r.cennik_code) || s(r.name),
				name: s(r.name),
				// 0 = karta nemá riadok dodávateľa skla / nie je v Sklo IZOS → neznáma (nie 0 €)
				cena: typeof r.price_m2 === 'number' && r.price_m2 > 0 ? r.price_m2 : null
			}))
			.filter((t) => t.value !== '');
		// kľúč = TÁ ISTÁ `value`, akú dostane typ v pickeri — ZDIEĽANÉ pravidlo `hodnotyOdooTypov`
		// (review #599): rovnaký názov s rôznym kódom (rámik AL/TH) nesie každý svoju cenu
		const ceny = new Map<string, number | null>(
			hodnotyOdooTypov(typy).items.map((t) => [t.value, t.cena])
		);
		log.debug('price_m2 OK', { typy: ceny.size });
		return new Map([[SKLO_KLUC, ceny]]);
	},
	log
);

/** Posledný zistený zdroj per kanál — log pri ZMENE (nie pri každom volaní). */
const _posledny: { material: CenyZdroj | null; sklo: CenyZdroj | null } = {
	material: null,
	sklo: null
};

/**
 * Zaznamenaj zdroj cien kanála; pri zmene (aj prvé zistenie po štarte) INFO log `zdroj cien`.
 * Volajú ho `ceny.ts` (materiál) a `sklo-cena.ts` (sklo) pri každom výpočte ceny.
 */
export function zaznamenajZdroj(kanal: 'material' | 'sklo', zdroj: CenyZdroj): void {
	const z = _posledny[kanal];
	if (z === zdroj) return;
	_posledny[kanal] = zdroj;
	log.info('zdroj cien sa zmenil', { kanal, z, na: zdroj });
}

/** TEST hook: vyprázdni cache oboch kanálov + posledný zaznamenaný zdroj. */
export function _resetOdooCenyCache(): void {
	_ceny.reset();
	_skloCeny.reset();
	_posledny.material = null;
	_posledny.sklo = null;
}

/** Prázdne/medzerové kódy von, duplicity von; ostatné PRESNE (bez trimu, case-sensitive). */
function unikatneKody(kody: string[]): string[] {
	return [...new Set(kody.filter((k) => typeof k === 'string' && k.trim().length > 0))];
}

/**
 * Ceny materiálu z Odoo `get_prices` pre dané kódy (JEDEN request pre kódy mimo platnej cache).
 * NIKDY nehádže. `{zdroj:'odoo'}` = kanál odpovedal (kód, ktorý v mape nie je, Odoo nepozná →
 * cena neznáma), inak `nedostupne` (volajúci ostane pri Money snapshote).
 */
export async function odooCenyPreKody(
	kody: string[],
	opts: { timeoutMs?: number } = {}
): Promise<OdooCenyVysledok> {
	if (!odooJson2Config()) return { zdroj: 'nedostupne', dovod: 'config' };
	const unikatne = unikatneKody(kody);
	// prázdna sada by `zabezpec` splnila bez volania — stav kanála sa aj tak musí zistiť (sonda)
	const zistit = unikatne.length > 0 ? unikatne : [SONDA_KOD];
	if (!(await _ceny.zabezpec(zistit, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)))
		return { zdroj: 'nedostupne', dovod: 'chyba' };
	const ceny = new Map<string, OdooPriceRow>();
	for (const kod of unikatne) {
		const r = _ceny.hodnota(kod);
		if (r) ceny.set(kod, r);
	}
	return { zdroj: 'odoo', ceny };
}

/**
 * Ceny skla €/m² z Odoo `montalu.glass.type.price_m2` (všetky aktívne typy, jeden read, cache 5 min).
 * NIKDY nehádže; 403 (pole je cost-visibility) / 404 / výpadok → `nedostupne`.
 */
export async function odooSkloCenyM2(
	opts: { timeoutMs?: number } = {}
): Promise<OdooSkloCenyVysledok> {
	if (!odooJson2Config()) return { zdroj: 'nedostupne', dovod: 'config' };
	if (!(await _skloCeny.zabezpec([SKLO_KLUC], opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)))
		return { zdroj: 'nedostupne', dovod: 'chyba' };
	const cenaPreHodnotu = _skloCeny.hodnota(SKLO_KLUC) ?? new Map<string, number | null>();
	return { zdroj: 'odoo', cenaPreHodnotu };
}

/**
 * Aktuálny zdroj cien pre `/health` (verejné — len `odoo`/`snapshot`, žiadne ceny). Sonduje OBA
 * kanály cez tie isté cache (max 1 request / 5 min pri úspechu, 1 / 60 s pri výpadku).
 * Sklo je `odoo`, keď odpovedá `price_m2` ALEBO `get_prices` (TS kódy skiel sú v `get_prices`, IZOS).
 */
export async function zistiCenyZdroj(): Promise<{ material: CenyZdroj; sklo: CenyZdroj }> {
	const [ceny, sklo] = await Promise.all([odooCenyPreKody([SONDA_KOD]), odooSkloCenyM2()]);
	const material: CenyZdroj = ceny.zdroj === 'odoo' ? 'odoo' : 'snapshot';
	return { material, sklo: sklo.zdroj === 'odoo' || material === 'odoo' ? 'odoo' : 'snapshot' };
}

// Exposed for testing
export { parseOdooPricesResponse as _parseOdooPricesResponse };
