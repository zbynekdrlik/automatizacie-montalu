// Verejný zákaznícky konfigurátor pergoly (#275, fáza 1) — ČISTÝ výpočtový modul.
// Display-only, BEZ CIEN, BEZ Money kódov, BEZ nárezu. Znovupoužíva geometriu z
// `pergola-navrh.ts` (sklon, svetlá výška) — importuje LEN geometrické funkcie/
// konštanty, NIKDY katalóg strešného skla (`sklo-strecha.ts` nesie Money kód).
// Vstupy sú primitíva (názvy skla/farby prídu ako reťazce), takže tento modul sa
// nikdy nedotkne Money kód a je bezpečný aj pre klientsky bundle (client-safe:
// žiadne server/DB/Money závislosti) → priamo unit-testovateľný. Súčasť #280.

import { vypocitajSklon, NOSNIK_HRUBKA_MM, VYSKA_MAX } from '$lib/pergola-navrh';
// #276 integrácia: typ pre mapovanie katalógového názvu skla na vizuálny odtieň 3D
// náhľadu. `import type` je pri builde ZMAZANÝ — žiadny runtime import vizuál vrstvy
// (a `pergola-sklo` nesie iba `import type SkloVzhlad`, žiadnu THREE/Money závislosť),
// takže tento modul ostáva client-safe aj server-safe. Odtieň NIE JE cena/Money kód.
import type { PergolaTypSkla } from '$lib/vizual/pergola-sklo';

// Zákaznícke rozmedzia — zámerná PODMNOŽINA rozmedzí enginu `pergola-navrh` (každá
// hodnota v nich je preto bezpečne validná aj pre engine). Šírka/hĺbka sú užšie než
// engine (zákaznícka pergola má rozumné rozmery), výška vpredu je nad hrúbkou nosníka
// (→ svetlá výška > 0). Dopočítaná výška pri stene sa validuje voči `VYSKA_MAX` enginu.
export const KONF_SIRKA_MIN = 2000;
export const KONF_SIRKA_MAX = 12000;
export const KONF_HLBKA_MIN = 1500;
export const KONF_HLBKA_MAX = 6000;
export const KONF_VYSKA_MIN = 2000; // výška vpredu; > NOSNIK_HRUBKA_MM (190) → svetlá výška > 0
export const KONF_VYSKA_MAX = 4000;
export const KONF_SKLON_MIN = 0;
// #329 časť 5: realistický flat-ceiling sklon — max 10° (30° je na reálnej pergole nezmysel a 3D
// pri veľkých hodnotách vyzeralo prehnane). Výpočet výšok sa nemení, len rozsah/default slidera.
export const KONF_SKLON_MAX = 10;
/** Dopočítaná výška pri stene nesmie prekročiť konštrukčné maximum enginu — priame
 *  rozmedzie `pergola-navrh` (VYSKA_MAX). Dolná hranica netreba: výška vpredu je vždy
 *  ≥ KONF_VYSKA_MIN (2000) a stena ≥ výška vpredu, takže nikdy neklesne pod VYSKA_MIN. */
export const KONF_VYSKA_STENA_MAX = VYSKA_MAX;

/** Rozmedzia pre klienta (input min/max hinty) — žiadny Money údaj. */
export const KONF_RANGES = {
	sirka: { min: KONF_SIRKA_MIN, max: KONF_SIRKA_MAX },
	hlbka: { min: KONF_HLBKA_MIN, max: KONF_HLBKA_MAX },
	vyskaVpredu: { min: KONF_VYSKA_MIN, max: KONF_VYSKA_MAX },
	sklon: { min: KONF_SKLON_MIN, max: KONF_SKLON_MAX }
} as const;

// #279 Fáza C: model konštrukcie (LIGHT/ROBUST/MASSIVE) — cenotvorný vstup zrkadlený z
// montalu.sk. Typ žije TU (client-safe), aby ho videl aj wizard (výber) aj PDF náhľad;
// server-only cenový modul `konfigurator-cena.ts` ho RE-EXPORTUJE (jeden zdroj pravdy).
// Sú to len string literály — žiadna cena ani Money kód, bezpečné pre klientsky bundle.
export type ModelPergoly = 'LIGHT' | 'ROBUST' | 'MASSIVE';

/** Východiskový model (montalu.sk default LIGHT — odľahčená pergola). */
export const MODEL_DEFAULT: ModelPergoly = 'LIGHT';

