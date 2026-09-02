// Verejný zákaznícky konfigurátor zimných záhrad (#386, etapa 3 jednotného rámu #384) —
// ČISTÝ, CLIENT-SAFE modul. Display-only, BEZ CIEN, BEZ interných Money kódov. Interná appka NEMÁ
// modul zimných záhrad (žiadny odpisový/Money katalóg), takže tu ani netreba oddeľovať Money zdroj —
// je to čistá zákaznícka vrstva (vzor `konfigurator-bazen.ts` / `konfigurator-sklo.ts`). Nesie LEN
// prezentačné texty + rozmerové rozmedzia (žiadny Money kód, žiadna cena) → leak-guard (A)
// `konfigurator-money-safety` ho prejde bez porušenia. Priamo unit-testovateľný.
//
// Varianty (modely + zasklenie) sú OVERENÉ na živom montalu.sk (`montalu.sk/produkty/zimne-zahrady`),
// nevymyslené — viď design komentár #386.
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

// Zákaznícke rozmerové rozmedzia (mm) — ORIENTAČNÉ, na dopyt (žiadna cenotvorná mriežka; presné
// rozmery sa upresnia po zameraní). Interné = mm, jednotný tvar { min, max, krok }. Zimná záhrada =
// izbový prístavok: šírka (pozdĺž steny) × hĺbka (vysunutie) × výška.
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

export interface ZzVstup {
	model: ZzModel;
	/** šírka (pozdĺž steny) [mm] */
	sirka: number;
	/** hĺbka (vysunutie od steny) [mm] */
	hlbka: number;
	/** výška [mm] */
	vyska: number;
	/** kategória zasklenia (názov) */
	zasklenie: string;
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
		farba: v.farba
	};
}

/** Zmapuje súhrn zimnej záhrady na zdieľaný `PonukaConfig` pre dopyt/PDF (#277 tok). Používa LEN
 *  NEUTRÁLNE polia: model → `system`; šírka → `sirka` + hĺbka → `hlbka` (→ „Rozmery (š × h)",
 *  poradie zhodné so zákazníckou stránkou AJ PDF — zimná záhrada je izbového tvaru š × h, na rozdiel
 *  od dĺžkovo-dominantného bazéna, ktorý používa neutrálne `dlzka`); výška + plocha → `popis`;
 *  zasklenie → `sklo`. Pergolové polia (`vyskaVpredu`/`vyskaPriStene`/`model`/`pocetPoli`) sa
 *  NEPOUŽIJÚ, aby PDF nebolo zavádzajúce. BEZ ceny, BEZ Money kódu — cena je honest-null (zimná
 *  záhrada nemá overený cenový zdroj; gate `maCenovyZdroj` v `konfigurator-produkty`). */
export function zimnaZahradaPonukaConfig(s: ZzSuhrn): PonukaConfig {
	return {
		system: `Zimná záhrada — ${s.model}`,
		sirka: s.sirka,
		hlbka: s.hlbka,
		farba: s.farba,
		sklo: s.zasklenie,
		popis: `Výška ${s.vyska} mm · zastavaná plocha ${cislaCiarka(s.plochaM2)} m².`
	};
}
