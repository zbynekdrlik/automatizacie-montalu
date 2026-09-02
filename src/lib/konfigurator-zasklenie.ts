// Verejný zákaznícky konfigurátor zasklenia terás a balkónov (#387, etapa jednotného rámu #384) —
// ČISTÝ, CLIENT-SAFE modul. Display-only, BEZ CIEN (honest-null — zasklenie nemá overený cenový
// zdroj, viď design komentár #387), BEZ interných Money kódov. NEIMPORTUJE interné zasklenie moduly
// (`sklo`, `zasklenia-navrh`, `server/komponenty-cfg`/`vstup`/`kovanie`) — tie nesú reálne Money
// odpisové kódy rodiny ZAS-P / ZAS-K (leak-guard vzor chytá holý kód). Zákaznícka vrstva je oddelená od Money
// katalógu presne ako `konfigurator-bazen.ts`/`konfigurator-sklo.ts`. Nesie LEN prezentačné texty +
// rozmerové rozmedzia (žiadny Money kód, žiadna cena) → leak-guard (A) `konfigurator-money-safety`
// ho prejde bez porušenia. Priamo unit-testovateľný.
import type { PonukaConfig } from '$lib/ponuka';
import { cislaCiarka } from '$lib/konfigurator-jednotky';

/** Umiestnenie zasklenia — primárna os (terasa vs balkón). Určuje, ktoré modely sú na výber
 *  (montalu.sk má terasové a balkónové modely ako oddelené skupiny). */
export type ZaskleniUmiestnenie = 'Terasa' | 'Balkón';

/** Model zasklenia (whitelist — reálna ponuka montalu.sk `/produkty/zasklenia`, overené).
 *  Terasy: ROBUST / SLIDE / STANDARD PLUS / DELUX; balkóny: STANDARD / LUX. Sú to LEN string
 *  literály, žiadny Money kód. */
export type ZaskleniModel = 'ROBUST' | 'SLIDE' | 'STANDARD PLUS' | 'DELUX' | 'STANDARD' | 'LUX';

export interface ZaskleniModelInfo {
	kod: ZaskleniModel;
	/** ku ktorému umiestneniu model patrí (terasa vs balkón) */
	umiestnenie: ZaskleniUmiestnenie;
	/** typ systému ako zákaznícky label (rámový posuvný / bezrámový) — je to VLASTNOSŤ modelu,
	 *  nie samostatná os (na montalu.sk sú rámové/bezrámové rozlíšené práve modelom) */
	system: string;
	/** krátky zákaznícky popis (parafráza reálnych montalu popisov — bez merateľných tvrdení) */
	popis: string;
}

/** Modely na výber (poradie = zákaznícky rebríček per umiestnenie). LEN popisy, ŽIADNA cena. */
export const ZASKLENIE_MODELY: readonly ZaskleniModelInfo[] = [
	// --- terasy ---
	{
		kod: 'ROBUST',
		umiestnenie: 'Terasa',
		system: 'Rámový posuvný',
		popis: 'Hliníkový rámový posuvný systém s vysokou variabilitou a prepracovaným odvodnením.'
	},
	{
		kod: 'SLIDE',
		umiestnenie: 'Terasa',
		system: 'Rámový posuvný',
		popis: 'Odľahčené tenké profily pre jednoduchú, rýchlu manipuláciu a elegantný vzhľad.'
	},
	{
		kod: 'STANDARD PLUS',
		umiestnenie: 'Terasa',
		system: 'Rámový posuvný',
		popis: 'Najpoužívanejší rámový systém — sklá sa posúvajú po koľajnici a skladajú za seba.'
	},
	{
		kod: 'DELUX',
		umiestnenie: 'Terasa',
		system: 'Bezrámový',
		popis: 'Jeden z najmodernejších typov — uzavretý priestor s ničím nerušeným výhľadom.'
	},
	// --- balkóny ---
	{
		kod: 'STANDARD',
		umiestnenie: 'Balkón',
		system: 'Rámový posuvný',
		popis: 'Overený rámový posuvný systém na uzavretie balkóna či inej otvorenej plochy.'
	},
	{
		kod: 'LUX',
		umiestnenie: 'Balkón',
		system: 'Bezrámový otočný',
		popis:
			'Bezrámový otočný systém z číreho bezpečnostného skla vo vodiacich hliníkových profiloch.'
	}
];

