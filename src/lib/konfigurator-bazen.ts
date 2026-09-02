// Verejný zákaznícky konfigurátor bazénových zastrešení (#385, etapa 2 jednotného rámu #384) —
// ČISTÝ, CLIENT-SAFE modul. Display-only, BEZ CIEN, BEZ interných Money kódov. NEIMPORTUJE
// `bazen-komponenty`/`server/bazen` (tie nesú Money BPK/BPP odpisové kódy) — zákaznícka vrstva je
// oddelená od Money katalógu presne ako `konfigurator-sklo.ts` je oddelená od `sklo-strecha`. Nesie
// LEN prezentačné texty + rozmerové rozmedzia (žiadny Money kód, žiadna cena) → leak-guard (A)
// `konfigurator-money-safety` ho prejde bez porušenia. Priamo unit-testovateľný.
import type { PonukaConfig } from '$lib/ponuka';
import { cislaCiarka } from '$lib/konfigurator-jednotky';

/** Model bazénového zastrešenia (whitelist — zrkadlí interný `parseBazenVstup` #355:
 *  'Premier' | 'Exclusive' | 'Star'). Sú to LEN string literály, žiadny Money kód. */
export type BazenModel = 'Premier' | 'Exclusive' | 'Star';

export interface BazenModelInfo {
	kod: BazenModel;
	/** krátky zákaznícky popis (bez merateľných tvrdení — presnú marketingovú kópiu doplní owner) */
	popis: string;
}

/** Modely na výber (poradie = zákaznícky rebríček). LEN popisy, ŽIADNA cena. */
export const BAZEN_MODELY: readonly BazenModelInfo[] = [
	{ kod: 'Premier', popis: 'Obľúbené zastrešenie so spoľahlivou konštrukciou a výbavou.' },
	{ kod: 'Exclusive', popis: 'Prémiové vyhotovenie s vyšším komfortom prechodu.' },
	{ kod: 'Star', popis: 'Dizajnová rada s čistými líniami a moderným profilom.' }
];
export const BAZEN_MODEL_DEFAULT: BazenModel = 'Premier';

/** Koľajový systém — jedno- alebo dvojkoľajové rozsúvanie (karta produktu: „Jedno- a dvojkoľajové"). */
export type BazenKolaj = 'Jednokoľajové' | 'Dvojkoľajové';
export const BAZEN_KOLAJ: readonly { kod: BazenKolaj; popis: string }[] = [
	{ kod: 'Jednokoľajové', popis: 'Segmenty sa zasúvajú do seba v jednom smere — úspora miesta.' },
	{ kod: 'Dvojkoľajové', popis: 'Rozsúvanie na obe strany — pohodlnejší prístup k bazénu.' }
];
export const BAZEN_KOLAJ_DEFAULT: BazenKolaj = 'Jednokoľajové';

/** Zákaznícke kategórie výplne (polykarbonát) — LEN prezentačné názvy, žiadny Money kód. Tečú
 *  nezmenené do PDF špecifikácie / dopytu (pipeline dostáva reťazec). */
export const BAZEN_VYPLNE: readonly { nazov: string; popis: string }[] = [
	{ nazov: 'Číry polykarbonát', popis: 'Maximálna priehľadnosť a presvetlenie.' },
	{ nazov: 'Opálový (mliečny) polykarbonát', popis: 'Rozptýlené svetlo, väčšie súkromie.' },
	{ nazov: 'Dymový (bronzový) polykarbonát', popis: 'Tónovaný vzhľad, tlmenie priameho slnka.' }
];
export const BAZEN_VYPLN_DEFAULT = 'Číry polykarbonát';

// Zákaznícke rozmerové rozmedzia (mm) — ORIENTAČNÉ, na dopyt (žiadna cenotvorná mriežka; presné
// rozmery sa upresnia po zameraní). Interné = mm, jednotný tvar { min, max, krok }.
export const BAZEN_DLZKA_MIN = 3000;
export const BAZEN_DLZKA_MAX = 15000;
export const BAZEN_SIRKA_MIN = 2000;
export const BAZEN_SIRKA_MAX = 7000;
// krok 500 mm (0,5 m) — na 100 mm mriežke zákazníckeho metrového stepera (#333 RozmerStepper).
export const BAZEN_VYSKA_MIN = 700;
export const BAZEN_VYSKA_MAX = 2500;
export const BAZEN_SEGMENTY_MIN = 2;
export const BAZEN_SEGMENTY_MAX = 8;

/** Rozmedzia pre klienta (input min/max/krok hinty) — žiadny Money údaj. */
export const BAZEN_RANGES = {
	dlzka: { min: BAZEN_DLZKA_MIN, max: BAZEN_DLZKA_MAX, krok: 500 },
	sirka: { min: BAZEN_SIRKA_MIN, max: BAZEN_SIRKA_MAX, krok: 500 },
	vyska: { min: BAZEN_VYSKA_MIN, max: BAZEN_VYSKA_MAX, krok: 100 },
	segmenty: { min: BAZEN_SEGMENTY_MIN, max: BAZEN_SEGMENTY_MAX, krok: 1 }
} as const;

const MODEL_SET = new Set<string>(BAZEN_MODELY.map((m) => m.kod));
const KOLAJ_SET = new Set<string>(BAZEN_KOLAJ.map((k) => k.kod));
const VYPLN_SET = new Set<string>(BAZEN_VYPLNE.map((v) => v.nazov));

