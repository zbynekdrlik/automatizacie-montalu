// Verejný zákaznícky konfigurátor tienenia — markízy a screenové rolety (#389, etapa 6 jednotného
// rámu #384) — ČISTÝ, CLIENT-SAFE modul. Display-only, BEZ CIEN (honest-null — tienenie nemá overený
// cenový zdroj, viď design komentár #389), BEZ interných Money kódov. Tienenie NEMÁ interný Money
// modul (lead-gen vrstva), takže neimportuje žiadny odpisový katalóg — nesie LEN prezentačné texty +
// rozmerové rozmedzia → leak-guard (A) `konfigurator-money-safety` ho prejde bez porušenia. Priamo
// unit-testovateľný. Reálna ponuka overená na montalu.sk (nič nevymyslené) — VRÁTANE per-model
// limitov a per-model ovládania (review #389 🟡): Markíza XLINE (vrchná, s protiťahom; šírka do
// 7500 / výsun do 6000 mm; motorické), Markíza XLIGHT (spodná; šírka do 6000 / výsun do 5000 mm;
// ručné aj motorické), screenová roleta ZIPLINE (kazetová, zips; šírka do 4000 / výška do 3000 mm;
// motorické).
import type { PonukaConfig } from '$lib/ponuka';

/** Model tienenia (whitelist — reálne názvy z montalu.sk). Sú to LEN string literály, žiadny Money kód. */
export type TienenieModel = 'XLINE' | 'XLIGHT' | 'ZIPLINE';

/** Druh tienenia — riadi, či je druhý rozmer VÝSUN (markíza, projekcia von) alebo VÝŠKA (roleta,
 *  zvislý dosah). Markíza sa vysúva vodorovne, screenová roleta sa spúšťa zvislo. */
export type TienenieDruh = 'markiza' | 'roleta';

/** Ovládanie — ručné (kľukou) alebo elektrické (motor). Ktoré je reálne dostupné, sa líši per model
 *  (montalu.sk: manuálne LEN pri XLIGHT). */
export type TienenieOvladanie = 'Ručné' | 'Elektrické';

/** Katalóg ovládania — display texty + ASCII `id` pre stabilné E2E testidy (review #389 🔵). Ktoré
 *  z nich je pri danom modeli reálne dostupné, hovorí `TienenieModelInfo.ovladanie`. */
export const TIENENIE_OVLADANIE: readonly { kod: TienenieOvladanie; id: string; popis: string }[] =
	[
		{
			kod: 'Elektrické',
			id: 'elektricke',
			popis: 'Motorický pohon s diaľkovým ovládaním — pohodlné každodenné použitie.'
		},
		{ kod: 'Ručné', id: 'rucne', popis: 'Ovládanie kľukou — bez potreby elektroinštalácie.' }
	];

/** Rozmerový limit (mm) — min/max per model. */
interface Limit {
	min: number;
	max: number;
}

export interface TienenieModelInfo {
	kod: TienenieModel;
	/** druh → label druhého rozmeru (markíza: Výsun, roleta: Výška) */
	druh: TienenieDruh;
	/** zákaznícky názov produktu (reálny z montalu.sk), napr. „Markíza XLINE" */
	nazov: string;
	/** krátky zákaznícky popis (bez merateľných tvrdení — presnú marketingovú kópiu doplní owner) */
	popis: string;
	/** reálny rozmerový limit šírky [mm] (montalu.sk per model) */
	sirka: Limit;
	/** reálny limit druhého rozmeru [mm] — výsun (markíza) / výška (roleta) */
	rozmer2: Limit;
	/** reálne dostupné ovládanie pre tento model (montalu.sk) — poradie = default prvé */
	ovladanie: readonly TienenieOvladanie[];
}

/** Krok metrového stepera (#333): 500 mm = 0,5 m (na 100 mm mriežke metrového displeja). */
export const TIENENIE_KROK = 500;

/** Modely na výber (poradie = zákaznícky rebríček). LEN názvy + popisy + REÁLNE limity, ŽIADNA cena.
 *  Limity a ovládanie sú overené na montalu.sk (review #389 🟡 — „nič nevymýšľaj" platí aj pre spec). */
