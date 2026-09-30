// Cena skla v nárezáku zasklení (#225) — DISPLAY-ONLY náklad na sklo (plocha × cena/m²). Money
// ODPIS skiel sa tým NEMENÍ (samostatné rozhodnutie viazané na zoznam variácií od Dominika, viď
// #225) — xlsx / goldeny ostávajú bit-identické. Chýbajúca cena alebo nenamapovaný variant = „cena
// nedostupná" (honest-null): NIKDY sa nedopočítava z odhadu. Gate na interných je na úrovni route
// (rovnako ako CenyTabulka/enrichPolozky) — tento modul cenu len počíta.
//
// #599 krok ceny — ZDROJ €/m² sa volí automaticky (ROZHODNUTÉ owner 30.9.):
//   1. Odoo `montalu.glass.type.price_m2` čitateľné → variant (Odoo typ priamo = `value`, alebo
//      lokálny názov JEDNOZNAČNE spárovaný `matchOdooGlassType`) → €/m² jeho typu (0 = neznáma);
//   2. inak (typ nespárovaný / `price_m2` nečitateľné) TS kód variantu (`glassMoneyKod`) → cenník
//      IZOS z Odoo `get_prices`, keď odpovedá;
//   3. keď NEodpovedá ani jeden Odoo kanál → denný Money snapshot ako doteraz.
// Kým je zdroj Odoo, Money snapshot sa pre sklo NEPOUŽIJE ani pre jednu tabuľu (chýba → null).
import { glassMoneyKod } from './db';
import { cenaZaM2Zo, cenovyZdroj, getSnapshotMeta, type CenaZaM2, type SnapshotMeta } from './ceny';
import { odooSkloCenyM2, zaznamenajZdroj, type CenyZdroj } from './odoo-prices';
import { fetchGlassTypes, type GlassTypeOption } from './odoo-glass-types';
import { matchOdooGlassType } from './glass-match';

export interface SkloPlanVstup {
	/** označenie plánu v súhrne (napr. „Posuv 1"); prázdne pre jednoposuvový nárezák */
	label: string;
	system: string;
	/** ZVOLENÝ variant skla (lokálny `glass_types.nazov` alebo Odoo `value` typu, #579) */
	variant: string;
	sirka: number; // mm (rozmer jednej tabule)
	vyska: number; // mm
	pocet: number; // počet tabúľ v pláne
}

export interface SkloCenaRiadok {
	label: string;
	variant: string;
	system: string;
	/** plocha skla v m² = sirka × vyska × pocet (reálne tabule na náklad, NIE otvor S×V) */
	m2: number;
	/** €/m²; `null` = nedostupná (variant nenamapovaný alebo bez ceny v zdroji) */
	eurM2: number | null;
	/** m2 × eurM2; `null` keď je eurM2 nedostupné (honest-null, nič sa nedopočítava) */
	spolu: number | null;
	mena: string;
}

export interface SkloCenaResult {
	radky: SkloCenaRiadok[];
	/** súčet nákladu na sklo za celú zákazku (len z riadkov so známou cenou) */
	spolu: number;
	/** `false`, keď aspoň jeden plán s nenulovou plochou mal nedostupnú cenu → súčet
	 *  je NEÚPLNÝ (appka to musí priznať v UI, rovnako ako `CenySucet.kompletne`) */
	kompletne: boolean;
	/** #599: `odoo` = €/m² z Odoo (`price_m2` alebo `get_prices`), `snapshot` = Money snapshot */
	zdroj: CenyZdroj;
	snapshot: SnapshotMeta;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const plochaM2 = (sirka: number, vyska: number, pocet: number) =>
	round2((sirka * vyska * pocet) / 1_000_000);

/** Odoo typ skla pre variant: priama `value` (nárezák zvolil Odoo typ, #579) alebo JEDNOZNAČNÁ
 *  zhoda lokálneho názvu (povlak/odtieň presne — cena sa nesmie priradiť inému sklu). */
function odooTypPre(variant: string, typy: GlassTypeOption[]): GlassTypeOption | null {
	const priamo = typy.find((t) => t.value === variant);
	if (priamo) return priamo;
	const m = matchOdooGlassType(variant, typy);
	return m.istota === 'jednoznacne' ? m.typ : null;
}

/**
 * Náklad na sklo per plán + súhrn za zákazku. Pre KAŽDÝ plán: plocha = sirka×vyska×pocet (m²),
 * €/m² podľa zdroja (hlavička súboru). Keď cena chýba → riadok `spolu = null` („cena nedostupná")
 * a súhrn sa prizná ako neúplný. Volá sa LEN pre interných (gate na route).
 */
export async function skloCenaPre(plany: SkloPlanVstup[]): Promise<SkloCenaResult> {
	const snapshot = getSnapshotMeta(); // spustí lazy import + vráti vek snapshotu pre UI
	const kody = plany.map((p) => glassMoneyKod(p.system, p.variant) ?? '').filter(Boolean);
	// všetky tri Odoo ready SÚBEŽNE (každý má vlastný 3 s timeout a cache) — page load čaká max 1×
	const [skloOdoo, material, katalog] = await Promise.all([
		odooSkloCenyM2(),
		cenovyZdroj(kody),
		fetchGlassTypes()
	]);
	// typy LEN zo živého Odoo katalógu — lokálny fallback pickera (názvy appky) na `price_m2` nepáruj
	const typy = skloOdoo.zdroj === 'odoo' && katalog.source === 'odoo' ? katalog.items : [];
	const zdroj: CenyZdroj =
		skloOdoo.zdroj === 'odoo' || material.zdroj === 'odoo' ? 'odoo' : 'snapshot';
	zaznamenajZdroj('sklo', zdroj);

	const cenaPre = (p: SkloPlanVstup): CenaZaM2 | null => {
		if (skloOdoo.zdroj === 'odoo') {
			const typ = odooTypPre(p.variant, typy);
			if (typ) return { eurM2: skloOdoo.cenaPreHodnotu.get(typ.value) ?? null, mena: 'EUR' };
		}
		const kod = glassMoneyKod(p.system, p.variant);
		if (!kod) return null;
		// Odoo zdroj bez `get_prices` (odpovedá len `price_m2`) → TS kód NEJDE do Money snapshotu
		if (zdroj === 'odoo' && material.zdroj !== 'odoo') return null;
		return cenaZaM2Zo(material, kod);
	};

	let spolu = 0;
	let kompletne = true;
	const radky: SkloCenaRiadok[] = plany.map((p) => {
		const m2 = plochaM2(p.sirka, p.vyska, p.pocet);
		const cena = cenaPre(p);
		const eurM2 = cena?.eurM2 ?? null;
		const mena = cena?.mena ?? 'EUR';
		const riadokSpolu = eurM2 === null ? null : round2(m2 * eurM2);
		if (riadokSpolu === null) {
			if (m2 !== 0) kompletne = false;
		} else {
			spolu += riadokSpolu;
		}
		return {
			label: p.label,
			variant: p.variant,
			system: p.system,
			m2,
			eurM2,
			spolu: riadokSpolu,
			mena
		};
	});
	return { radky, spolu: round2(spolu), kompletne, zdroj, snapshot };
}
