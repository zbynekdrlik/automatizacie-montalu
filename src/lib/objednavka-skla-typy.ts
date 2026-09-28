// #576 (Marek D., Odoo úloha 1180): zoskupenie typov skla pre picker podkladu objednávky skla.
// Odoo katalóg `montalu.glass.type` má ~99 typov — plochý `<select>` bol neprehľadný. Picker ich
// zobrazí v `<optgroup>` podľa Odoo `category` v PEVNOM poradí so slovenskými názvami, kandidátov
// matchera #556 navrchu („Odporúčané") a „iné sklo" (#548) na konci.
//
// ČISTÉ a client-safe (žiadny `$lib/server` import) — volá ho `+page.svelte` per riadok (riadok
// pozná svojich kandidátov) aj pre formulár „Pridať riadok". Hodnoty (`value` = Odoo `cennik_code
// || name`) sa NEMENIA → uložený `typ_skla` aj Odoo `glass_order` payload sú bit-identické.
// Money-NEUTRÁLNE (len zobrazenie).

/** #548: sentinel voľby „iné sklo" (odkryje vlastný typ + cenu €/m²). Nikdy nie je katalógový kód. */
export const SENTINEL_INE_SKLO = '__ine__';

/** Jedna voľba pickera (zhodná s `GlassTypeOption.value/label`). */
export interface TypSklaVolba {
	value: string;
	label: string;
}

/** Jedna `<optgroup>` pickera. */
export interface SkupinaTypovSkla {
	label: string;
	items: TypSklaVolba[];
}

/** Odoo `montalu.glass.type.category` → názov skupiny, v PEVNOM poradí zobrazenia. */
const KATEGORIE: readonly { category: string; label: string }[] = [
	{ category: 'izolacne', label: 'Izolačné (IZOS)' },
	{ category: 'esg', label: 'Kalené ESG' },
	{ category: 'vsg', label: 'Lepené VSG' },
	{ category: 'rezane', label: 'Rezané / float' }
];
const OSTATNE = 'Ostatné';

const INE_SKLO_LABEL = 'iné sklo (vlastný typ + cena/m²)';

const podlaNazvu = (a: TypSklaVolba, b: TypSklaVolba): number =>
	a.label.localeCompare(b.label, 'sk');

/**
 * Zoskupí typy skla do skupín pickera: „Odporúčané" (kandidáti, keď sú) → Izolačné → ESG → VSG →
 * Rezané → „Ostatné" (neznáma/prázdna kategória, napr. lokálny fallback) → „Iné sklo" (VŽDY
 * posledné). V kategórii zoradené podľa názvu (sk). Kandidát sa v kategóriách NEopakuje (žiadne
 * duplicitné `value` v jednom selecte); prázdne skupiny sa vynechajú.
 */
export function zoskupTypySkla(
	items: readonly (TypSklaVolba & { category: string })[],
	kandidati: readonly TypSklaVolba[]
): SkupinaTypovSkla[] {
	const out: SkupinaTypovSkla[] = [];
	const odporucane = kandidati.map((k) => ({ value: k.value, label: k.label }));
	if (odporucane.length > 0) out.push({ label: 'Odporúčané', items: odporucane });
	const uzVybrate = new Set(odporucane.map((k) => k.value));

	const znameKategorie = new Set(KATEGORIE.map((k) => k.category));
	const zvysne = items.filter((t) => !uzVybrate.has(t.value));
	const skupina = (label: string, pred: (c: string) => boolean) => {
		const vyber = zvysne
			.filter((t) => pred(t.category.trim().toLowerCase()))
			.map((t) => ({ value: t.value, label: t.label }))
			.sort(podlaNazvu);
		if (vyber.length > 0) out.push({ label, items: vyber });
	};
	for (const k of KATEGORIE) skupina(k.label, (c) => c === k.category);
	skupina(OSTATNE, (c) => !znameKategorie.has(c));

	out.push({ label: 'Iné sklo', items: [{ value: SENTINEL_INE_SKLO, label: INE_SKLO_LABEL }] });
	return out;
}
