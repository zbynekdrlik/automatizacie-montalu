// Cena skla v nárezáku zasklení (#225) — DISPLAY-ONLY náklad na sklo (plocha ×
// cena/m² z Money cenníka IZOS cez denný snapshot cien, #154). Money ODPIS skiel
// sa tým NEMENÍ (samostatné rozhodnutie viazané na zoznam variácií od Dominika,
// viď #225) — xlsx / goldeny ostávajú bit-identické. Chýbajúca cena alebo
// nenamapovaný variant = „cena nedostupná" (honest-null): NIKDY sa nedopočítava z
// odhadu. Gate na interných je na úrovni route (rovnako ako CenyTabulka/
// enrichPolozky) — tento modul cenu len počíta.
import { glassMoneyKod } from './db';
import { cenaZaM2, getSnapshotMeta, type SnapshotMeta } from './ceny';

export interface SkloPlanVstup {
	/** označenie plánu v súhrne (napr. „Posuv 1"); prázdne pre jednoposuvový nárezák */
	label: string;
	system: string;
	/** ZVOLENÝ variant skla (zhoduje sa s `glass_types.nazov`) — kľúč mapovania na Money */
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
	/** €/m² zo snapshotu; `null` = nedostupná (variant nenamapovaný alebo kód bez ceny) */
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
	snapshot: SnapshotMeta;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const plochaM2 = (sirka: number, vyska: number, pocet: number) =>
	round2((sirka * vyska * pocet) / 1_000_000);

/**
 * Náklad na sklo per plán + súhrn za zákazku. Pre KAŽDÝ plán: plocha = sirka×vyska×
 * pocet (m²), Money kód = `glassMoneyKod(system, variant)`, €/m² = `cenaZaM2(kod)`.
 * Keď kód/cena chýba → riadok `spolu = null` („cena nedostupná") a súhrn sa prizná
 * ako neúplný. Volá sa LEN pre interných (gate na route).
 */
export function skloCenaPre(plany: SkloPlanVstup[]): SkloCenaResult {
	const snapshot = getSnapshotMeta(); // spustí lazy import + vráti vek snapshotu pre UI
	let spolu = 0;
	let kompletne = true;
	const radky: SkloCenaRiadok[] = plany.map((p) => {
		const m2 = plochaM2(p.sirka, p.vyska, p.pocet);
		const kod = glassMoneyKod(p.system, p.variant);
		const cena = kod ? cenaZaM2(kod) : null;
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
	return { radky, spolu: round2(spolu), kompletne, snapshot };
}