export const TIENENIE_MODELY: readonly TienenieModelInfo[] = [
	{
		kod: 'XLINE',
		druh: 'markiza',
		nazov: 'Markíza XLINE',
		popis: 'Vrchná výsuvná markíza s protiťahom — na zimné záhrady a veľké presklené plochy.',
		sirka: { min: 1500, max: 7500 },
		rozmer2: { min: 1500, max: 6000 },
		ovladanie: ['Elektrické']
	},
	{
		kod: 'XLIGHT',
		druh: 'markiza',
		nazov: 'Markíza XLIGHT',
		popis: 'Spodná markíza s protiťahom — tienenie priamo pod presklením.',
		sirka: { min: 1500, max: 6000 },
		rozmer2: { min: 1500, max: 5000 },
		ovladanie: ['Elektrické', 'Ručné']
	},
	{
		kod: 'ZIPLINE',
		druh: 'roleta',
		nazov: 'Screenová roleta ZIPLINE',
		popis: 'Kazetová screenová roleta so zipsovým vedením — plné zatiahnutie do kazety.',
		sirka: { min: 1000, max: 4000 },
		rozmer2: { min: 1000, max: 3000 },
		ovladanie: ['Elektrické']
	}
];
export const TIENENIE_MODEL_DEFAULT: TienenieModel = 'XLINE';
/** Default ovládanie = prvé dostupné pri default modeli (XLINE → Elektrické). */
export const TIENENIE_OVLADANIE_DEFAULT: TienenieOvladanie = TIENENIE_MODELY[0]!.ovladanie[0]!;

const MODEL_MAP = new Map<string, TienenieModelInfo>(TIENENIE_MODELY.map((m) => [m.kod, m]));

/** Model z reťazca (whitelist; neznámy/prázdny → default XLINE — bezpečný smer, vzor #385). */
export function tienenieModel(raw: string | null | undefined): TienenieModel {
	const s = String(raw ?? '').trim();
	return MODEL_MAP.has(s) ? (s as TienenieModel) : TIENENIE_MODEL_DEFAULT;
}

/** Info o modeli (nazov + druh + limity + ovládanie) — po whitelist parse vždy existuje. */
export function tienenieModelInfo(model: TienenieModel): TienenieModelInfo {
	// model je už z `tienenieModel` (whitelist), takže mapa ho VŽDY má; fallback na default pre istotu.
	return MODEL_MAP.get(model) ?? MODEL_MAP.get(TIENENIE_MODEL_DEFAULT)!;
}

/** Ovládanie z reťazca pre daný MODEL (whitelist zúžený na to, čo model reálne ponúka; neznáme/
 *  nedostupné → prvé dostupné pri modeli — bezpečný default). montalu.sk: ZIPLINE/XLINE motorické,
 *  XLIGHT aj ručné — „Ručná ZIPLINE" je vymyslený variant, preto sa nedovolí (review #389 🟡). */
export function tienenieOvladanie(
	raw: string | null | undefined,
	model: TienenieModel = TIENENIE_MODEL_DEFAULT
): TienenieOvladanie {
	const s = String(raw ?? '').trim();
	const dostupne = tienenieModelInfo(model).ovladanie;
	return dostupne.includes(s as TienenieOvladanie) ? (s as TienenieOvladanie) : dostupne[0]!;
}

/** Rozmerové rozmedzia (min/max/krok) pre daný model — limity sú FUNKCIOU modelu, nie konštanta
 *  (review #389 🟡: jeden generózny rozsah dovolil nemožné rozmery). */
export function tienenieRanges(model: TienenieModel): {
	sirka: { min: number; max: number; krok: number };
	rozmer2: { min: number; max: number; krok: number };
} {
	const info = tienenieModelInfo(model);
	return {
		sirka: { min: info.sirka.min, max: info.sirka.max, krok: TIENENIE_KROK },
		rozmer2: { min: info.rozmer2.min, max: info.rozmer2.max, krok: TIENENIE_KROK }
	};
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

/** Je vstup celý v platných rozmedziach PRE SVOJ MODEL? (na zobrazenie súhrnu / povolenie dopytu). */
export function tienenieVstupPlatny(v: TienenieVstup): boolean {
	const rng = tienenieRanges(v.model);
	return (
		vRozmedzi(v.sirka, rng.sirka.min, rng.sirka.max) &&
		vRozmedzi(v.rozmer2, rng.rozmer2.min, rng.rozmer2.max)
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
