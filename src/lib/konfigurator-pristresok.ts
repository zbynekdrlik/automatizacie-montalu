// Verejný zákaznícky konfigurátor prístreškov a altánkov (#390, etapa 7/7 jednotného rámu #384) —
// ČISTÝ, CLIENT-SAFE modul. Display-only, BEZ CIEN (honest-null — prístrešky nemajú overený cenový
// zdroj: montalu.sk ich NEMÁ vo svojom cenovom konfigurátore, viď design komentár #390), BEZ interných
// Money kódov. Na rozdiel od bazéna prístrešky nemajú ANI interný Money odpisový modul (žiadny
// BPK-ekvivalent) — nesie LEN prezentačné texty + rozmerové rozmedzia → leak-guard (A)
// `konfigurator-money-safety` ho prejde bez porušenia. Priamo unit-testovateľný.
import type { PonukaConfig } from '$lib/ponuka';
import { cislaCiarka } from '$lib/konfigurator-jednotky';

/** Typ výrobku (whitelist — presné členenie montalu.sk `hlinikove-pristresky-a-altanky`, overené
 *  naživo #390). `kod` = stabilný identifikátor (testid/state), `nazov` = zákaznícky názov (do PDF/
 *  dopytu). Sú to LEN string literály, žiadny Money kód. */
export type PristresokTyp = 'auto' | 'terasa' | 'altanok' | 'sklenik' | 'sauna';

export interface PristresokTypInfo {
	kod: PristresokTyp;
	/** zákaznícky názov v nominatíve — karta + `system` v PDF/dopyte */
	nazov: string;
	/** krátky zákaznícky popis (bez merateľných tvrdení — presnú marketingovú kópiu doplní owner) */
	popis: string;
}

/** Typy na výber (poradie = prístrešok na auto prvý — je to hero fotka kategórie). LEN popisy,
 *  ŽIADNA cena. */
export const PRISTRESOK_TYPY: readonly PristresokTypInfo[] = [
	{
		kod: 'auto',
		nazov: 'Hliníkový prístrešok na auto',
		popis: 'Carport na jedno či viac áut — ochrana pred slnkom, dažďom aj snehom.'
	},
	{
		kod: 'terasa',
		nazov: 'Hliníkový prístrešok na terasu',
		popis: 'Zastrešenie terasy pre celoročné využitie vonkajšieho priestoru.'
	},
	{
		kod: 'altanok',
		nazov: 'Hliníkový záhradný altánok',
		popis: 'Samostatne stojaci altánok do záhrady s čistými hliníkovými líniami.'
	},
	{
		kod: 'sklenik',
		nazov: 'Skleník do záhrady',
		popis: 'Hliníkový skleník na mieru pre pestovanie po celý rok.'
	},
	{
		kod: 'sauna',
		nazov: 'Vonkajšia sauna',
		popis: 'Vonkajšia sauna v hliníkovom vyhotovení ako záhradný wellness prvok.'
	}
];
export const PRISTRESOK_TYP_DEFAULT: PristresokTyp = 'auto';

/** Krytina / výplň strechy — reálne možnosti montalu.sk (overené naživo #390). LEN prezentačné
 *  názvy, žiadny Money kód; tečú nezmenené do PDF špecifikácie / dopytu (pipeline dostáva reťazec). */
export const PRISTRESOK_KRYTINY: readonly { nazov: string; popis: string }[] = [
	{
		nazov: 'Polykarbonát',
		popis: 'Ľahká a odolná priehľadná krytina — praktické a spoľahlivé riešenie.'
	},
	{ nazov: 'Izolačné sklo', popis: 'Vyšší tepelný komfort — vhodné na celoročné priestory.' },
	{ nazov: 'Bezpečnostné sklo', popis: 'Kalené/vrstvené sklo pre vyššiu odolnosť a bezpečnosť.' },
	{
		nazov: 'Panel ISODOMUS',
		popis: 'Sendvičový panel s tepelnou izoláciou pre plný strešný komfort.'
	}
];
export const PRISTRESOK_KRYTINA_DEFAULT = 'Polykarbonát';

// Zákaznícke rozmerové rozmedzia (mm) — ORIENTAČNÉ, na dopyt (žiadna cenotvorná mriežka; presné
// rozmery sa upresnia po zameraní). Interné = mm, jednotný tvar { min, max, krok }.
export const PRISTRESOK_DLZKA_MIN = 2000;
export const PRISTRESOK_DLZKA_MAX = 8000;
export const PRISTRESOK_SIRKA_MIN = 2000;
export const PRISTRESOK_SIRKA_MAX = 7000;
export const PRISTRESOK_VYSKA_MIN = 2000;
export const PRISTRESOK_VYSKA_MAX = 3500;

/** Rozmedzia pre klienta (input min/max/krok hinty) — žiadny Money údaj. Krok 500/500/100 mm sedí
 *  na 100 mm mriežku zákazníckeho metrového stepera (#333 RozmerStepper). */
