// #556: deterministický matcher lokálne (výpočtové) sklo → Odoo `montalu.glass.type` (cenníkový
// typ). ČISTÁ funkcia, žiadny IO — Odoo katalóg dostáva ako argument (živý cez `fetchGlassTypes`
// cache, viď `odoo-glass-types.ts`). Money-NEUTRÁLNE: mení sa LEN `typ_skla` = `glass_order.
// items[].glass_type` (objednávka u dodávateľa skla), nikdy výpočtový `glass_types` katalóg / Money
// kódy (pravidlo `.claude/rules/glass-catalog.md`).
//
// Prečo matcher: producenti riadkov objednávky (zasklenia/fix/pergola) nesú `typ_skla` = LOKÁLNY
// voľnotextový názov (napr. „Izolačné sklo 4/8/4 číre"); Odoo `resolve_glass_type` páruje kód →
// presný názov → zloženie. Formát zloženia sa líši (Odoo „4/8/4" lomítka, appka „4-8-4" pomlčky),
// preto normalizujeme OBE strany na kanonický tvar a párujeme podľa (zloženie ∧ kategória).
// Jednoznačná zhoda → uloží sa Odoo `value` (`cennik_code || name`); viac kandidátov → NIKDY tichý
// výber (operátor rozhodne na podklade); žiadna zhoda → ostáva lokálny názov + badge „nepriradené".

/** Istota priradenia lokálneho skla na Odoo typ. */
export type GlassIstota = 'jednoznacne' | 'viac' | 'ziadne';

/** Kategória skladby (deliaca os párovania popri zložení). */
export type GlassKategoria = 'izolacne' | 'esg' | 'vsg' | 'float';

/**
 * Minimálny tvar Odoo typu skla, ktorý matcher potrebuje. Štrukturálne ho spĺňa `GlassTypeOption`
 * z `odoo-glass-types.ts` (rozšírený o surové `name`/`composition`), takže matcher číta z tej istej
 * `fetchGlassTypes` cache bez duplicitného zdroja pravdy.
 */
export interface OdooTypLike {
	/** Hodnota uložená do `typ_skla` = `cennik_code || name` (to, čo posiela `buildGlassOrderItem`). */
	value: string;
	/** Odoo `montalu.glass.type.name` — cenníkový názov (pre popis v nárezáku). */
	name: string;
	/** Odoo `montalu.glass.type.composition` — surové zloženie (napr. „4/8/4"). */
	composition: string;
	/** Odoo `montalu.glass.type.category` — izolacne / esg / vsg. */
	category: string;
}

export interface GlassMatch<T extends OdooTypLike = OdooTypLike> {
	/** Zvolený typ pri `jednoznacne`; inak `null` (nikdy tichý výber pri „viac"). */
	typ: T | null;
	istota: GlassIstota;
	/** Kandidáti so zhodným (zloženie ∧ kategória): 0 pri „ziadne", 1 pri „jednoznacne", ≥2 pri „viac". */
	kandidati: T[];
}

/**
 * Kanonizuj zloženie skla na tvar `A-B-C` (číslice oddelené pomlčkami). Zvláda lomítka/bodky/
 * pomlčky/medzery aj písmená medzi číslom a oddeľovačom (napr. „5esg/14/5esg" → „5-14-5"), IZO
 * dvoj- aj trojsklo („4/16/4/16/4" → „4-16-4-16-4"), VSG kódy („3.3.1" → „3-3-1", „44.2" → „44-2")
 * aj jednosklo („Float kalené 6 mm" → „6"). Nerozpoznané / bez čísla → „".
 */
export function normalizeComposition(raw: string): string {
	const t = (raw ?? '').toLowerCase();
	// viac-číselné zloženie: A[sep]B[sep]C… kde sep ∈ / . - a môžu byť písmená pred oddeľovačom
	const multi = t.match(/\d{1,2}(?:\s*[a-z]*\s*[./-]\s*\d{1,2})+/);
	if (multi) {
		const nums = multi[0].match(/\d{1,2}/g);
		if (nums && nums.length >= 2) return nums.join('-');
	}
	// jednosklo „N mm" / „Nmm"
	const single = t.match(/(\d{1,2})\s*mm/);
	if (single) return single[1]!;
	// holé číslo (Odoo composition „6", príp. „6 esg" / „6 kalené")
	const bare = t.trim().match(/^(\d{1,2})(?:\s*(?:esg|kalen\w*))?$/);
	if (bare) return bare[1]!;
	return '';
}

