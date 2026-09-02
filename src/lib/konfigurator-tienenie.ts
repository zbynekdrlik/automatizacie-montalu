// Verejný zákaznícky konfigurátor tienenia — markízy a screenové rolety (#389, etapa 6 jednotného
// rámu #384) — ČISTÝ, CLIENT-SAFE modul. Display-only, BEZ CIEN (honest-null — tienenie nemá overený
// cenový zdroj, viď design komentár #389), BEZ interných Money kódov. Tienenie NEMÁ interný Money
// modul (lead-gen vrstva), takže neimportuje žiadny odpisový katalóg — nesie LEN prezentačné texty +
// rozmerové rozmedzia → leak-guard (A) `konfigurator-money-safety` ho prejde bez porušenia. Priamo
// unit-testovateľný. Reálna ponuka overená na montalu.sk (nič nevymyslené): Markíza XLINE (vrchná,
// s protiťahom), Markíza XLIGHT (spodná, pod presklenie), screenová roleta ZIPLINE (kazetová, zips).
import type { PonukaConfig } from '$lib/ponuka';

/** Model tienenia (whitelist — reálne názvy z montalu.sk). Sú to LEN string literály, žiadny Money kód. */
export type TienenieModel = 'XLINE' | 'XLIGHT' | 'ZIPLINE';

/** Druh tienenia — riadi, či je druhý rozmer VÝSUN (markíza, projekcia von) alebo VÝŠKA (roleta,
 *  zvislý dosah). Markíza sa vysúva vodorovne, screenová roleta sa spúšťa zvislo. */
export type TienenieDruh = 'markiza' | 'roleta';

export interface TienenieModelInfo {
	kod: TienenieModel;
	/** druh → label druhého rozmeru (markíza: Výsun, roleta: Výška) */
	druh: TienenieDruh;
	/** zákaznícky názov produktu (reálny z montalu.sk), napr. „Markíza XLINE" */
	nazov: string;
	/** krátky zákaznícky popis (bez merateľných tvrdení — presnú marketingovú kópiu doplní owner) */
	popis: string;
}

/** Modely na výber (poradie = zákaznícky rebríček). LEN názvy + popisy, ŽIADNA cena. */
export const TIENENIE_MODELY: readonly TienenieModelInfo[] = [
	{
		kod: 'XLINE',
		druh: 'markiza',
		nazov: 'Markíza XLINE',
		popis: 'Vrchná výsuvná markíza s protiťahom — na zimné záhrady a veľké presklené plochy.'
	},
	{
		kod: 'XLIGHT',
		druh: 'markiza',
		nazov: 'Markíza XLIGHT',
		popis: 'Spodná markíza s protiťahom — tienenie priamo pod presklením.'
	},
	{
		kod: 'ZIPLINE',
		druh: 'roleta',
		nazov: 'Screenová roleta ZIPLINE',
		popis: 'Kazetová screenová roleta so zipsovým vedením — plné zatiahnutie do kazety.'
	}
];
export const TIENENIE_MODEL_DEFAULT: TienenieModel = 'XLINE';

/** Ovládanie — ručné (kľukou) alebo elektrické (motor). montalu.sk ponúka aj „elektrická markíza". */
export type TienenieOvladanie = 'Ručné' | 'Elektrické';
export const TIENENIE_OVLADANIE: readonly { kod: TienenieOvladanie; popis: string }[] = [
	{
		kod: 'Elektrické',
		popis: 'Motorický pohon s diaľkovým ovládaním — pohodlné každodenné použitie.'
	},
	{ kod: 'Ručné', popis: 'Ovládanie kľukou — bez potreby elektroinštalácie.' }
];
export const TIENENIE_OVLADANIE_DEFAULT: TienenieOvladanie = 'Elektrické';

// Zákaznícke rozmerové rozmedzia (mm) — ORIENTAČNÉ, na dopyt (žiadna cenotvorná mriežka; presné
// rozmery sa upresnia po zameraní). Interné = mm. Šírka podľa montalu.sk (markíza XLINE max 7500 mm);
// druhý rozmer (VÝSUN markízy do 6000 mm / VÝŠKA rolety) drží JEDEN generózny rozsah, aby zmena typu
// neklampovala už zadanú hodnotu — rozmer je čisto informatívny pre dopyt (honest-null, žiadna cena).
export const TIENENIE_SIRKA_MIN = 1500;
export const TIENENIE_SIRKA_MAX = 7500;
export const TIENENIE_ROZMER2_MIN = 1000;
export const TIENENIE_ROZMER2_MAX = 6000;

/** Rozmedzia pre klienta (input min/max/krok hinty; krok 500 mm = 0,5 m na metrovom stepperi #333) —
 *  žiadny Money údaj. `rozmer2` = výsun (markíza) / výška (roleta), label podľa druhu zvoleného modelu. */
export const TIENENIE_RANGES = {
	sirka: { min: TIENENIE_SIRKA_MIN, max: TIENENIE_SIRKA_MAX, krok: 500 },
	rozmer2: { min: TIENENIE_ROZMER2_MIN, max: TIENENIE_ROZMER2_MAX, krok: 500 }
} as const;

