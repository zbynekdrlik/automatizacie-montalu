// Verejný zákaznícky konfigurátor hliníkového oplotenia a brán (#388, etapa 5 jednotného rámu #384;
// #410 orientačná cena) — ČISTÝ, CLIENT-SAFE modul. Nesie LEN prezentačné texty + rozmerové rozmedzia
// (žiadny Money kód, žiadna cenová matica — tá je server-only v `konfigurator-oplotenie-cena`). #410:
// interim orientačná cena je vyťažená z matice montalu.sk (`update-fencings`) do server-only cenníka;
// cenotvorný kľúč nesie NEUTRÁLNE pole `systemKod` (`oploteniePonukaConfig` nižšie), cenu počíta SERVER.
// Na rozdiel od bazéna oplotenie NEMÁ žiadny interný odpisový modul, takže tu niet čo izolovať — modul
// je z princípu čistý → leak-guard (A) `konfigurator-money-safety` ho prejde. Priamo unit-testovateľný.
import type { PonukaConfig } from '$lib/ponuka';

/** Typ oplotenia/prvku (slug kód — testid/POST-safe; `nazov` = zákaznícky display). Zrkadlí reálnu
 *  ponuku montalu.sk: plotový diel + krídlová/posuvná/samonosná brána + vchodová bránka. */
export type OplotenieTypKod = 'diel' | 'kridlova' | 'posuvna' | 'samonosna' | 'branka';

export interface OplotenieTypInfo {
	kod: OplotenieTypKod;
	/** zákaznícky display názov (do súhrnu / `PonukaConfig.system`) */
	nazov: string;
	/** krátky zákaznícky popis (bez merateľných tvrdení) */
	popis: string;
}

/** Typy prvkov na výber (poradie = zákaznícky rebríček). LEN popisy, ŽIADNA cena. */
export const OPLOTENIE_TYPY: readonly OplotenieTypInfo[] = [
	{
		kod: 'diel',
		nazov: 'Plotový diel',
		popis: 'Hliníkové plotové pole medzi stĺpikmi — základ oplotenia pozemku.'
	},
	{
		kod: 'kridlova',
		nazov: 'Brána dvojkrídlová',
		popis: 'Dvojkrídlová vjazdová brána otváraná do strán.'
	},
	{
		kod: 'posuvna',
		nazov: 'Brána posuvná',
		popis: 'Posuvná vjazdová brána po koľajnici — úspora priestoru pred vjazdom.'
	},
	{
		kod: 'samonosna',
		nazov: 'Brána samonosná',
		popis: 'Samonosná posuvná brána bez spodnej koľajnice — plynulý prejazd.'
	},
	{
		kod: 'branka',
		nazov: 'Vchodová bránka',
		popis: 'Vchodová bránka pre peších v rovnakom dizajne ako plotové diely.'
	}
];
export const OPLOTENIE_TYP_DEFAULT: OplotenieTypKod = 'diel';

/** Model výplne/dizajnu (whitelist — zrkadlí modely montalu.sk). Sú to LEN string literály, žiadny
 *  Money kód. ATYP = oplotenie na mieru (výplň podľa predstáv zákazníka). */
export type OplotenieModel = 'ARIEL' | 'BIANCA' | 'LUNA' | 'NARVI' | 'PANDORA' | 'REA' | 'ATYP';

export interface OplotenieModelInfo {
	kod: OplotenieModel;
	/** krátky zákaznícky popis dizajnu výplne (bez merateľných tvrdení) */
	popis: string;
}

/** Modely výplne na výber (poradie = zákaznícky rebríček). LEN popisy, ŽIADNA cena. */
export const OPLOTENIE_MODELY: readonly OplotenieModelInfo[] = [
	{ kod: 'ARIEL', popis: 'Nepriehľadný, mohutný vzhľad — dokonalé súkromie.' },
	{ kod: 'BIANCA', popis: 'Čisté horizontálne línie s decentným priehľadom.' },
	{ kod: 'LUNA', popis: 'Vyvážený moderný dizajn pre bežnú zástavbu.' },
	{ kod: 'NARVI', popis: 'Výrazný architektonický vzor pre modernú architektúru.' },
	{ kod: 'PANDORA', popis: 'Symetrický horizontálny vzor — skromná elegancia.' },
	{ kod: 'REA', popis: 'Estetické riešenie, ktoré vizuálne predĺži pozemok.' },
	{ kod: 'ATYP', popis: 'Oplotenie a výplň na mieru presne podľa vašich predstáv.' }
];
export const OPLOTENIE_MODEL_DEFAULT: OplotenieModel = 'ARIEL';

// Zákaznícke rozmerové rozmedzia (mm) — ORIENTAČNÉ, na dopyt (žiadna cenotvorná mriežka; presné
// rozmery + počet dielov sa upresnia po zameraní). Interné = mm, jednotný tvar { min, max, krok }.
// Krok šírky 500 mm / výšky 100 mm — na 100 mm mriežke zákazníckeho metrového stepera (#333).
export const OPLOTENIE_VYSKA_MIN = 600;
export const OPLOTENIE_VYSKA_MAX = 2200;
export const OPLOTENIE_SIRKA_MIN = 1000;
export const OPLOTENIE_SIRKA_MAX = 6000;
export const OPLOTENIE_POCET_MIN = 1;
// 40 = pohodlne pokryje obvod bežného pozemku plotovými dielmi (najčastejší typ) — 20 by hlavný
// produktový typ umelo obmedzilo (review #388 🔵); väčší počet ide do poznámky dopytu.
export const OPLOTENIE_POCET_MAX = 40;

