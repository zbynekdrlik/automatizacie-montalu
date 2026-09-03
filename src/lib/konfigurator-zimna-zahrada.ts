// Verejný zákaznícky konfigurátor zimných záhrad (#386, etapa 3 jednotného rámu #384; #408 cena;
// #429 systém stien) — ČISTÝ, CLIENT-SAFE modul. BEZ interných Money kódov, BEZ ceny (cenu počíta
// server-only modul `konfigurator-zimna-zahrada-cena` z matice montalu.sk — tento klientsky modul
// cenu nenesie). Interná appka NEMÁ modul zimných záhrad (žiadny odpisový/Money katalóg), takže tu
// ani netreba oddeľovať Money zdroj — je to čistá zákaznícka vrstva (vzor `konfigurator-bazen.ts` /
// `konfigurator-sklo.ts`). Nesie LEN prezentačné texty + rozmerové rozmedzia (žiadny Money kód,
// žiadna cena) → leak-guard (A) `konfigurator-money-safety` ho prejde bez porušenia. Priamo
// unit-testovateľné.
//
// Varianty (modely + zasklenie) sú OVERENÉ na živom montalu.sk (`montalu.sk/produkty/zimne-zahrady`),
// nevymyslené — viď design komentár #386. Systém stien (#429) je OVERENÝ na živom CENOVOM
// konfigurátore (`montalu.sk/konfigurator/zimne-zahrady`, `name="glazing"` radio inputy, doslovné
// `data-update` labely — network capture, viď design komentár #429, nie marketingová stránka: presne
// §12 pasca „VARIANTY NEVYMÝŠĽAJ" z `konfigurator.md`).
import type { PonukaConfig } from '$lib/ponuka';
import { cislaCiarka } from '$lib/konfigurator-jednotky';

/** Typizovaný hliníkový model zimnej záhrady (whitelist — montalu.sk: ROBUST | MASSIVE, MASSIVE =
 *  zosilnená verzia ROBUST). Sú to LEN string literály, žiadny Money kód. */
export type ZzModel = 'ROBUST' | 'MASSIVE';

export interface ZzModelInfo {
	kod: ZzModel;
	/** krátky zákaznícky popis (bez merateľných tvrdení — presnú marketingovú kópiu doplní owner) */
	popis: string;
}

/** Modely na výber (poradie = zákaznícky rebríček). LEN popisy, ŽIADNA cena. */
export const ZZ_MODELY: readonly ZzModelInfo[] = [
	{ kod: 'ROBUST', popis: 'Mohutná hliníková konštrukcia s vysokou tepelnou izoláciou.' },
	{
		kod: 'MASSIVE',
		popis: 'Zosilnená verzia ROBUST pre veľké presklené plochy a náročné podmienky.'
	}
];
export const ZZ_MODEL_DEFAULT: ZzModel = 'ROBUST';

/** Zákaznícke kategórie zasklenia — LEN prezentačné názvy, žiadny Money kód. Tečú nezmenené do PDF
 *  špecifikácie / dopytu (pipeline dostáva reťazec). Terminológia DOSLOVNE z montalu.sk (produktová
 *  stránka zimných záhrad menuje zasklievacie materiály „polykarbonát, bezpečnostné sklo, izolačné
 *  sklo či panel ISODOMUS"; zimná záhrada = „hliníková pergola + kvalitné zasklenie"). Nevymyslené —
 *  žiadne „dvojsklo/trojsklo", ktoré montalu.sk neuvádza (#386 review 🟡). */
export const ZZ_ZASKLENIA: readonly { nazov: string; popis: string }[] = [
	{
		nazov: 'Izolačné sklo',
		popis: 'Zasklenie s dobrou tepelnou izoláciou pre celoročné využitie.'
	},
	{ nazov: 'Bezpečnostné sklo', popis: 'Kalené / vrstvené sklo pre vyššiu bezpečnosť.' },
	{ nazov: 'Polykarbonát', popis: 'Ľahká presvetlená výplň — najmä pre strešnú časť.' },
	{ nazov: 'Panel ISODOMUS', popis: 'Sendvičový panel s vysokou tepelnou izoláciou.' }
];
export const ZZ_ZASKLENIE_DEFAULT = 'Izolačné sklo';

/** Zákaznícky systém stien — LEN prezentačné názvy, žiadny Money kód. #429: TERAZ REÁLNA cenotvorná
 *  voľba (predtým #408 Prístup 3 fixoval bázový systém, cena naň nereagovala). Terminológia DOSLOVNE
 *  z montalu.sk cenového konfigurátora (`data-update` radio label, network capture — nie marketingová
 *  stránka): 4 systémy (Delux/Standard plus/Slide/Robust), Standard plus a Slide majú 2 hrúbky skla →
 *  6 kombinácií spolu. Popis je odvodený LEN z hrúbky/typu skla uvedeného v montalu labeli (žiadne
 *  vymyslené funkčné tvrdenia — §12 pasca „VARIANTY NEVYMÝŠĽAJ"). */