/**
 * Kategória LOKÁLNEHO skla z jeho voľnotextového názvu (poradie podľa návrhu #556): „izol" →
 * izolacne; „kalen"/„esg" → esg; „vsg" alebo kód d.d.d / dd.d → vsg; inak float (obyčajný float
 * nemá v Odoo náprotivok). Poradie izol-first chráni izolačné sklá zapísané bodkami („4.8.4").
 */
export function localGlassCategory(nazov: string): GlassKategoria {
	const t = (nazov ?? '').toLowerCase();
	if (t.includes('izol')) return 'izolacne';
	if (t.includes('kalen') || t.includes('esg')) return 'esg';
	if (/\bvsg\b/.test(t) || /\d\.\d\.\d/.test(t) || /\d{2}\.\d/.test(t)) return 'vsg';
	return 'float';
}

/**
 * Kategória ODOO typu — primárne z `category` poľa (izolacne/esg/vsg), pri prázdnej/neznámej
 * (napr. lokálny fallback zoznam) odvodená z názvu tou istou heuristikou ako lokálne sklo.
 */
function odooKategoria(t: OdooTypLike): GlassKategoria {
	const c = (t.category ?? '').toLowerCase().trim();
	if (c.includes('izol')) return 'izolacne';
	if (c === 'esg' || c.includes('esg') || c.includes('kalen')) return 'esg';
	if (c.includes('vsg')) return 'vsg';
	return localGlassCategory(t.name);
}

/**
 * Priraď lokálne sklo (voľnotextový názov) na Odoo typ podľa (kanonické zloženie ∧ kategória).
 * Nikdy tichý výber pri viacerých kandidátoch. `odooTypy` = živý katalóg z `fetchGlassTypes`.
 */
export function matchOdooGlassType<T extends OdooTypLike>(
	lokalneSklo: string,
	odooTypy: T[]
): GlassMatch<T> {
	const lokComp = normalizeComposition(lokalneSklo);
	const lokKat = localGlassCategory(lokalneSklo);
	if (!lokComp) return { typ: null, istota: 'ziadne', kandidati: [] };
	const kandidati = odooTypy.filter(
		(t) => normalizeComposition(t.composition || t.name) === lokComp && odooKategoria(t) === lokKat
	);
	if (kandidati.length === 0) return { typ: null, istota: 'ziadne', kandidati: [] };
	if (kandidati.length === 1) return { typ: kandidati[0]!, istota: 'jednoznacne', kandidati };
	return { typ: null, istota: 'viac', kandidati };
}

/**
 * Podklad — pre riadok, ktorého uložený `typSkla` NIE je platná Odoo hodnota, vráti či je
 * „nepriradený" (badge „nepriradené — vyber typ") + kandidátov (pri „viac"). Prázdne, keď je typ
 * už Odoo hodnota, keď je zdroj lokálny fallback (bez Odoo dát nič nenaväzujeme) alebo prázdny typ.
 */
export function naviazanieRiadku<T extends OdooTypLike>(
	typSkla: string,
	odooTypy: T[],
	source: 'odoo' | 'local'
): { nepriradene: boolean; kandidati: T[] } {
	if (source !== 'odoo' || !typSkla) return { nepriradene: false, kandidati: [] };
	if (odooTypy.some((t) => t.value === typSkla)) return { nepriradene: false, kandidati: [] };
	const m = matchOdooGlassType(typSkla, odooTypy);
	return { nepriradene: true, kandidati: m.kandidati };
}

/**
 * Nárezák — cenníkový popis pre lokálne sklo („· cenník: <Odoo name>"). Jednoznačné → Odoo name;
 * viac → prvý kandidát + „(+N)"; žiadna zhoda alebo lokálny fallback → „" (bez popisu).
 */
export function cennikPopis(
	typSkla: string,
	odooTypy: OdooTypLike[],
	source: 'odoo' | 'local'
): string {
	if (source !== 'odoo' || !typSkla) return '';
	const m = matchOdooGlassType(typSkla, odooTypy);
	if (m.istota === 'jednoznacne' && m.typ) return m.typ.name;
	if (m.istota === 'viac' && m.kandidati.length > 0)
		return `${m.kandidati[0]!.name} (+${m.kandidati.length - 1})`;
	return '';
}
