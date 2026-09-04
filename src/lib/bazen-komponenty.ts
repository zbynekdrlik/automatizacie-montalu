// Bazén — vrstva KUSOVÝCH komponentov (podvozky, aretácia, krytky, dorazy, panty)
// do Money odpisu. Zdroj: Dominik, kanál 207 msg 1768496 / ir.attachment 14674
// „KOMPONENTY BAZENY.xlsx" (#355). Vzor = `src/lib/komponenty.ts` (#338 kovanie
// zasklenia): typované/pravidlové položky, honest-null disciplína, 0 ks → riadok
// sa VYNECHÁ (nikdy „0 ks" do Money). Prispôsobené na funkčné n-tice ako `BOM`
// v `src/lib/server/bazen.ts` (heterogénne pravidlá — žiadny všeobecný vzorcový
// jazyk, YAGNI).
//
// MONEY-KRITICKÉ: každý riadok je skutočný výdaj zo skladu. Preto:
//   - množstvá sa NEHÁDAJÚ — odvodzujú sa z volieb a počtov, ktoré appka pozná;
//   - variant kódu (RAL 9006/7016, strana L/P, pant ELOX/9005) sa rieši tak, že
//     NEZVOLENÝ variant vráti 0 ks a do odpisu vôbec nejde (absent, nie „0 ks");
//   - záporné množstvo je nemožné (počty sekcií > 0), ale pre istotu sa clampne
//     na 0 a riadok sa vynechá.
//
// Client-safe: NEIMPORTUJE nič zo `$lib/server/*` (testovateľné bez DB/env,
// zobraziteľné aj v náhľade). Jednotka je vždy `ks`.

import type { MJ } from './komponenty';

export type Strana = 'L' | 'P';
export type AretaciaTyp = 'manualna' | 'automaticka';
export type RalKrytiek = 'R9006' | 'R7016';
export type PantFarba = 'ELOX' | '9005';

/** Vstupy pre výpočet kusových komponentov. Všetko sú veci, ktoré appka pozná
 *  z formulára (existujúce vstupy + nové voľby #355). */
export interface BazenKompVstup {
	/** počet sekcií (= `pocetSekcii`) */
	pocetSekcii: number;
	/** true = dvojkoľaj, false = jednokoľaj */
	dvojkolaj: boolean;
	/** model EXCLUSIVE (spojka M8) */
	exclusive: boolean;
	/** sú dvere */
	dvere: boolean;
	/** samostatný checkbox „Výklopné čelo" (#450) — NEZÁVISLÝ od číselného poľa
	 *  vyklopneCelo (počet), ktoré poháňa len metrážový profil BPP00083. */
	vyklopneCeloOn: boolean;
	/** vetracia klapka (trecí pant) */
	vetraciaKlapka: boolean;
	aretaciaTyp: AretaciaTyp;
	aretaciaStrana: Strana;
	/** uzamykateľná páčka + zámok (nahrádza obyčajnú páčku) */
	uzamykatelna: boolean;
	ralKrytiek: RalKrytiek;
	pantFarba: PantFarba;
	/** počet VEĽKÝCH sekcií (= vs4500 + vs6000) */
	velka: number;
	/** počet STREDNÝCH sekcií (= ss4500 + ss6000) */
	stredna: number;
	/** počet MALÝCH sekcií (= ms4500 + ms6000) */
	mala: number;
}

export interface BazenKomponent {
	kod: string;
	nazov: string;
	qty: number;
	mj: MJ;
}

/** Jeden katalógový riadok: kód, názov, pravidlo počtu (ks). 0/záporné → vynechá sa. */
type Pravidlo = [kod: string, nazov: string, fn: (c: Ctx) => number];

/** Odvodené hodnoty, aby boli pravidlá čitateľné 1:1 s Dominikovou tabuľkou. */
interface Ctx extends BazenKompVstup {
	s: number; // pocetSekcii
	jedno: boolean; // jednokoľaj
	dvoj: boolean; // dvojkoľaj
	auto: boolean; // automatická aretácia
	sMinus1: number; // max(0, s-1)
	/** ks za nožičkovú krytku (per veľkosť sekcie) */
	nozicka: (velkaKs: number, strednaKs: number, malaKs: number) => number;
}

