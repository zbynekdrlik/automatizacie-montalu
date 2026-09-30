// #599 (plán „appka len z Odoo"): katalóg artiklov + stav skladu z Odoo cez JSON-2 `search_read`,
// kľúč = `default_code` (= Money kód; Odoo katalóg je syncovaný z Money, rovnaké kódy).
// JEDEN zdieľaný modul pre všetky čítania artiklov z Odoo:
//   - `odooProduktyPreKody` — `product.product` (kontrola kódov odpisu `ceny.ts` `validateOdpisKody`,
//     názov skla `odoo-nazov-skla.ts`, ďalšie kroky #599 — ceny/rozvin),
//   - `odooSkladPreKody` — stav skladu = súčet `stock.quant.quantity` na INTERNÝCH lokáciách
//     (`ceny.ts` `skladoveVarovania`, krok 3).
//
// Vzor `odoo-glass-types.ts` (`.claude/rules/glass-catalog.md` „NIKDY neblokuj page load na Odoo"),
// spoločný pre oba ready cez `KodCache`:
//   - krátky PER-VOLANIE timeout (default 3 s) — pomalé Odoo nikdy nezdrží request,
//   - cache per kód (katalóg 5 min, aj „Odoo kód nepozná"; sklad 60 s — hýbe sa), nedostupnosť 60 s
//     (rýchly auto-heal, žiadny fan-out na Odoo počas výpadku),
//   - single-flight (súbežní volajúci zdieľajú JEDEN in-flight read),
//   - warn LEN RAZ za výpadok (po zotavení info + reset); nenakonfigurovaná integrácia (dev/test/CI)
//     = bez volania, bez warnu.
//
// NIKDY nehádže — nedostupné Odoo vráti `{ zdroj: 'nedostupne' }` a volajúci rozhodne o fallbacku
// (Money snapshot). Read-only, Money-neutrálne.
//
// `qty_available` sa ZÁMERNE NEČÍTA: technický účet appky naň na PROD dostane 403 (výpočet siaha na
// `mrp.bom`, sonda 30.9.) a jedno zakázané pole zhodí CELÝ read. Sklad preto ide cez `stock.quant`
// (technický účet ho číta, sonda 30.9.: 168 produktov / 98 ms, jediná interná lokácia PKO/Zásoby).
import { logger } from './log';
import { odooJson2Config, searchReadJson2 } from './odoo-json2';
import { KodCache } from './odoo-kod-cache';

const log = logger('odoo-katalog');

const KATALOG_TTL_MS = 5 * 60 * 1000;
/** Sklad sa hýbe (odpisy, príjemky) — kratšia platnosť než katalóg; varovanie je len signál. */
const SKLAD_TTL_MS = 60 * 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 3000;
const PRODUCT_MODEL = 'product.product';
const QUANT_MODEL = 'stock.quant';
// `active`: `search_read` bez `active_test=false` vracia len aktívne produkty, pole je len pre
// diagnostiku/budúce kroky. `is_storable` NIE JE náhrada Money skladovej karty (PROD: 4 kódy so
// skladom v Money majú `is_storable=false`) — len informačné `skladovy`. `id` vráti `search_read`
// vždy (netreba ho žiadať) — kľúč pre `stock.quant.product_id`.
const FIELDS = ['default_code', 'name', 'uom_id', 'is_storable', 'active'];
const QUANT_FIELDS = ['product_id', 'quantity'];

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

/** Odoo sa nedá použiť: `config` = integrácia nenakonfigurovaná (dev/test/CI, očakávané),
 *  `chyba` = HTTP/sieť/timeout/403 (skutočný výpadok, zalogovaný). */
type Nedostupne = { zdroj: 'nedostupne'; dovod: 'config' | 'chyba' };

export type OdooKatalogVysledok =
	/** Odoo odpovedalo: `produkty` obsahuje LEN kódy, ktoré Odoo pozná (aktívne). */
	{ zdroj: 'odoo'; produkty: Map<string, OdooProdukt> } | Nedostupne;

export type OdooSkladVysledok =
	/** Odoo odpovedalo: `sklad` = súčet interných kvantov (zaokr. na 3 desatinné) LEN pre kódy, ktoré
	 *  Odoo pozná A sleduje skladom (`is_storable`); sledovaný produkt bez kvantov = 0 a je aj v
	 *  `bezKvantov` (review #599: kým Odoo Money nezrkadlí, volajúci ho môže brať ako neznámy). Kód,
	 *  ktorý Odoo nepozná / nesleduje, v mape NIE JE (stav neznámy — rozhodne volajúci). */
	{ zdroj: 'odoo'; sklad: Map<string, number>; bezKvantov: Set<string> } | Nedostupne;