export interface ModelInfo {
	kod: ModelPergoly;
	/** krátky plain-SK popis rozdielu (inšpirované montalu.sk) */
	popis: string;
}

/** Modely na výber vo verejnom konfigurátore (poradie = montalu.sk: LIGHT → ROBUST → MASSIVE).
 *  LEN popisy, ŽIADNA cena — cena je rozmerovo závislá a počíta ju server pri submite. */
export const MODELY: readonly ModelInfo[] = [
	{ kod: 'LIGHT', popis: 'Odľahčená konštrukcia, menší výsuv (hĺbka do 4 m). Ideálna k stene.' },
	{ kod: 'ROBUST', popis: 'Masívnejšia konštrukcia pre väčšie rozmery (hĺbka do 6 m).' },
	{ kod: 'MASSIVE', popis: 'Najsilnejšia konštrukcia — vylepšený ROBUST pre najväčšie rozpätia.' }
];

// #318: cenová hladina. Neprihlásený / interný zákazník = MO (maloobchod, verejná plocha);
// prihlásený veľkoobchodný (b2b) účet = VO (veľkoobchod). Rozhoduje sa VÝHRADNE server-side
// z `locals.user` (`$lib/server/konfigurator-hladina`), nikdy z klientom dodaného poľa.
export type CenovaHladina = 'MO' | 'VO';

/**
 * Verejná (client-safe) orientačná cena — bez DPH + s DPH. Buď konkrétna cena, alebo
 * „individuálna ponuka" (mimo katalógu). Odvodená serverom z `konfigurator-cena.ts`. Rozmery
 * `hlbkaGridM`/`sirkaGridM` sú katalógové (po zaokrúhlení NAHOR na mriežku).
 *
 * #318: `hladina` je typovo `'VO'` (NIE `CenovaHladina`) — MO/verejný výstup ju štrukturálne
 * NEMÔŽE niesť (`naCenu` MO ju nenastaví a typ 'MO' hodnotu ani nedovolí), takže verejná odpoveď
 * je byte-identická s pôvodnou (žiadny náznak VO hladiny). VO cena (nižšia než MO) sa serializuje
 * LEN oprávnenému (prihlásenému b2b) používateľovi; do verejnej/MO odpovede sa VO NIKDY nedostane
 * (leak-guard `konfigurator-money-safety.test.ts` C). `hladinaLabel` (server-dodaný text, napr.
 * „veľkoobchodná cena") je tiež prítomný LEN pri VO — klientsky komponent tak NEnesie žiadny VO
 * literál (label príde zo servera), a MO bundle ostáva bez akéhokoľvek náznaku VO hladiny.
 */
export type VerejnaCena =
	| {
			druh: 'cena';
			model: ModelPergoly;
			bezDph: number;
			sDph: number;
			hlbkaGridM: number;
			sirkaGridM: number;
			hladina?: 'VO';
			hladinaLabel?: string;
	  }
	| {
			druh: 'individualna-ponuka';
			model: ModelPergoly;
			dovod: string;
			hladina?: 'VO';
			hladinaLabel?: string;
	  };

/** Cena jedného modelu v porovnávacej tabuľke (zrkadlo montalu.sk „ceny modelov vedľa seba"). */
export interface CenaModelu {
	model: ModelPergoly;
	cena: VerejnaCena;
}

export interface KonfiguratorVstup {
	/** celková šírka pergoly [mm] */
	sirka: number;
	/** hĺbka [mm] */
	hlbka: number;
	/** výška vpredu (k stĺpom) [mm] */
	vyskaVpredu: number;
	/** sklon strechy [°] — pultová (lean-to) pergola, stena je vyššia */
	sklonDeg: number;
	/** model konštrukcie (LIGHT/ROBUST/MASSIVE) — cenotvorný vstup (#279 Fáza C) */
	model: ModelPergoly;
	/** názov typu strešného skla (validovaný voči katalógu v parseri) — BEZ Money kód */
	sklo: string;
	/** farba konštrukcie ako display label, napr. „RAL 7016 ANTRACIT" */
	farba: string;
}