export const ZASKLENIE_UMIESTNENIA: readonly ZaskleniUmiestnenie[] = ['Terasa', 'Balkón'];
export const ZASKLENIE_UMIESTNENIE_DEFAULT: ZaskleniUmiestnenie = 'Terasa';

/** Genitív umiestnenia pre názov systému / lead („Zasklenie terasy — SLIDE"). */
const GENITIV: Record<ZaskleniUmiestnenie, string> = {
	Terasa: 'terasy',
	Balkón: 'balkóna'
};

/** Modely dostupné pre dané umiestnenie (poradie zachované). */
export function zaskleniModelyPre(u: ZaskleniUmiestnenie): readonly ZaskleniModelInfo[] {
	return ZASKLENIE_MODELY.filter((m) => m.umiestnenie === u);
}

/** Default model pre umiestnenie (prvý v poradí — terasa STANDARD PLUS je najpoužívanejšie,
 *  ale poradie určuje pole; bezpečný fallback ROBUST/STANDARD ak by sa poradie zmenilo). */
export function zaskleniModelDefault(u: ZaskleniUmiestnenie): ZaskleniModel {
	return zaskleniModelyPre(u)[0]?.kod ?? 'ROBUST';
}

/** Zákaznícke kategórie výplne (sklo) — LEN prezentačné názvy, žiadny Money kód. Tečú nezmenené
 *  do PDF špecifikácie / dopytu (pipeline dostáva reťazec). */
export const ZASKLENIE_VYPLNE: readonly { nazov: string; popis: string }[] = [
	{ nazov: 'Číre kalené sklo', popis: 'Maximálna priehľadnosť a presvetlenie.' },
	{ nazov: 'Matné (satináto) sklo', popis: 'Rozptýlené svetlo a väčšie súkromie.' },
	{ nazov: 'Dymové (tónované) sklo', popis: 'Tónovaný vzhľad a tlmenie priameho slnka.' }
];
export const ZASKLENIE_VYPLN_DEFAULT = 'Číre kalené sklo';

// Zákaznícke rozmerové rozmedzia (mm) — ORIENTAČNÉ, na dopyt (žiadna cenotvorná mriežka; presné
// rozmery sa upresnia po zameraní). Interné = mm, jednotný tvar { min, max, krok }.
export const ZASKLENIE_SIRKA_MIN = 1500;
export const ZASKLENIE_SIRKA_MAX = 12000;
export const ZASKLENIE_VYSKA_MIN = 1500;
export const ZASKLENIE_VYSKA_MAX = 3500;
export const ZASKLENIE_KRIDLA_MIN = 2;
export const ZASKLENIE_KRIDLA_MAX = 8;

/** Rozmedzia pre klienta (input min/max/krok hinty) — žiadny Money údaj. Šírka/výška na 100 mm
 *  mriežke metrového stepera (#333 RozmerStepper); počet krídel = celé číslo (<select>). */
export const ZASKLENIE_RANGES = {
	sirka: { min: ZASKLENIE_SIRKA_MIN, max: ZASKLENIE_SIRKA_MAX, krok: 500 },
	vyska: { min: ZASKLENIE_VYSKA_MIN, max: ZASKLENIE_VYSKA_MAX, krok: 100 },
	kridla: { min: ZASKLENIE_KRIDLA_MIN, max: ZASKLENIE_KRIDLA_MAX, krok: 1 }
} as const;

const UMIESTNENIE_SET = new Set<string>(ZASKLENIE_UMIESTNENIA);
const VYPLN_SET = new Set<string>(ZASKLENIE_VYPLNE.map((v) => v.nazov));

/** Umiestnenie z reťazca (whitelist; neznámy → default Terasa). */
export function zaskleniUmiestnenie(raw: string | null | undefined): ZaskleniUmiestnenie {
	const s = String(raw ?? '').trim();
	return UMIESTNENIE_SET.has(s) ? (s as ZaskleniUmiestnenie) : ZASKLENIE_UMIESTNENIE_DEFAULT;
}

/** Model z reťazca, VALIDNÝ pre dané umiestnenie (neznámy / z iného umiestnenia → default toho
 *  umiestnenia — bezpečný smer, žiadne nevalidné kombinácie modelu s cudzím umiestnením). */
export function zaskleniModel(
	raw: string | null | undefined,
	u: ZaskleniUmiestnenie
): ZaskleniModel {
	const s = String(raw ?? '').trim();
	const platne = new Set<string>(zaskleniModelyPre(u).map((m) => m.kod));
	return platne.has(s) ? (s as ZaskleniModel) : zaskleniModelDefault(u);
}