export const PRISTRESOK_RANGES = {
	dlzka: { min: PRISTRESOK_DLZKA_MIN, max: PRISTRESOK_DLZKA_MAX, krok: 500 },
	sirka: { min: PRISTRESOK_SIRKA_MIN, max: PRISTRESOK_SIRKA_MAX, krok: 500 },
	vyska: { min: PRISTRESOK_VYSKA_MIN, max: PRISTRESOK_VYSKA_MAX, krok: 100 }
} as const;

const TYP_PODLA_KODU = new Map<string, PristresokTypInfo>(PRISTRESOK_TYPY.map((t) => [t.kod, t]));
const KRYTINA_SET = new Set<string>(PRISTRESOK_KRYTINY.map((k) => k.nazov));

/** Typ z reťazca (whitelist; neznámy → default auto — bezpečný smer, vzor #385 bazenModel). */
export function pristresokTyp(raw: string | null | undefined): PristresokTyp {
	const s = String(raw ?? '').trim();
	return TYP_PODLA_KODU.has(s) ? (s as PristresokTyp) : PRISTRESOK_TYP_DEFAULT;
}
/** Zákaznícky názov typu (nominatív) — do súhrnu/PDF (`system`). Neznámy → názov defaultu. */
export function pristresokTypNazov(kod: string | null | undefined): string {
	const s = String(kod ?? '').trim();
	return (TYP_PODLA_KODU.get(s) ?? TYP_PODLA_KODU.get(PRISTRESOK_TYP_DEFAULT))!.nazov;
}
/** Krytina z reťazca (whitelist; neznámy → default Polykarbonát). */
export function pristresokKrytina(raw: string | null | undefined): string {
	const s = String(raw ?? '').trim();
	return KRYTINA_SET.has(s) ? s : PRISTRESOK_KRYTINA_DEFAULT;
}

export interface PristresokVstup {
	/** typ výrobku (kód) */
	typ: PristresokTyp;
	/** krytina / výplň strechy (názov) */
	krytina: string;
	/** dĺžka [mm] */
	dlzka: number;
	/** šírka [mm] */
	sirka: number;
	/** výška [mm] */
	vyska: number;
	/** farba konštrukcie ako display label, napr. „RAL 7016 ANTRACIT" */
	farba: string;
}

export interface PristresokSuhrn {
	/** zákaznícky NÁZOV typu (display / `system`) */
	typ: string;
	krytina: string;
	dlzka: number;
	sirka: number;
	vyska: number;
	/** pôdorysná plocha [m²] = dĺžka × šírka (zaokrúhlené na 1 desatinu) */
	plochaM2: number;
	farba: string;
}

const R1 = (x: number) => Math.round(x * 10) / 10;

function vRozmedzi(v: number, lo: number, hi: number): boolean {
	return Number.isFinite(v) && v >= lo && v <= hi;
}

/** Je vstup celý v platných rozmedziach? (na zobrazenie súhrnu / povolenie dopytu). */
export function pristresokVstupPlatny(v: PristresokVstup): boolean {
	return (
		vRozmedzi(v.dlzka, PRISTRESOK_DLZKA_MIN, PRISTRESOK_DLZKA_MAX) &&
		vRozmedzi(v.sirka, PRISTRESOK_SIRKA_MIN, PRISTRESOK_SIRKA_MAX) &&
		vRozmedzi(v.vyska, PRISTRESOK_VYSKA_MIN, PRISTRESOK_VYSKA_MAX)
	);
}

/** Zostaví zákaznícky súhrn konfigurácie (display-only, BEZ ceny, BEZ Money kódu). */
export function konfigurujPristresok(v: PristresokVstup): PristresokSuhrn {
	return {
		typ: pristresokTypNazov(v.typ),
		krytina: v.krytina,
		dlzka: v.dlzka,
		sirka: v.sirka,
		vyska: v.vyska,
		plochaM2: R1((v.dlzka * v.sirka) / 1_000_000),
		farba: v.farba
	};
}

/** Zmapuje prístreškový súhrn na zdieľaný `PonukaConfig` pre dopyt/PDF (#277 tok). Používa LEN
 *  NEUTRÁLNE polia: typ → `system`, DĹŽKA → `dlzka` + šírka → `sirka` (→ „Rozmery (d × š)"),
 *  krytina → `sklo` (→ „Sklo / výplň"), výška + plocha → `popis`. Pergolové polia (`hlbka`/
 *  `vyskaVpredu`/`model`/`pocetPoli`) sa NEPOUŽIJÚ, aby PDF nebolo zavádzajúce. BEZ ceny, BEZ Money
 *  kódu — cena je honest-null (prístrešky nemajú overený cenový zdroj; gate `maCenovyZdroj`
 *  v `konfigurator-produkty`). */
export function pristresokPonukaConfig(s: PristresokSuhrn): PonukaConfig {
	return {
		system: s.typ,
		dlzka: s.dlzka,
		sirka: s.sirka,
		farba: s.farba,
		sklo: s.krytina,
		popis: `Výška ${s.vyska} mm · zastrešená plocha ${cislaCiarka(s.plochaM2)} m².`
	};
}