/** Model z reťazca (whitelist; neznámy → default Premier — bezpečný smer, vzor #355 parseBazenVstup). */
export function bazenModel(raw: string | null | undefined): BazenModel {
	const s = String(raw ?? '').trim();
	return MODEL_SET.has(s) ? (s as BazenModel) : BAZEN_MODEL_DEFAULT;
}
/** Koľaj z reťazca (whitelist; neznámy → default Jednokoľajové). */
export function bazenKolaj(raw: string | null | undefined): BazenKolaj {
	const s = String(raw ?? '').trim();
	return KOLAJ_SET.has(s) ? (s as BazenKolaj) : BAZEN_KOLAJ_DEFAULT;
}
/** Výplň z reťazca (whitelist; neznámy → default Číry polykarbonát). */
export function bazenVypln(raw: string | null | undefined): string {
	const s = String(raw ?? '').trim();
	return VYPLN_SET.has(s) ? s : BAZEN_VYPLN_DEFAULT;
}

export interface BazenVstup {
	model: BazenModel;
	kolaj: BazenKolaj;
	/** dĺžka zastrešenia (pozdĺž bazéna) [mm] */
	dlzka: number;
	/** šírka zastrešenia [mm] */
	sirka: number;
	/** výška (oblúk v najvyššom bode) [mm] */
	vyska: number;
	/** počet segmentov (celé číslo) */
	segmenty: number;
	/** kategória výplne (názov) */
	vypln: string;
	/** farba konštrukcie ako display label, napr. „RAL 7016 ANTRACIT" */
	farba: string;
}

export interface BazenSuhrn {
	model: BazenModel;
	kolaj: BazenKolaj;
	dlzka: number;
	sirka: number;
	vyska: number;
	segmenty: number;
	/** zastrešená pôdorysná plocha [m²] = dĺžka × šírka (zaokrúhlené na 1 desatinu) */
	plochaM2: number;
	vypln: string;
	farba: string;
}

const R1 = (x: number) => Math.round(x * 10) / 10;

function vRozmedzi(v: number, lo: number, hi: number): boolean {
	return Number.isFinite(v) && v >= lo && v <= hi;
}

/** Je vstup celý v platných rozmedziach? (na zobrazenie súhrnu / povolenie dopytu). */
export function bazenVstupPlatny(v: BazenVstup): boolean {
	return (
		vRozmedzi(v.dlzka, BAZEN_DLZKA_MIN, BAZEN_DLZKA_MAX) &&
		vRozmedzi(v.sirka, BAZEN_SIRKA_MIN, BAZEN_SIRKA_MAX) &&
		vRozmedzi(v.vyska, BAZEN_VYSKA_MIN, BAZEN_VYSKA_MAX) &&
		Number.isInteger(v.segmenty) &&
		vRozmedzi(v.segmenty, BAZEN_SEGMENTY_MIN, BAZEN_SEGMENTY_MAX)
	);
}

/** Zostaví zákaznícky súhrn konfigurácie (display-only, BEZ ceny, BEZ Money kódu). */
export function konfigurujBazen(v: BazenVstup): BazenSuhrn {
	return {
		model: v.model,
		kolaj: v.kolaj,
		dlzka: v.dlzka,
		sirka: v.sirka,
		vyska: v.vyska,
		segmenty: v.segmenty,
		plochaM2: R1((v.dlzka * v.sirka) / 1_000_000),
		vypln: v.vypln,
		farba: v.farba
	};
}

/** Zmapuje bazén súhrn na zdieľaný `PonukaConfig` pre dopyt/PDF (#277 tok). Používa LEN NEUTRÁLNE
 *  polia, ktoré čítajú správne aj pre zastrešenie: model → `system`, DĹŽKA → `dlzka` + šírka →
 *  `sirka` (→ „Rozmery (d × š)", zhodné poradie so zákazníckou stránkou AJ PDF), výška+koľaj+
 *  segmenty+plocha → `popis`. Pergolové polia (`hlbka`/`vyskaVpredu`/`model`/`pocetPoli`) sa
 *  NEPOUŽIJÚ, aby PDF nebolo zavádzajúce. BEZ Money kódu — cenu (orientačnú MO, #404) počíta SERVER
 *  produkt-aware z `systemKod`+`dlzka`+`sirka` (`cenaZCfgProdukt`), nikdy klient. */
export function bazenPonukaConfig(s: BazenSuhrn): PonukaConfig {
	return {
		system: `Bazénové zastrešenie — ${s.model}`,
		// #404: neutrálny cenotvorný kód = bazénový model — server (`cenaZCfgProdukt`/`opeciatkujCenuPreProdukt`)
		// z neho + dlzka/sirka spočíta orientačnú cenu; deterministicky reprodukovateľné pri re-downloade.
		systemKod: s.model,
		dlzka: s.dlzka,
		sirka: s.sirka,
		farba: s.farba,
		sklo: s.vypln,
		popis:
			`Výška zastrešenia ${s.vyska} mm · ${s.kolaj} · počet segmentov ${s.segmenty}` +
			` · zastrešená plocha ${cislaCiarka(s.plochaM2)} m².`
	};
}