/** Rozmedzia pre klienta (input min/max/krok hinty) — žiadny Money údaj. */
export const OPLOTENIE_RANGES = {
	vyska: { min: OPLOTENIE_VYSKA_MIN, max: OPLOTENIE_VYSKA_MAX, krok: 100 },
	sirka: { min: OPLOTENIE_SIRKA_MIN, max: OPLOTENIE_SIRKA_MAX, krok: 500 },
	pocet: { min: OPLOTENIE_POCET_MIN, max: OPLOTENIE_POCET_MAX, krok: 1 }
} as const;

const TYP_SET = new Set<string>(OPLOTENIE_TYPY.map((t) => t.kod));
const MODEL_SET = new Set<string>(OPLOTENIE_MODELY.map((m) => m.kod));
const TYP_NAZOV = new Map<string, string>(OPLOTENIE_TYPY.map((t) => [t.kod, t.nazov]));

/** Typ z reťazca (whitelist; neznámy → default Plotový diel — bezpečný smer). */
export function oplotenieTyp(raw: string | null | undefined): OplotenieTypKod {
	const s = String(raw ?? '').trim();
	return TYP_SET.has(s) ? (s as OplotenieTypKod) : OPLOTENIE_TYP_DEFAULT;
}
/** Model z reťazca (whitelist; neznámy → default ARIEL). */
export function oplotenieModel(raw: string | null | undefined): OplotenieModel {
	const s = String(raw ?? '').trim();
	return MODEL_SET.has(s) ? (s as OplotenieModel) : OPLOTENIE_MODEL_DEFAULT;
}
/** Zákaznícky display názov typu (napr. „Brána posuvná"); neznámy kód → názov defaultu. */
export function oplotenieTypNazov(kod: OplotenieTypKod): string {
	return TYP_NAZOV.get(kod) ?? TYP_NAZOV.get(OPLOTENIE_TYP_DEFAULT)!;
}

export interface OplotenieVstup {
	typ: OplotenieTypKod;
	model: OplotenieModel;
	/** výška prvku (A) [mm] */
	vyska: number;
	/** šírka prvku (B) [mm] */
	sirka: number;
	/** počet kusov (celé číslo) */
	pocet: number;
	/** farba konštrukcie ako display label, napr. „RAL 7016 ANTRACIT" */
	farba: string;
}

export interface OplotenieSuhrn {
	typ: OplotenieTypKod;
	/** zákaznícky display názov typu */
	typNazov: string;
	model: OplotenieModel;
	vyska: number;
	sirka: number;
	pocet: number;
	farba: string;
}

function vRozmedzi(v: number, lo: number, hi: number): boolean {
	return Number.isFinite(v) && v >= lo && v <= hi;
}

/** Je vstup celý v platných rozmedziach? (na zobrazenie súhrnu / povolenie dopytu). */
export function oplotenieVstupPlatny(v: OplotenieVstup): boolean {
	return (
		vRozmedzi(v.vyska, OPLOTENIE_VYSKA_MIN, OPLOTENIE_VYSKA_MAX) &&
		vRozmedzi(v.sirka, OPLOTENIE_SIRKA_MIN, OPLOTENIE_SIRKA_MAX) &&
		Number.isInteger(v.pocet) &&
		vRozmedzi(v.pocet, OPLOTENIE_POCET_MIN, OPLOTENIE_POCET_MAX)
	);
}

/** Zostaví zákaznícky súhrn konfigurácie (display-only, BEZ ceny, BEZ Money kódu). */
export function konfigurujOplotenie(v: OplotenieVstup): OplotenieSuhrn {
	return {
		typ: v.typ,
		typNazov: oplotenieTypNazov(v.typ),
		model: v.model,
		vyska: v.vyska,
		sirka: v.sirka,
		pocet: v.pocet,
		farba: v.farba
	};
}

/** Zmapuje oplotenie súhrn na zdieľaný `PonukaConfig` pre dopyt/PDF (#277 tok). Používa LEN NEUTRÁLNE
 *  polia, ktoré čítajú správne aj pre oplotenie: typ → `system`, šírka → `sirka` (→ riadok „Šírka"),
 *  farba → `farba`, model/dizajn + výška + počet → `popis`. Pergolové polia (`hlbka`/`vyskaVpredu`/
 *  `model`/`dlzka`) sa NEPOUŽIJÚ — výška do `vyskaVpredu` by renderovalo zavádzajúce „Výška vpredu".
 *  `typNazov` je LEN v `system` (nie zdvojený v `popis` — review #388 🔵). Rendered riadky ostávajú
 *  `[Systém, Šírka, Farba konštrukcie, Popis]`.
 *
 *  #410: ORIENTAČNÁ cena (interim, matica montalu.sk) — cenotvorný kľúč nesie NEUTRÁLNE pole
 *  `systemKod = "${typKod}|${model}|${vyskaMm}|${pocet}"` (typKod/model neobsahujú `|`; string cap 120).
 *  Cenu z neho + `sirka` počíta SERVER (`cenaZCfgProdukt`/`cenaOplotenieZCfg` v `dopyt-cena-stamp`/
 *  `konfigurator-oplotenie-cena`), NIKDY klient — deterministicky reprodukovateľné pri re-downloade
 *  (`systemKod` prežije `sanitizePonukaConfig`). BEZ Money kódu (montalu cenové modely, nie Money ERP). */
export function oploteniePonukaConfig(s: OplotenieSuhrn): PonukaConfig {
	return {
		system: `Hliníkové oplotenie — ${s.typNazov}`,
		systemKod: `${s.typ}|${s.model}|${s.vyska}|${s.pocet}`,
		sirka: s.sirka,
		farba: s.farba,
		popis: `Dizajn výplne ${s.model} · výška ${s.vyska} mm · počet ${s.pocet} ks.`
	};
}