export const ZZ_SYSTEMY_STIEN: readonly { nazov: string; popis: string }[] = [
	{ nazov: 'Deluxe bezrámový - 10mm sklo', popis: 'Bezrámový systém stien, kalené sklo 10 mm.' },
	{ nazov: 'Štandard plus - 6mm sklo', popis: 'Systém stien Standard plus, rezané sklo 6 mm.' },
	{
		nazov: 'Štandard plus - 16mm sklo',
		popis: 'Systém stien Standard plus, izolačné sklo 16 mm.'
	},
	{ nazov: 'Slide - 6mm sklo', popis: 'Systém stien Slide, rezané sklo 6 mm.' },
	{ nazov: 'Slide - 16mm sklo', popis: 'Systém stien Slide, izolačné sklo 16 mm.' },
	{ nazov: 'Robust - 24mm IZO sklo', popis: 'Systém stien Robust, izolačné sklo 24 mm.' }
];
/** Default = dnešná (#408) BÁZA — non-breaking: kto voľbu nezmení, dostane byte-identickú cenu ako
 *  pred #429. */
export const ZZ_SYSTEM_STIEN_DEFAULT = 'Slide - 16mm sklo';

// Zákaznícke rozmerové rozmedzia (mm). Interné = mm, jednotný tvar { min, max, krok }. Zimná záhrada =
// izbový prístavok: šírka (pozdĺž steny) × hĺbka (vysunutie) × výška. #408: šírka+hĺbka sú AJ cenotvorné
// vstupy (parser `konfigurator-zimna-zahrada-vstup` ich validuje voči matici montalu.sk — mimo katalógu
// nad hĺbku 6 m / šírku 7,5 m ⇒ individuálna ponuka); výška ostáva len spec (montalu cenu nemení).
export const ZZ_SIRKA_MIN = 2000;
export const ZZ_SIRKA_MAX = 8000;
export const ZZ_HLBKA_MIN = 2000;
export const ZZ_HLBKA_MAX = 6000;
export const ZZ_VYSKA_MIN = 2200;
export const ZZ_VYSKA_MAX = 4000;

/** Rozmedzia pre klienta (input min/max/krok hinty) — žiadny Money údaj. Krok 500 mm (0,5 m) na šírke
 *  a hĺbke, 100 mm (0,1 m) na výške — všetky na 100 mm mriežke zákazníckeho metrového stepera (#333). */
export const ZZ_RANGES = {
	sirka: { min: ZZ_SIRKA_MIN, max: ZZ_SIRKA_MAX, krok: 500 },
	hlbka: { min: ZZ_HLBKA_MIN, max: ZZ_HLBKA_MAX, krok: 500 },
	vyska: { min: ZZ_VYSKA_MIN, max: ZZ_VYSKA_MAX, krok: 100 }
} as const;

const MODEL_SET = new Set<string>(ZZ_MODELY.map((m) => m.kod));
const ZASKLENIE_SET = new Set<string>(ZZ_ZASKLENIA.map((z) => z.nazov));
const SYSTEM_STIEN_SET = new Set<string>(ZZ_SYSTEMY_STIEN.map((s) => s.nazov));

/** Model z reťazca (whitelist; neznámy → default ROBUST — bezpečný smer, vzor #385 bazenModel). */
export function zzModel(raw: string | null | undefined): ZzModel {
	const s = String(raw ?? '').trim();
	return MODEL_SET.has(s) ? (s as ZzModel) : ZZ_MODEL_DEFAULT;
}
/** Zasklenie z reťazca (whitelist; neznámy → default Izolačné sklo). */
export function zzZasklenie(raw: string | null | undefined): string {
	const s = String(raw ?? '').trim();
	return ZASKLENIE_SET.has(s) ? s : ZZ_ZASKLENIE_DEFAULT;
}
/** Systém stien z reťazca (whitelist; neznámy → default báza Slide 16mm, #429). */
export function zzSystemStien(raw: string | null | undefined): string {
	const s = String(raw ?? '').trim();
	return SYSTEM_STIEN_SET.has(s) ? s : ZZ_SYSTEM_STIEN_DEFAULT;
}

/** Delimiter kompozitného `systemKod` — ani `ZzModel` (ROBUST/MASSIVE) ani `ZZ_SYSTEMY_STIEN.nazov`
 *  (drift guard v teste) neobsahujú `|`, takže je bezpečný (vzor #410 oplotenie `systemKod`). */
const SYSTEM_KOD_DELIM = '|';

/** #429: zbal DISPLAY model (ROBUST/MASSIVE) + CENOTVORNÝ systém stien do jedného neutrálneho
 *  `PonukaConfig.systemKod` poľa (rovnaký vzor ako #410 oplotenie kompozitný systemKod) — nulová zmena
 *  zdieľaného `PonukaConfig` typu, honest-null gate (`cfg.systemKod` truthy) ostáva nedotknutý. */
export function zzSystemKod(model: ZzModel, systemStien: string): string {
	return `${model}${SYSTEM_KOD_DELIM}${systemStien}`;
}