const MODEL_MAP = new Map<string, TienenieModelInfo>(TIENENIE_MODELY.map((m) => [m.kod, m]));
const OVLADANIE_SET = new Set<string>(TIENENIE_OVLADANIE.map((o) => o.kod));

/** Model z reťazca (whitelist; neznámy/prázdny → default XLINE — bezpečný smer, vzor #385). */
export function tienenieModel(raw: string | null | undefined): TienenieModel {
	const s = String(raw ?? '').trim();
	return MODEL_MAP.has(s) ? (s as TienenieModel) : TIENENIE_MODEL_DEFAULT;
}
/** Ovládanie z reťazca (whitelist; neznámy → default Elektrické). */
export function tienenieOvladanie(raw: string | null | undefined): TienenieOvladanie {
	const s = String(raw ?? '').trim();
	return OVLADANIE_SET.has(s) ? (s as TienenieOvladanie) : TIENENIE_OVLADANIE_DEFAULT;
}

/** Info o modeli (nazov + druh) — po whitelist parse vždy existuje. */
export function tienenieModelInfo(model: TienenieModel): TienenieModelInfo {
	// model je už z `tienenieModel` (whitelist), takže mapa ho VŽDY má; fallback na default pre istotu.
	return MODEL_MAP.get(model) ?? MODEL_MAP.get(TIENENIE_MODEL_DEFAULT)!;
}

/** Label druhého rozmeru podľa druhu: markíza → „Výsun" (vodorovná projekcia), roleta → „Výška". */
export function rozmer2Popis(druh: TienenieDruh): string {
	return druh === 'roleta' ? 'Výška' : 'Výsun';
}
/** Akuzatív druhého rozmeru pre aria-label stepper tlačidiel („výsun"/„výšku"). */
export function rozmer2Akuzativ(druh: TienenieDruh): string {
	return druh === 'roleta' ? 'výšku' : 'výsun';
}

export interface TienenieVstup {
	model: TienenieModel;
	ovladanie: TienenieOvladanie;
	/** šírka tienenia [mm] */
	sirka: number;
	/** druhý rozmer [mm] — výsun (markíza) / výška (roleta) */
	rozmer2: number;
	/** farba konštrukcie ako display label, napr. „RAL 7016 ANTRACIT" */
	farba: string;
}

export interface TienenieSuhrn {
	model: TienenieModel;
	druh: TienenieDruh;
	nazov: string;
	ovladanie: TienenieOvladanie;
	sirka: number;
	rozmer2: number;
	farba: string;
}

function vRozmedzi(v: number, lo: number, hi: number): boolean {
	return Number.isFinite(v) && v >= lo && v <= hi;
}

/** Je vstup celý v platných rozmedziach? (na zobrazenie súhrnu / povolenie dopytu). */
export function tienenieVstupPlatny(v: TienenieVstup): boolean {
	return (
		vRozmedzi(v.sirka, TIENENIE_SIRKA_MIN, TIENENIE_SIRKA_MAX) &&
		vRozmedzi(v.rozmer2, TIENENIE_ROZMER2_MIN, TIENENIE_ROZMER2_MAX)
	);
}

/** Zostaví zákaznícky súhrn konfigurácie (display-only, BEZ ceny, BEZ Money kódu). */
export function konfigurujTienenie(v: TienenieVstup): TienenieSuhrn {
	const info = tienenieModelInfo(v.model);
	return {
		model: v.model,
		druh: info.druh,
		nazov: info.nazov,
		ovladanie: v.ovladanie,
		sirka: v.sirka,
		rozmer2: v.rozmer2,
		farba: v.farba
	};
}

/** Zmapuje tienenie súhrn na zdieľaný `PonukaConfig` pre dopyt/PDF (#277 tok). Používa LEN NEUTRÁLNE
 *  polia, ktoré čítajú správne aj pre tienenie: model+typ → `system`, hlavný rozmer ŠÍRKA → `sirka`
 *  (`zhrnutieRiadky` vykreslí „Šírka"), druhý rozmer (výsun/výška) + ovládanie + poznámka o vzorkovníku
 *  látky → `popis`, RAL konštrukcie → `farba`. Pergolové/bazénové polia (`hlbka`/`dlzka`/`sklo`/
 *  `model`/`pocetPoli`) sa NEPOUŽIJÚ, aby PDF nebolo zavádzajúce. BEZ ceny, BEZ Money kódu — cena je
 *  honest-null (tienenie nemá overený cenový zdroj; gate `maCenovyZdroj` v `konfigurator-produkty`). */
export function tieneniePonukaConfig(s: TienenieSuhrn): PonukaConfig {
	const r2 = rozmer2Popis(s.druh); // „Výsun" | „Výška"
	return {
		system: `Tienenie — ${s.nazov}`,
		sirka: s.sirka,
		farba: s.farba,
		popis:
			`${r2} ${s.rozmer2} mm · ovládanie ${s.ovladanie}.` +
			` Farbu cloniacej látky vyberieme podľa vzorkovníka po obhliadke.`
	};
}