/** Výplň z reťazca (whitelist; neznámy → default Číre kalené sklo). */
export function zaskleniVypln(raw: string | null | undefined): string {
	const s = String(raw ?? '').trim();
	return VYPLN_SET.has(s) ? s : ZASKLENIE_VYPLN_DEFAULT;
}

/** Systém (rámový/bezrámový label) pre model v danom umiestnení. */
export function zaskleniSystem(model: ZaskleniModel, u: ZaskleniUmiestnenie): string {
	return zaskleniModelyPre(u).find((m) => m.kod === model)?.system ?? '';
}

export interface ZaskleniVstup {
	umiestnenie: ZaskleniUmiestnenie;
	model: ZaskleniModel;
	/** šírka zasklievanej plochy (otvoru) [mm] */
	sirka: number;
	/** výška zasklievanej plochy [mm] */
	vyska: number;
	/** počet krídel / polí (celé číslo) */
	kridla: number;
	/** kategória výplne / skla (názov) */
	vypln: string;
	/** farba konštrukcie ako display label, napr. „RAL 7016 ANTRACIT" */
	farba: string;
}

export interface ZaskleniSuhrn {
	umiestnenie: ZaskleniUmiestnenie;
	model: ZaskleniModel;
	/** typ systému (rámový/bezrámový label) pre zvolený model */
	system: string;
	sirka: number;
	vyska: number;
	kridla: number;
	/** zasklená plocha [m²] = šírka × výška (zaokrúhlené na 1 desatinu) */
	plochaM2: number;
	vypln: string;
	farba: string;
}

const R1 = (x: number) => Math.round(x * 10) / 10;

function vRozmedzi(v: number, lo: number, hi: number): boolean {
	return Number.isFinite(v) && v >= lo && v <= hi;
}

/** Je vstup celý v platných rozmedziach? (na zobrazenie súhrnu / povolenie dopytu). */
export function zaskleniVstupPlatny(v: ZaskleniVstup): boolean {
	return (
		vRozmedzi(v.sirka, ZASKLENIE_SIRKA_MIN, ZASKLENIE_SIRKA_MAX) &&
		vRozmedzi(v.vyska, ZASKLENIE_VYSKA_MIN, ZASKLENIE_VYSKA_MAX) &&
		Number.isInteger(v.kridla) &&
		vRozmedzi(v.kridla, ZASKLENIE_KRIDLA_MIN, ZASKLENIE_KRIDLA_MAX)
	);
}

/** Zostaví zákaznícky súhrn konfigurácie (display-only, BEZ ceny, BEZ Money kódu). */
export function konfigurujZasklenie(v: ZaskleniVstup): ZaskleniSuhrn {
	return {
		umiestnenie: v.umiestnenie,
		model: v.model,
		system: zaskleniSystem(v.model, v.umiestnenie),
		sirka: v.sirka,
		vyska: v.vyska,
		kridla: v.kridla,
		plochaM2: R1((v.sirka * v.vyska) / 1_000_000),
		vypln: v.vypln,
		farba: v.farba
	};
}

/** Zmapuje zasklenie súhrn na zdieľaný `PonukaConfig` pre dopyt/PDF (#277 tok). Používa LEN
 *  NEUTRÁLNE polia: model → `system` („Zasklenie terasy — SLIDE"), ŠÍRKA → `sirka` (→ riadok
 *  „Šírka"), výška + počet krídel + plocha → `popis`. Pergolové polia (`hlbka`/`vyskaVpredu`/
 *  `model`/`pocetPoli`) sa NEPOUŽIJÚ, aby PDF nebolo zavádzajúce. BEZ ceny, BEZ Money kódu — cena
 *  je honest-null (zasklenie nemá overený cenový zdroj; gate `maCenovyZdroj` v `konfigurator-produkty`). */
export function zaskleniePonukaConfig(s: ZaskleniSuhrn): PonukaConfig {
	return {
		system: `Zasklenie ${GENITIV[s.umiestnenie]} — ${s.model} (${s.system})`,
		sirka: s.sirka,
		farba: s.farba,
		sklo: s.vypln,
		popis:
			`Výška ${s.vyska} mm · počet krídel ${s.kridla}` +
			` · zasklená plocha ${cislaCiarka(s.plochaM2)} m².`
	};
}