/** Rozbaľ kompozitný `systemKod` späť na `{model, systemStien}` (whitelisted). Starý (pred-#429)
 *  riadok nesie LEN model (žiadny `|`) — degraduje sa na DEFAULT (bázový) systém stien, presne to,
 *  čo bolo v čase podania jediné cenené (čestné, nie tiché — vzor honest-degrade #408). */
export function parseZzSystemKod(systemKod: string | null | undefined): {
	model: ZzModel;
	systemStien: string;
} {
	const s = String(systemKod ?? '');
	const i = s.indexOf(SYSTEM_KOD_DELIM);
	if (i === -1) return { model: zzModel(s), systemStien: ZZ_SYSTEM_STIEN_DEFAULT };
	return { model: zzModel(s.slice(0, i)), systemStien: zzSystemStien(s.slice(i + 1)) };
}

export interface ZzVstup {
	model: ZzModel;
	/** šírka (pozdĺž steny) [mm] */
	sirka: number;
	/** hĺbka (vysunutie od steny) [mm] */
	hlbka: number;
	/** výška [mm] */
	vyska: number;
	/** kategória zasklenia (názov) → strešné zasklenie (roofing) */
	zasklenie: string;
	/** #429: systém stien (názov) → CENOTVORNÁ os (glazing); default báza Slide 16mm */
	systemStien: string;
	/** farba konštrukcie ako display label, napr. „RAL 7016 ANTRACIT" */
	farba: string;
}

export interface ZzSuhrn {
	model: ZzModel;
	sirka: number;
	hlbka: number;
	vyska: number;
	/** zastavaná pôdorysná plocha [m²] = šírka × hĺbka (zaokrúhlené na 1 desatinu) */
	plochaM2: number;
	zasklenie: string;
	/** #429: systém stien (názov) */
	systemStien: string;
	farba: string;
}

const R1 = (x: number) => Math.round(x * 10) / 10;

function vRozmedzi(v: number, lo: number, hi: number): boolean {
	return Number.isFinite(v) && v >= lo && v <= hi;
}

/** Je vstup celý v platných rozmedziach? (na zobrazenie súhrnu / povolenie dopytu). */
export function zzVstupPlatny(v: ZzVstup): boolean {
	return (
		vRozmedzi(v.sirka, ZZ_SIRKA_MIN, ZZ_SIRKA_MAX) &&
		vRozmedzi(v.hlbka, ZZ_HLBKA_MIN, ZZ_HLBKA_MAX) &&
		vRozmedzi(v.vyska, ZZ_VYSKA_MIN, ZZ_VYSKA_MAX)
	);
}

/** Zostaví zákaznícky súhrn konfigurácie (display-only, BEZ ceny, BEZ Money kódu). */
export function konfigurujZimnaZahradu(v: ZzVstup): ZzSuhrn {
	return {
		model: v.model,
		sirka: v.sirka,
		hlbka: v.hlbka,
		vyska: v.vyska,
		plochaM2: R1((v.sirka * v.hlbka) / 1_000_000),
		zasklenie: v.zasklenie,
		systemStien: v.systemStien,
		farba: v.farba
	};
}

/** Zmapuje súhrn zimnej záhrady na zdieľaný `PonukaConfig` pre dopyt/PDF (#277 tok). Používa LEN
 *  NEUTRÁLNE polia: model + #429 systém stien → kompozitný `systemKod` (`zzSystemKod`, vzor #410
 *  oplotenie — model je DISPLAY label, systém stien JE cenotvorný, oba uložené deterministicky do cfg,
 *  aby ich re-download cenovej pečiatky videl); šírka → `sirka` + hĺbka → `hlbka` (→ „Rozmery (š × h)",
 *  poradie zhodné so zákazníckou stránkou AJ PDF — zimná záhrada je izbového tvaru š × h, na rozdiel
 *  od dĺžkovo-dominantného bazéna, ktorý používa neutrálne `dlzka`); výška + plocha + systém stien →
 *  `popis`; zasklenie → `sklo`. Pergolové polia (`vyskaVpredu`/`vyskaPriStene`/`model`/`pocetPoli`) sa
 *  NEPOUŽIJÚ, aby PDF nebolo zavádzajúce. BEZ Money kódu. #408/#429: cena je interim orientačná
 *  (matica montalu.sk, gate `maCenovyZdroj('zimna-zahrada')` = true) — počíta ju SERVER z
 *  `hlbka`+`sirka`+`sklo`(zasklenie→roofing)+`systemKod`(→ systém stien→glazing); model časť
 *  `systemKod` je LEN display label vo `VerejnaCena.model` (cenu nemení — presné VYHOTOVENIE
 *  konštrukcie sa upresní po obhliadke). */
export function zimnaZahradaPonukaConfig(s: ZzSuhrn): PonukaConfig {
	return {
		system: `Zimná záhrada — ${s.model}`,
		systemKod: zzSystemKod(s.model, s.systemStien),
		sirka: s.sirka,
		hlbka: s.hlbka,
		farba: s.farba,
		sklo: s.zasklenie,
		popis: `Výška ${s.vyska} mm · zastavaná plocha ${cislaCiarka(s.plochaM2)} m² · systém stien ${s.systemStien}.`
	};
}
