// #563 (d): zobrazovací názov typu skla na podklade objednávky = REÁLNY názov článku z Odoo katalógu
// (Patrik, Odoo úloha 625: „Typ skla musí byť podľa reálneho názvu !!!", vzor
// „Izolačné sklo 4/16/4- číre (Ug=1,1)"). LEN ZOBRAZENIE — uložený `typ_skla`, `glass_types.money_kod`
// ani Odoo payload sa NEMENIA → Money odpis byte-identický, žiadna migrácia.
//
// #599 (d): súbor sa volal `money-nazov-skla.ts`, hoci už od #563 číta Odoo (katalóg `product.product`
// syncovaný z Money, rovnaké `default_code`) — premenovaný na `odoo-nazov-skla.ts`, a vlastnú cache +
// `product.product` read nahradil zdieľaný katalógový modul `odoo-katalog.ts` (jedna cache, jeden vzor).
//
// Reťazec (prvý úspech vyhráva, nikdy chyba):
//   1. lokálny názov → `glass_types.money_kod` (len jednoznačný, `glassMoneyKodPodlaNazvu`) →
//      Odoo `product.product` `default_code` → `name` (`odooProduktyPreKody`),
//   2. Odoo cenníková hodnota (`typ_skla` z pickera = `cennik_code || name`) → `montalu.glass.type.name`
//      z existujúcej `fetchGlassTypes` cache,
//   3. inak uložený `typ_skla` (lokálny názov).
//
// Timeout (3 s), cache (5 min / 60 s), single-flight a warn-raz rieši `odoo-katalog.ts` (vzor
// `odoo-glass-types.ts`); nenakonfigurovaná integrácia (dev/test) = bez volania + bez warnu.
import { glassMoneyKodPodlaNazvu } from './db';
import { fetchGlassTypes } from './odoo-glass-types';
import { odooProduktyPreKody, _resetOdooKatalogCache } from './odoo-katalog';

const DEFAULT_FETCH_TIMEOUT_MS = 3000;

/** TEST hook: vyprázdni zdieľanú katalógovú cache (názvy skiel ju používajú). */
export function _resetOdooNazvyCache(): void {
	_resetOdooKatalogCache();
}

/** Odoo názvy produktov pre kódy (JEDEN katalógový read, nikdy nehádže; nedostupné Odoo = prázdne). */
async function nazvyPreKody(kody: string[], timeoutMs: number): Promise<Map<string, string>> {
	const out = new Map<string, string>();
	if (kody.length === 0) return out;
	const katalog = await odooProduktyPreKody(kody, { timeoutMs });
	if (katalog.zdroj !== 'odoo') return out;
	for (const [kod, p] of katalog.produkty) if (p.nazov) out.set(kod, p.nazov);
	return out;
}

/**
 * Zobrazovacie názvy typov skla pre riadky podkladu: `{ [typSkla]: názov }` pre KAŽDÝ vstupný typ
 * (fallback = samotný `typSkla`). NIKDY nehádže. Každé Odoo volanie je ohraničené `timeoutMs`
 * (default 3 s); v najhoršom prípade (čakanie na súbežný fetch + vlastný fetch + necachovaný
 * `fetchGlassTypes`) sa to môže sčítať na niekoľko timeoutov — v bežnom loade je `fetchGlassTypes`
 * už v cache (load ho volá skôr) a kódy sú cachované 5 min.
 */
export async function odooNazvySkiel(
	typy: string[],
	opts: { timeoutMs?: number } = {}
): Promise<Record<string, string>> {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
	const unikatne = [...new Set(typy.map((t) => t.trim()).filter((t) => t.length > 0))];
	const out: Record<string, string> = {};
	for (const t of typy) out[t] = t;
	if (unikatne.length === 0) return out;

	// 1. lokálny názov → jednoznačný Money kód → názov článku z Odoo katalógu
	const kodPreTyp = new Map<string, string>();
	for (const t of unikatne) {
		const kod = glassMoneyKodPodlaNazvu(t);
		if (kod) kodPreTyp.set(t, kod);
	}
	const katalogNazvy = await nazvyPreKody([...new Set(kodPreTyp.values())], timeoutMs);

	// 2. Odoo cenníková hodnota (picker) → názov `montalu.glass.type` (zdieľaná cache pickera)
	const zvysok = unikatne.filter((t) => !katalogNazvy.has(kodPreTyp.get(t) ?? ''));
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
		out[t] = (kod && katalogNazvy.get(kod)) || odooNazvy.get(k) || t;
	}
	return out;
}

/** Jeden typ skla → zobrazovací názov; pohodlný obal nad `odooNazvySkiel`. */
export async function odooNazovSkla(typSkla: string): Promise<string> {
	// `odooNazvySkiel` vracia kľúč pre KAŽDÝ vstupný typ (fallback = typ sám)
	return (await odooNazvySkiel([typSkla]))[typSkla]!;
}