/** Stav skladu jedného kódu v cache: súčet interných kvantov + či Odoo nemá žiadny kvant. */
interface SkladRiadok {
	sklad: number;
	bezKvantov: boolean;
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

/** Odoo many2one `[id, názov]` → id (`null` keď chýba). */
function m2oId(v: unknown): number | null {
	return Array.isArray(v) && typeof v[0] === 'number' ? v[0] : null;
}

/** Riadok katalógu v cache: produkt + Odoo `id` (kľúč pre `stock.quant`). */
interface ProduktRiadok {
	produkt: OdooProdukt;
	id: number;
}

const _katalog = new KodCache<ProduktRiadok>(
	PRODUCT_MODEL,
	KATALOG_TTL_MS,
	async (kody, timeoutMs) => {
		const cfg = odooJson2Config()!;
		const rows = await searchReadJson2(cfg, PRODUCT_MODEL, [['default_code', 'in', kody]], FIELDS, {
			timeoutMs
		});
		const najdene = new Map<string, ProduktRiadok>();
		for (const r of rows) {
			const kod = s(r.default_code);
			// ten istý kód môže mať viac produktov (varianty, odoo-erp 8058) — prvý vyhráva
			if (!kod || najdene.has(kod)) continue;
			najdene.set(kod, {
				id: typeof r.id === 'number' ? r.id : 0,
				produkt: {
					kod,
					nazov: s(r.name),
					mj: m2oNazov(r.uom_id),
					skladovy: r.is_storable === true
				}
			});
		}
		// neznáme kódy loguje volajúci s kontextom (validácia kódov / názov skla) — tu len debug
		log.debug('product.product read OK', {
			kody: kody.length,
			najdene: najdene.size,
			nezname: kody.filter((k) => !najdene.has(k))
		});
		return najdene;
	},
	log
);

const _sklad = new KodCache<SkladRiadok>(
	QUANT_MODEL,
	SKLAD_TTL_MS,
	async (kody, timeoutMs) => {
		const cfg = odooJson2Config()!;
		// kódy sem idú LEN sledované skladom a nájdené v katalógu (odooSkladPreKody) — id z jeho cache
		const kodPreId = new Map<number, string>();
		for (const kod of kody) {
			const id = _katalog.hodnota(kod)?.id;
			if (id) kodPreId.set(id, kod);
		}
		// žiadne použiteľné id (katalóg bez `id`) → nie je čo čítať, kódy ostanú „neznáme"
		if (kodPreId.size === 0) return new Map<string, SkladRiadok>();
		const rows = await searchReadJson2(
			cfg,
			QUANT_MODEL,
			[
				['product_id', 'in', [...kodPreId.keys()]],
				['location_id.usage', '=', 'internal']
			],
			QUANT_FIELDS,
			{ timeoutMs }
		);
		// sledovaný produkt bez kvantov = 0 (Odoo nemá nič na sklade) + príznak `bezKvantov`
		const sucet = new Map<string, SkladRiadok>(
			[...kodPreId.values()].map((k) => [k, { sklad: 0, bezKvantov: true }])
		);
		for (const r of rows) {
			const kod = kodPreId.get(m2oId(r.product_id) ?? -1);
			const q = typeof r.quantity === 'number' && Number.isFinite(r.quantity) ? r.quantity : 0;
			const s = kod ? sucet.get(kod) : undefined;
			if (kod && s) sucet.set(kod, { sklad: s.sklad + q, bezKvantov: false });
		}
		// zaokrúhli na 3 desatinné — FP akumulácia (0,1 + 0,2) by inak dala falošné varovanie
		for (const [kod, v] of sucet)
			sucet.set(kod, { ...v, sklad: Math.round(v.sklad * 1000) / 1000 });
		log.debug('stock.quant read OK', {
			produkty: kodPreId.size,
			kvanty: rows.length,
			bezKvantov: [...sucet].filter(([, v]) => v.bezKvantov).map(([k]) => k)
		});
		return sucet;
	},
	log
);

/** TEST hook: vyprázdni cache + single-flight + nedostupnosť + „warn raz" stav (katalóg aj sklad). */
export function _resetOdooKatalogCache(): void {
	_katalog.reset();
	_sklad.reset();
}

/** Prázdne/medzerové kódy von, duplicity von; ostatné PRESNE (bez trimu, case-sensitive). */
function unikatneKody(kody: string[]): string[] {
	return [...new Set(kody.filter((k) => typeof k === 'string' && k.trim().length > 0))];
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
	const unikatne = unikatneKody(kody);
	if (!(await _katalog.zabezpec(unikatne, opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS)))
		return { zdroj: 'nedostupne', dovod: 'chyba' };
	const produkty = new Map<string, OdooProdukt>();
	for (const kod of unikatne) {
		const r = _katalog.hodnota(kod);
		if (r) produkty.set(kod, r.produkt);
	}
	return { zdroj: 'odoo', produkty };
}

/**
 * Stav skladu z Odoo (#599 krok 3): súčet `stock.quant.quantity` na INTERNÝCH lokáciách
 * (`location_id.usage = 'internal'`) per kód. Najprv katalóg (`odooProduktyPreKody` — id + či sa
 * produkt sleduje skladom), potom JEDEN `stock.quant` read pre sledované kódy mimo platnej cache.
 * NIKDY nehádže; nedostupný katalóg aj nedostupný `stock.quant` = `nedostupne`.
 */
export async function odooSkladPreKody(
	kody: string[],
	opts: { timeoutMs?: number } = {}
): Promise<OdooSkladVysledok> {
	const katalog = await odooProduktyPreKody(kody, opts);
	if (katalog.zdroj !== 'odoo') return katalog;
	const sledovane = [...katalog.produkty.values()].filter((p) => p.skladovy).map((p) => p.kod);
	if (!(await _sklad.zabezpec(sledovane, opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS)))
		return { zdroj: 'nedostupne', dovod: 'chyba' };
	const sklad = new Map<string, number>();
	const bezKvantov = new Set<string>();
	for (const kod of sledovane) {
		const v = _sklad.hodnota(kod);
		if (v === null) continue;
		sklad.set(kod, v.sklad);
		if (v.bezKvantov) bezKvantov.add(kod);
	}
	return { zdroj: 'odoo', sklad, bezKvantov };
}