// --- KATALÓG (poradie ako v zozname att 14674) ------------------------------------
const KATALOG: Pravidlo[] = [
	// PODVOZKY
	['BPK00074', 'Kladka D62', (c) => (c.dvoj ? 4 : 2) * c.s],
	['BPK00076', 'Kladka jednokolaj', (c) => (c.jedno ? 2 * c.s : 0)],
	['BPK00078', 'Vodiaca kladka D32', (c) => (c.jedno ? c.sMinus1 : 0)],
	['BPK00079', 'Platňa vodiacej kladky D32', (c) => (c.jedno ? c.sMinus1 : 0)],
	['BPK00080', 'Púzdro vodiacej kladky D32', (c) => (c.jedno ? c.sMinus1 : 0)],
	['BPK00081', 'Oska vodiacej kladky D32', (c) => (c.jedno ? c.sMinus1 : 0)],
	['BPK00097', 'Háčik kladky D62', (c) => (c.dvoj ? 4 : 2) * c.s],
	['BPK00098', 'Rozšírenie háčika kladky D62', (c) => (c.dvoj ? 4 : 2) * c.s],

	// ARETÁCIA (manuálna/automatická, strana L/P, uzamykateľná)
	['BPK00082', 'Telo aretácie S1', (c) => (c.auto ? 1 : c.s)],
	// obyčajná páčka: pri voľbe uzamykateľná sa NAHRÁDZA uzamykateľnou (default #355)
	['BPK00084', 'Páčka aretácie S1', (c) => (c.uzamykatelna ? 0 : c.auto ? 1 : c.s)],
	['BPK00085', 'Púzdro aretácie S1', (c) => (c.auto ? 1 : c.s)],
	['BPK00086', 'Pružina aretácie S1 P', (c) => (c.aretaciaStrana === 'P' ? (c.auto ? 1 : c.s) : 0)],
	['BPK00087', 'Pružina aretácie S1 L', (c) => (c.aretaciaStrana === 'L' ? (c.auto ? 1 : c.s) : 0)],
	['BPK00088', 'Skrutka aretácie S1 M6', (c) => (c.auto ? 1 : c.s)],
	['BPK00089', 'Zobáčik', (c) => (c.auto ? c.sMinus1 : 0)],
	['BPK00090', 'Aretačný kolík', (c) => (c.auto ? c.sMinus1 : 0)],
	['BPK00091', 'Krúžok aretačného kolíka', (c) => (c.auto ? c.sMinus1 : 0)],
	['BPK00092', 'Púzdro zobáčika', (c) => (c.auto ? c.sMinus1 : 0)],
	['BPK00093', 'Pružina aretačného kolíka', (c) => (c.auto ? c.sMinus1 : 0)],
	['BPK20259', 'Západka aretácií S1 L', (c) => (c.aretaciaStrana === 'L' ? c.s : 0)],
	['BPK202510', 'Západka aretácií S1 P', (c) => (c.aretaciaStrana === 'P' ? c.s : 0)],
	[
		'BPK202416',
		'Páčka aretácie S1 uzamykateľná',
		(c) => (c.uzamykatelna ? (c.auto ? c.sMinus1 : c.s) : 0)
	],
	['BPK202519', 'Zámok CKE_40 CH-5-1', (c) => (c.uzamykatelna ? (c.auto ? c.sMinus1 : c.s) : 0)],

	// NEZARADENÉ PRÍSLUŠENSTVO
	['BPK00100', 'Gumový doraz', (c) => (c.jedno ? 2 * c.s : 0)],
	['BPK00101', 'Doraz kolieska jednokolaj SADA L+P', (c) => (c.jedno ? 2 * c.s : 0)],
	['BPK20252', 'Krytka koľajnice L', (c) => (c.dvoj ? 2 * c.s : c.s)],
	['BPK20253', 'Krytka koľajnice P', (c) => (c.dvoj ? 2 * c.s : c.s)],
	['BPK00107', 'Doraz koľajnice', (c) => (c.dvoj ? 4 : 2)],
	['BPK00108', 'Spojka M8 EXCLUSIVE', (c) => (c.exclusive ? c.s * 4 : 0)],
	['BPK202513', 'Spojka koľajnice D8', (c) => (c.dvoj ? 2 * c.s : c.s)],
	['BPK202514', 'Madlo', (c) => (c.vyklopneCeloOn ? 1 : 0)],
	['BPK202515', 'Madlo uzamykateľné', (c) => (c.dvere ? 1 : 0)],
	['BPK202521', 'Kartáčové tesnenie 2200 mm', (c) => (c.jedno ? c.s : 0)],

	// VÝKLOPNÉ ČELO (voľba zap/vyp = vyklopneCeloOn; pant podľa zvolenej RAL ELOX/9005)
	['BPK202516', 'Pant ELOX', (c) => (c.vyklopneCeloOn && c.pantFarba === 'ELOX' ? 3 : 0)],
	['BPK202517', 'Pant 9005', (c) => (c.vyklopneCeloOn && c.pantFarba === '9005' ? 3 : 0)],
	['BPK202520', 'Krídlová matica', (c) => (c.vyklopneCeloOn ? 1 : 0)],

	// VETRACIA KLAPKA
	['BPK202518', 'Trecí pant', (c) => (c.vetraciaKlapka ? 3 : 0)],

	// DVERE (len ak sú dvere; dorazy + krytky podľa zvolenej RAL)
	['BPK202540', 'Dverový doraz R7016', (c) => (c.dvere && c.ralKrytiek === 'R7016' ? 4 : 0)],
	['BPK202539', 'Dverový doraz R9006', (c) => (c.dvere && c.ralKrytiek === 'R9006' ? 4 : 0)],
	[
		'BPK202536',
		'Krytka dverového kladkového profilu L R7016',
		(c) => (c.dvere && c.ralKrytiek === 'R7016' ? 1 : 0)
	],
	[
		'BPK202533',
		'Krytka dverového kladkového profilu L R9006',
		(c) => (c.dvere && c.ralKrytiek === 'R9006' ? 1 : 0)
	],
	[
		'BPK202535',
		'Krytka dverového kladkového profilu P R7016',
		(c) => (c.dvere && c.ralKrytiek === 'R7016' ? 1 : 0)
	],
	[
		'BPK202537',
		'Krytka dverového kladkového profilu P R9006',
		(c) => (c.dvere && c.ralKrytiek === 'R9006' ? 1 : 0)
	],

	// KRYTKY (RAL 9006/7016 — nezvolený variant = 0 ks = absent)
	[
		'BPK202522',
		'Krytka kladkového profilu L R7016',
		(c) => ral(c, 'R7016', c.dvoj ? 2 * c.s : c.s)
	],
	['BPK20251', 'Krytka kladkového profilu L R9006', (c) => ral(c, 'R9006', c.dvoj ? 2 * c.s : c.s)],
	[
		'BPK202523',
		'Krytka kladkového profilu P R7016',
		(c) => ral(c, 'R7016', c.dvoj ? 2 * c.s : c.s)
	],
	['BPK20258', 'Krytka kladkového profilu P R9006', (c) => ral(c, 'R9006', c.dvoj ? 2 * c.s : c.s)],
	[
		'BPK202524',
		'Krytka kladkového profilu aretácia L R7016',
		(c) => ral(c, 'R7016', c.jedno ? c.s : 0)
	],
	[
		'BPK20256',
		'Krytka kladkového profilu aretácia L R9006',
		(c) => ral(c, 'R9006', c.jedno ? c.s : 0)
	],
	[
		'BPK202525',
		'Krytka kladkového profilu aretácia P R7016',
		(c) => ral(c, 'R7016', c.jedno ? c.s : 0)
	],
	[
		'BPK20257',
		'Krytka kladkového profilu aretácia P R9006',
		(c) => ral(c, 'R9006', c.jedno ? c.s : 0)
	],
	['BPK202526', 'Krytka čelovej nožičky L R7016', (c) => ral(c, 'R7016', c.nozicka(2, 1, 2))],
	['BPK20254', 'Krytka čelovej nožičky L R9006', (c) => ral(c, 'R9006', c.nozicka(2, 1, 2))],
	['BPK202527', 'Krytka čelovej nožičky P R7016', (c) => ral(c, 'R7016', c.nozicka(2, 1, 2))],
	['BPK20255', 'Krytka čelovej nožičky P R9006', (c) => ral(c, 'R9006', c.nozicka(2, 1, 2))],
	['BPK202531', 'Krytka krajovej nožičky R7016', (c) => ral(c, 'R7016', c.nozicka(0, 2, 2))],
	['BPK202529', 'Krytka krajovej nožičky R9006', (c) => ral(c, 'R9006', c.nozicka(0, 2, 2))]
];