export interface KonfiguratorSuhrn {
	sirka: number;
	hlbka: number;
	vyskaVpredu: number;
	/** dopočítaná výška pri stene [mm] = vpredu + tan(sklon)·hĺbka */
	vyskaPriStene: number;
	/** sklon strechy [°] (z enginu, konzistentný s dopočítanou výškou pri stene) */
	sklonDeg: number;
	/** svetlá výška (clearance) vpredu [mm] = vpredu − hrúbka nosníka */
	svetlaVyska: number;
	/** zastrešená pôdorysná plocha [m²] */
	zastresenaPlochaM2: number;
	/** model konštrukcie (LIGHT/ROBUST/MASSIVE) — passthrough zo vstupu (#279 Fáza C) */
	model: ModelPergoly;
	/** názov typu strešného skla (BEZ ceny, BEZ Money kód) */
	sklo: string;
	/** farba konštrukcie (display label) */
	farba: string;
}

const R1 = (x: number) => Math.round(x * 10) / 10;

/** Zobrazovací formát čísla na 1 desatinu s desatinnou ČIARKOU (sk), napr.
 *  `2810 → "2810"`, `4452.06 → "4452,1"`. Zdieľané +page.svelte/KonfSuhrn (#325). */
export function fmtMm1(n: number): string {
	return String(R1(n)).replace('.', ',');
}

/** Dopočítaná výška pri stene [mm] — pultová strecha stúpa k stene o tan(sklon)·hĺbka. */
export function vyskaPriStene(vyskaVpredu: number, sklonDeg: number, hlbka: number): number {
	return R1(vyskaVpredu + Math.tan((sklonDeg * Math.PI) / 180) * hlbka);
}

/** Zastrešená pôdorysná plocha [m²] zo šírky a hĺbky [mm], zaokrúhlená na 1 desatinu. */
export function zastresenaPlocha(sirka: number, hlbka: number): number {
	return Math.round(((sirka * hlbka) / 1_000_000) * 10) / 10;
}

/** Zostaví zákaznícky súhrn konfigurácie (display-only). Sklon sa recalibruje cez engine
 *  `vypocitajSklon` z dopočítanej výšky pri stene → jeden zdroj pravdy, konzistentný so
 *  zvyškom appky (round-trip späť na zadaný sklon v rámci zaokrúhlenia). */
export function konfiguruj(v: KonfiguratorVstup): KonfiguratorSuhrn {
	const stena = vyskaPriStene(v.vyskaVpredu, v.sklonDeg, v.hlbka);
	return {
		sirka: v.sirka,
		hlbka: v.hlbka,
		vyskaVpredu: v.vyskaVpredu,
		vyskaPriStene: stena,
		sklonDeg: R1(vypocitajSklon(v.vyskaVpredu, stena, v.hlbka)),
		svetlaVyska: Math.max(0, R1(v.vyskaVpredu - NOSNIK_HRUBKA_MM)),
		zastresenaPlochaM2: zastresenaPlocha(v.sirka, v.hlbka),
		model: v.model,
		sklo: v.sklo,
		farba: v.farba
	};
}

/** Mapuje katalógový NÁZOV strešného skla z formulára (napr. „4.4.2 mliečne",
 *  „polykarbonát 16 mm bronz", „STADUR 24 mm", „IZO 5.5.2-8-6") na vizuálny odtieň
 *  3D náhľadu (`cire`/`dymove`/`bronzove`/`matne`). Iba prezentačné mapovanie —
 *  string match na NÁZOV (ktorý je už na klientovi cez `data.sklaKategorie[].katalogNazov`), NIKDY na
 *  cenu ani Money kód. ~15 katalógových názvov → 4 vizuálne rodiny; neznámy alebo
 *  prázdny názov → `cire` (transparentné, konzistentné s PERGOLA_TYP_SKLA_DEFAULT).
 *  - „bronz" → bronzové; „dym*" → dymové (rezerva, katalóg zatiaľ nemá dymové);
 *  - „mlieč*"/„matn*"/„opál"/plný „STADUR" panel → matné (opálový mliečny vzhľad);
 *  - inak (číre/číry, IZO bez prípony, polykarbonát číry) → číre. */
export function typSkla3D(nazovSkla: string): PergolaTypSkla {
	const n = nazovSkla.toLowerCase();
	if (n.includes('bronz')) return 'bronzove';
	if (n.includes('dym')) return 'dymove';
	if (
		n.includes('mlie') ||
		n.includes('matn') ||
		n.includes('opál') ||
		n.includes('opal') ||
		n.includes('stadur')
	)
		return 'matne';
	return 'cire';
}
