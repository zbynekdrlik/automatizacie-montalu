// Lakovanie — spotreba farby (kg) na rozvin profilov (#369). DISPLAY-ONLY,
// Money-NEUTRÁLNE (žiadny odpis, žiadny zápis do Money). Vzorec:
//   spotreba [kg] = rozvin [m²/bm] × dĺžka [bm] × 0,150 [kg/m²]
// Rozvin = merná jednotka `m2` na Money artikli (Artikly_ArtiklJednotka.Mnozstvi,
// m² povrchu na 1 bežný meter = obvod prierezu v metroch) — dodaná do appky cez
// denný snapshot (ceny-snapshot.py → material_prices.rozvin → enrichPolozky).
// €-náklad je zámerne honest-null: RAL sadzbu (Money cenník LAKOVNA
// 20,16/24,12/22,18 €/m²) sa nedá vybrať bez RAL rozdelenia štandard/pigment/
// štruktúra — to Dominik ešte dopĺňa (ch427, 3.9.2026). Nikdy sa nehádže cena.

/** kg farby na 1 m² rozvinu (Dominik, ch207 msg 1768822: „150 g na 1 m²"). */
export const LAKOVANIE_KOEF_KG_M2 = 0.15;

/** Money kódy, ktoré sa NElakujú (Dominik, ch427 msg 1788178). V Money majú
 *  rozvin (`m2` coeff) tiež, preto sa musia vylúčiť EXPLICITNE — nie absenciou
 *  dát (tá by ich neodlíšila od profilov s ešte nezadaným rozvinom). */
export const LAKOVANIE_VYNIMKY: ReadonlySet<string> = new Set([
	'BPP00092',
	'BPP00091',
	'BPP00097',
	'BPP00094',
	'PRP00047'
]);

/** Profilové rodiny, ktoré sa lakujú (ZASP/PRP/BPP = extrudované hliníkové
 *  profily). Kovanie/tesnenie (ZASK) ani kusové komponenty (BPK) sa nelakujú —
 *  tie v Money ani nemajú rozvin (`m2` coeff = 0/138 pri ZASK, overené live),
 *  takže prefix-gate zároveň bráni falošnému „neúplné" flagu na tesneniach. */
export const LAKOVANIE_PROFIL_PREFIXY: readonly string[] = ['ZASP', 'PRP', 'BPP'];

export interface LakovaniePolozka {
	kod: string;
	nazov: string;
	/** dĺžka [bm] (množstvo odpisu). Lakuje sa len keď `mj === 'm'`. */
	qty: number;
	mj: string;
	/** rozvin [m²/bm] z Money (`material_prices.rozvin`); `null` = neznámy. */
	rozvin: number | null;
}

export interface LakovanieRiadok {
	kod: string;
	nazov: string;
	/** množstvo z odpisu (dĺžka [bm] keď `mj='m'`, inak počet [ks] a pod.). */
	dlzka: number;
	/** jednotka množstva (`mj`) — plochu vieme spočítať LEN pri `'m'`. */
	mj: string;
	/** rozvin [m²/bm]; `null` = Money ho pre kód nemá. */
	rozvin: number | null;
	/** plocha na lakovanie [m²] = rozvin × dĺžka; `null` keď sa nedá spočítať
	 *  (rozvin neznámy, alebo `mj` nie je v bežných metroch). */
	plocha: number | null;
	/** spotreba farby [kg] = plocha × 0,150; `null` keď sa plocha nedá spočítať. */
	spotreba: number | null;
}

export interface LakovanieResult {
	/** len lakované profilové riadky (rodiny ZASP/PRP/BPP, `mj='m'`, mimo výnimiek). */
	radky: LakovanieRiadok[];
	/** súčet plôch [m²] — len riadky so známym rozvinom. */
	plochaSpolu: number;
	/** súčet spotreby [kg] — len riadky so známym rozvinom. */
	spotrebaSpolu: number;
	/** `false` = aspoň jeden lakovaný profil má neznámy rozvin → súčet je NEÚPLNÝ. */
	kompletne: boolean;
	/** €-náklad zámerne honest-null (čaká na RAL sadzby) — NIKDY hádaná cena. */
	eurSpolu: number | null;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function jeLakovanyProfil(kod: string): boolean {
	return LAKOVANIE_PROFIL_PREFIXY.some((p) => kod.startsWith(p));
}

/**
 * Display-only výpočet spotreby farby na lakovanie profilov (#369). Vstup =
 * položky odpisu (kód/názov/qty/mj + rozvin zo snapshotu). Vráti lakované
 * profilové riadky (rodiny ZASP/PRP/BPP, mimo Dominikových výnimiek) so spotrebou
 * kg + súčty. Spotreba sa spočíta LEN keď je rozvin známy A množstvo je v bežných
 * metroch (`mj='m'`). Lakovaný profil, ktorý sa spočítať nedá — chýbajúci rozvin,
 * ALEBO množstvo v kusoch (napr. CLIP #372 posiela profily ako `mj='ks'`) — sa NIE
 * ticho zahodí, ale pridá ako honest-null riadok a `kompletne=false` (súčet sa
 * prizná ako neúplný — „priznáva medzeru", nie skryje ju). Kovanie/komponenty
 * (nie profilová rodina) a výnimky sa ignorujú. €-náklad ostáva `null` (RAL sadzby).
 */
export function computeLakovanie(polozky: LakovaniePolozka[]): LakovanieResult {
	const radky: LakovanieRiadok[] = [];
	let plochaSpolu = 0;
	let spotrebaSpolu = 0;
	let kompletne = true;
	for (const p of polozky) {
		if (!jeLakovanyProfil(p.kod)) continue; // kovanie/komponenty — nelakuje sa
		if (LAKOVANIE_VYNIMKY.has(p.kod)) continue; // Dominikove výnimky
		if (!(p.qty > 0)) continue; // nulové/neplatné množstvo — nič nelakujeme
		const rozvin = p.rozvin !== null && p.rozvin > 0 ? p.rozvin : null;
		// plochu vieme len z DĹŽKY v bežných metroch × rozvin; ks/iné jednotky nevieme
		// (nemáme dĺžku tyče) → honest-null, nie tiché zahodenie lakovaného profilu
		if (p.mj === 'm' && rozvin !== null) {
			const plocha = round3(rozvin * p.qty);
			const spotreba = round3(plocha * LAKOVANIE_KOEF_KG_M2);
			plochaSpolu += plocha;
			spotrebaSpolu += spotreba;
			radky.push({ kod: p.kod, nazov: p.nazov, dlzka: p.qty, mj: p.mj, rozvin, plocha, spotreba });
		} else {
			kompletne = false;
			radky.push({
				kod: p.kod,
				nazov: p.nazov,
				dlzka: p.qty,
				mj: p.mj,
				rozvin,
				plocha: null,
				spotreba: null
			});
		}
	}
	return {
		radky,
		plochaSpolu: round3(plochaSpolu),
		spotrebaSpolu: round3(spotrebaSpolu),
		kompletne,
		eurSpolu: null
	};
}