/**
 * Usporiadaný zoznam VŠETKÝCH BPK kódov, ktoré katalóg môže vydať (jeden zdroj pravdy).
 * Autoritatívny obsah + poradie = Dominikova tabuľka `att 14674` (98 riadkov / 57 kódov,
 * #355/#368). `tests/bazen-komponenty-katalog.test.ts` ho zamyká proti nezávisle
 * prepísanému zoznamu z tej tabuľky — tichý drop/pridanie kódu tak padne v CI.
 */
export const BPK_KODY: readonly string[] = KATALOG.map(([kod]) => kod);

/** Vráti `qty` len keď sa zvolená RAL zhoduje s variantom riadku, inak 0 (absent). */
function ral(c: Ctx, variant: RalKrytiek, qty: number): number {
	return c.ralKrytiek === variant ? qty : 0;
}

/**
 * Spočíta kusové komponenty bazéna. Vracia LEN riadky s qty > 0 (0/záporné sa
 * vynechajú — nikdy „0 ks" do Money), v poradí katalógu.
 */
export function pocitajBazenKomponenty(v: BazenKompVstup): BazenKomponent[] {
	const s = Math.max(0, Math.round(v.pocetSekcii));
	const c: Ctx = {
		...v,
		s,
		jedno: !v.dvojkolaj,
		dvoj: v.dvojkolaj,
		auto: v.aretaciaTyp === 'automaticka',
		sMinus1: Math.max(0, s - 1),
		nozicka: (velkaKs, strednaKs, malaKs) =>
			velkaKs * Math.max(0, v.velka) +
			strednaKs * Math.max(0, v.stredna) +
			malaKs * Math.max(0, v.mala)
	};
	const out: BazenKomponent[] = [];
	for (const [kod, nazov, fn] of KATALOG) {
		const q = Math.round(fn(c));
		if (q > 0) out.push({ kod, nazov, qty: q, mj: 'ks' });
	}
	return out;
}
