// Pergola — MATERIÁL / NÁREZ z rozmerov (#155). Čistý TS engine bez závislosti na
// Svelte/DOM/serveri — plne unit-testovateľný (viď tests/pergola-narez.test.ts).
//
// DISPLAY-ONLY: NIKAM do Money nezapisuje. NEimportuje `$lib/server/money` ani
// `$lib/server/pergola` (Money odpisová cesta) — statický guard je v
// tests/pergola-narez-money-safety.test.ts. Kódy/názvy profilov sú KÓPIA stringov z
// katalógu (aby sa modul nezaviazal na server odpisový modul), nie import.
//
// DISCIPLÍNA (#155): engine počíta LEN vzorce POTVRDENÉ na callu s Dominikom
// (13.8.2026, komentár na #155). Všetko O-blokované (kótovaný výkres O1, výstuha
// profil O2/O3, strop 700 pre krov O4, sklá O11, krov #161) je vypísané ako
// „zatiaľ nepodporované" — NIKDY sa nehádže vzorec. Preto je výsledok rozdelený na
// `vypocitane` (potvrdené), `informativne` (odvodené hodnoty na zobrazenie) a
// `nepodporovane` (čaká na pravidlá).

import { krovDlzkaNominal } from './pergola-krov';

/** zaokrúhlenie na 0,1 mm — rovnaká disciplína ako R1 v pergola-navrh.ts */
const R1 = (x: number) => Math.round(x * 10) / 10;
/** zaokrúhlenie na 0,01 mm — pre krovové dĺžky (nominál/prítlačná/svetlosť): výkres OP260282
 *  udáva 0,01 mm (3240,93 / 3279,77), R1 by tú presnosť zlepilo. */
const R2 = (x: number) => Math.round(x * 100) / 100;

// --- Potvrdené konštanty (dôkaz = citácie t=… v analýze callu na #155) -----------
/** štandardná predná svetlosť [mm] (spodná hrana žľabu po odčítaní výstuhy), t=1011–1034s */
export const PREDNA_SVETLOST_STD = 2200;
/** dĺžka prednej nohy = predná svetlosť + tento prídavok [mm], t=1061–1072s
 *  (overené 1:1 na ZAK2026302: 2200+15 = 2215, 4× stĺp 2215 mm) */
export const PREDNA_NOHA_PRIDAVOK = 15;
/** rez výstuhy medzi nohami = šírka − toto [mm] (Dominikov doslovný citát t=985–993s).
 *  INFORMATÍVNE — per-systém varianta (šírka − 2×noha) je O2, profil je O3, oboje blokované. */
export const VYSTUHA_ODPOCET = 280;
/** maximálny rozostup priečok [mm] — cieľ 650–700, tvrdý strop 700, t=133–157s.
 *  POZOR (#161, Dominik 21.8.): pre KROVY (nie staré „priečky") už NIE JE tvrdý strop —
 *  počet krovov je manuálny vstup, appka len ukáže svetlosť. Táto konštanta ostáva len pre
 *  spätnú kompatibilitu doterajšieho auto-výpočtu `pocetPriecok` (fallback keď n nezadané). */
export const MAX_ROZOSTUP_PRIECOK = 700;

// --- KROV cut-list konštanty (#161, derivácia 21.8. overená proti golden OP260282) -------
/** šírka jedného krovu [mm] — do vzorca svetlosti medzi krovmi (Dominik 21.8.). */
export const KROV_SIRKA_MM = 50;
/** okrajové odsadenie [mm] (2×1 mm od kraja) v odpočte svetlosti = 50·n + 2 (Dominik 21.8.). */
export const KROV_OKRAJ_ODSADENIE_MM = 2;
/** prídavok [mm] prítlačnej/maskovacích líšt nad nominál krovu (Massive): dĺžka = nominál + 40.
 *  Overené na golden OP260282: 3239,76 + 40 = 3279,76 ≈ výkres 3279,77 (Δ 0,01). */
export const PRITLACNA_NAD_NOMINAL_MM = 40;
/** prídavok [mm] líšt nad nominál krovu — ROBUST: dĺžka = nominál + 30. Dominik VERBATIM
 *  (ch207 msg 1724331): „tu dlžku krovu ktoru vypočítaš z bodu 3 pri robuste je výsledok
 *  +30 a pri massive +40". Bez Robust goldenu — na potvrdenie pri prvej Robust zákazke. */
export const PRITLACNA_NAD_NOMINAL_ROBUST_MM = 30;
/** rozsah manuálneho počtu krovov [ks] — voliteľný vstup (Dominik 21.8. rozhodol manuál). */
export const POCET_KROVOV_MIN = 2;
export const POCET_KROVOV_MAX = 50;

// --- Nové potvrdené konštanty z výkresu OP260282 (modré poznámky, #206) -----------
/** skovanie výstuhy v žľabe [mm] — Dominik VERBATIM (ch207 msg 1731729, 24.8.): „výstuha
 *  je tiež 15 mm usadená v žľabe tak ako aj noha" → výstuha TRČÍ do svetlosti (zvislý
 *  rozmer − 15): 110→95, 140→125, 200→185, 250→235. Kontrola konzistencie s A9: noha =
 *  svetlosť + 15 + trčanie = svetlosť + zvislý rozmer (15+95=110, 15+125=140 ✓). Ten istý
 *  odkaz ODVOLAL skorší −60 model pre 200×140 („tých 60 to je asi zle") — konštanta
 *  VYSTUHA_200x140_SVETLOST_ODPOCET bola zrušená. */
export const VYSTUHA_SKOVANIE_MM = 15;
/** POTVRDENÉ (#206 modrá poznámka b): pri NIE-samostatne stojacej pergole je vzadu pod
 *  kotviacim profilom bočný profil 110×43 s dĺžkou ZV − 190 (ZV = zadná výška). */
export const POD_KOTVIACI_110x43_ODPOCET = 190;
/** počet bočných profilov 110×43 pod kotviacim (u steny) — modrá poznámka a „2 ks pod
 *  kotviacim vzadu na stene". */
export const POCET_BOCNYCH_POD_KOTVIACIM = 2;
/** #205 (výkres OP260282): bočný profil 110×43 „pod fixom" (2 ks, pozdĺžne po bokoch pod
 *  zasklením) — dĺžka z HĹBKY: hĺbka − (profil prednej nohy + zadný prvok). Zadný prvok pri
 *  stene = vlastná šírka profilu 110×43 = 43 mm (na stene niet zadnej nohy). Kaskáda poznámky
 *  výkresu („robust −153/robust SS −220/massive −183/massive SS 110 −250/massive SS 140 −280")
 *  sa presne rozloží na frontProfil (110/140) + zadný prvok (43 stena / 110|140 SS). */
export const POD_FIXOM_STENA_ZADNY_ODPOCET = 43;
/** počet bočných profilov 110×43 „pod fixom" — pár po bokoch pod fixom (výkres OP260282). */
export const POCET_BOCNYCH_POD_FIXOM = 2;
/** #206 (d) — obranný horný rozsah výšky SH frézovania zvodu [mm]. Používa engine validácia
 *  aj formulár (`max`), aby nebola tá istá hodnota dvakrát nezávisle (vykres.md #146). */
export const ZVOD_SH_MAX = 5000;

/** dĺžky surových tyčí [mm] pre výdaj materiálu (bin-packing), per stĺpec „Výdaj" výkresu
 *  OP260282: väčšina profilov sa reže zo 7,5 m tyčí, žľab a kotviaci profil zo 6 m tyčí. */
export const TYC_STANDARD_MM = 7500;
export const TYC_ZLAB_KOTVIACI_MM = 6000;

export const KOD_PRIECKA_NORMAL = '18004';
export const KOD_PRIECKA_LIGHT = '18102';
/** Money kódy nových profilov — KÓPIA stringov z katalógu (`server/pergola.ts` CODE_MAP),
 *  NIE import (money-safety guard). 110×43 = bočný profil (a/b), 200×140 = veľká výstuha
 *  Massive (c), 250×110 = veľká výstuha Robust (c, = „110×250"). */
export const KOD_PROFIL_110x43 = '18016';
export const KOD_VYSTUHA_200x140 = '18022';
export const KOD_VYSTUHA_250x110 = '18014';

// --- Rozsahy vstupu --------------------------------------------------------------
export const SIRKA_MIN = 1000;
export const SIRKA_MAX = 20000;
export const HLBKA_MIN = 1000;
export const HLBKA_MAX = 10000;
export const SVETLOST_MIN = 1500;
export const SVETLOST_MAX = 4000;
export const VYSKA_ZADNA_MIN = 1500;
export const VYSKA_ZADNA_MAX = 5000;
export const POCET_NOH_MIN = 2;
export const POCET_NOH_MAX = 20;
/** rozsah sklonu strechy [°] pre krov uloženie (#161) — voliteľný vstup. Horná hranica
 *  je len obranná (odmietne nezmysel typu 200°); vetvy pod 7° rieši krov engine čestne
 *  ako „nepodporované", nie chybou. */
export const SKLON_MIN = 0;
export const SKLON_MAX = 60;

export type PergolaSystem = 'Robust' | 'Massive';
export type Uchytenie = 'stena' | 'samostatne';
/** rozmer HORNÉHO profilu zadnej konštrukcie [mm] — do vzorca zadnej nohy. Z callu:
 *  NIE je viazaný na systém (Massive sa dá aj z horného 110), preto samostatná voľba
 *  110/140, t=1360–1417s. */
export type HornyProfil = 110 | 140;

/** Profil výstuhy (nosníka) — cross-section variant (#206 modrá poznámka c). Massive:
 *  140×140 (štandard) / 200×140 (vyššia — svetlosť −60). Robust: 110×110 / 110×250. Dĺžky
 *  Robust variantov nad −220 pravidlo ostávajú honest-null (nepotvrdené), 200×140 −60 na
 *  svetlosť je jediné POTVRDENÉ číslo. `null`/undefined = systémový štandard bez −60. */
export type VystuhaProfil = '140x140' | '200x140' | '110x110' | '110x250';

export interface SystemProfil {
	stlp: { kod: string; nazov: string; rozmer: 110 | 140 };
	zlab: { kod: string; nazov: string };
}

/** Systém pergoly určuje profil stĺpu AJ žľabu (t=170–213s). Kódy/názvy = kópia z
 *  katalógu profilov (NIE import server/pergola). */
export const SYSTEMY: Record<PergolaSystem, SystemProfil> = {
	Robust: {
		stlp: { kod: '18013', nazov: 'Profil 110x110 V2', rozmer: 110 },
		zlab: { kod: '18021', nazov: 'Žlabový profil 110 V2' }
	},
	Massive: {
		stlp: { kod: '18017', nazov: 'Profil 140x140', rozmer: 140 },
		zlab: { kod: '18018', nazov: 'Žlabový profil 140' }
	}
};

/** Money kód + názov profilu ZADNEJ konštrukcie (zadná noha + „zadná konštrukcia horná")
 *  podľa horného profilu zadnej (`hornyProfilZadnej`). Z callu (Dominik 24.8., kanál 207
 *  msg 1731730): pri výstuhe 110×110 sú aj zadné nohy 110 → celá zadná konštrukcia sleduje
 *  `hornyProfilZadnej`, jednotná by-construction (výkres OP260282 = jednotne 110×110, hoci
 *  systém je Massive 140 — `hornyProfilZadnej` je NEZÁVISLÝ od systému). Kódy/názvy = KÓPIA
 *  stringov z katalógu profilov (money-safety guard — NIE import server/pergola).
 *  110 → 18013 (Profil 110x110 V2), 140 → 18017 (Profil 140x140). Hodnoty sú ZRKADLO
 *  `SYSTEMY.Robust.stlp` / `SYSTEMY.Massive.stlp` `{kod, nazov}` — pri oprave katalógového
 *  stringu drž ich v synchronizácii (odvodzovať z `SYSTEMY` sa ZÁMERNE NEROBÍ: zadná
 *  konštrukcia je nezávislá od `system` — OP260282 = Massive 140 systém so 110 zadnou). */
export const ZADNA_KONSTRUKCIA_PROFIL: Record<HornyProfil, { kod: string; nazov: string }> = {
	110: { kod: '18013', nazov: 'Profil 110x110 V2' },
	140: { kod: '18017', nazov: 'Profil 140x140' }
};

export interface PergolaNarezVstup {
	system: PergolaSystem;
	/** šírka pergoly [mm] = šírka RÁMU / poľa krokiev, do vzorca počtu priečok.
	 *  POZOR (verifikácia #196 proti ZAK202694/ZAK2026302): žľab presahuje rám o presah
	 *  na obe strany (5930 vs rám ~5294; 9120 vs rám ~8004), takže `sirka` NIE JE celková
	 *  dĺžka žľabu — inak by ceil(šírka/700)+1 nadrátalo ~2 priečky. #197 (napojenie na
	 *  Money) musí posielať šírku rámu; vzťah žľab = rám + 2×presah je O1-blokovaný (#198). */
	sirka: number;
	/** hĺbka pergoly [mm] — evidenčný rozmer (potvrdené vzorce ju zatiaľ nepoužívajú;
	 *  dĺžky priečok/krovu, ktoré ju potrebujú, sú O1/#161 blokované) */
	hlbka: number;
	/** predná svetlá výška [mm], štandard 2200 */
	prednaSvetlost: number;
	/** zadná výška [mm] — použije sa LEN pri samostatne stojacej (zadné nohy) */
	vyskaZadna: number;
	/** počet predných nôh (CELNE_NOHY) — riadiaci vstup, rozostupy sa dopočítajú (t=1436–1510s) */
	pocetPrednychNoh: number;
	/** na stenu (9/10, bez zadných nôh) vs samostatne stojaca (t=1313–1319s) */
	uchytenie: Uchytenie;
	/** počet zadných nôh — LEN pri samostatne stojacej */
	pocetZadnychNoh: number;
	/** rozmer horného profilu zadnej konštrukcie (110/140) — do vzorca zadnej nohy */
	hornyProfilZadnej: HornyProfil;
	/** priečka light (18102) vs normal (18004) — manuálny checkbox, volí Money KÓD
	 *  priečky. Zdroj = ťažba Money histórie (17/17 zákaziek, 9× normal/11× light),
	 *  NIE call. POZOR na zámenu: krov „light/vystužený" z callu (t=225–252s) je INÝ
	 *  vstup bez vzorca → patrí ku #161, v tomto engine NIE JE. */
	prieckaLight: boolean;
	/** zosilnený nosník — profil je O2/O3 blokovaný, len vypíšeme ako nepodporované */
	zosilnenyNosnik: boolean;
	/** sklon strechy [°] pre krov uloženie (#161) — VOLITEĽNÝ. null = nezadaný (krov
	 *  ostáva len poznámkou, ako doteraz). Keď zadaný, `krovUlozenie` (pergola-krov.ts)
	 *  z neho počíta POTVRDENÉ uloženie (prah 7°). NIE JE odvodený z výšok/hĺbky — vzťah
	 *  nie je potvrdený, sklon je priamy vstup ako `uhol` v SE modeli. */
	sklonStrechy?: number | null;
	/** #161 — MANUÁLNY počet krovov (Dominik 21.8.: nie auto-výpočet). Keď zadané (≥2), určuje
	 *  počet priečok (krokiev) do materiálu, svetlosť medzi krovmi = (šírka − 50n − 2)/(n−1) a
	 *  počet zaklapávacích líšt = 2(n−1). Prázdne/null → fallback na auto `pocetPriecok(šírka)`
	 *  (spätná kompatibilita), svetlosť sa nezobrazí. VOLITEĽNÝ — existujúce vektory ostávajú. */
	pocetKrovov?: number | null;
	/** #206 (a) — „jednoduchá pergola bez zasklenia": vypne bočné profily 110×43 (2 pod
	 *  fixom + 2 pod kotviacim/u steny, spolu 4). Default false (zasklená). */
	jednoduchaBezZasklenia?: boolean;
	/** #206 (c) — profil (cross-section) výstuhy. `null`/undefined = systémový štandard bez
	 *  −60. `200x140` → efektívna svetlosť −60. Robust varianty dĺžky ostávajú honest-null. */
	vystuhaProfil?: VystuhaProfil | null;
	/** #206 (d) — ZVOD: frézovať spodnú hranu (SH)? Default false = nefrézovať. */
	zvodFrezovat?: boolean;
	/** #206 (d) — výška SH frézovania zvodu [mm]; null keď sa nefrézuje. LEN evidencia/výkres
	 *  (frézovací detail výrobného listu je #161). */
	zvodFrezovanieSHmm?: number | null;
	/** #206 (e) — skladba strešného skla (voľný text, napr. „4-4-2číre-8-6stopsol classic
	 *  grey"). Informatívny údaj zákazky na výkrese, žiadny Money výpočet. */
	strechaSklo?: string;
	/** #223 — ZVOLENÝ typ strešného skla z katalógu `SKLO_STRECHA_TYPY` (kanonický názov,
	 *  napr. „IZO 4.4.2-8-6 číre"). Riadi vzorec šírky (polykarbonát → +34, inak +30) aj
	 *  cenu (Money TS kód → €/m²). Prázdne/neznáme → sklo sa nepočíta (honest-null). Voľný
	 *  text `strechaSklo` ostáva samostatná poznámka/coating na výkres. */
	strechaSkloTyp?: string;
	/** #206 (e) — obvodové zasklenie (voľný text, napr. „RS STANDARD PLUS 4-8-4číre").
	 *  Informatívny údaj — Zasklenia má vlastný odpis, tu žiadne prepojenie na engine. */
	obvodoveZasklenie?: string;
}

/** Jedna položka nárezu. `dlzkaRezuMm === null` = počet je potvrdený, ale dĺžku rezu
 *  ešte nemáme (čaká na kótovaný výkres, O1) — NIKDY nevymýšľame číslo. */
export interface PolozkaNarezu {
	kod: string;
	nazov: string;
	dlzkaRezuMm: number | null;
	pocetKs: number;
	/** KRÁTKA šedá poznámka pod názvom v tabuľke (#233) — plain slovenčina, žiadne interné
	 *  referencie (tie ostávajú v komentároch kódu, nie na obrazovke). */
	poznamka?: string;
	/** #233 — plné odôvodnenie do rozklikávacieho detailu riadku (details/summary, default
	 *  zbalené). Plain slovenčina bez interných referencií (zbalený `<details>` je stále v DOM,
	 *  akceptačný E2E skenuje text stránky). */
	poznamkaDetail?: string;
	/** výdaj materiálu (bin-packing): dĺžka surovej tyče + počet tyčí. null/neuvedené keď
	 *  dĺžka rezu nie je známa (napr. viazaná na HH krovu). */
	vydajTyce?: { tycMm: number; pocet: number } | null;
}

/** #233 — jedna „zatiaľ nepodporovaná" položka. `kratky` = jedna krátka veta do zoznamu
 *  (viditeľná na prvý pohľad), `detail` = plné odôvodnenie do rozklikávacieho `<details>`
 *  (default zbalené). OBE polia sú plain slovenčina bez `#N`/`O-x`/odkazov na call —
 *  interné referencie ostávajú v komentároch kódu, NIKDY na obrazovke. */
export interface NepodporovanaPolozka {
	kratky: string;
	detail: string;
}

export interface NarezInformativne {
	/** predná svetlosť ZADANÁ vo formulári [mm] — do nohy preteká PRIAMO (žiadne tiché odpočty;
	 *  bývalá „efektívna svetlosť −60" bola zrušená, ch207 1731729) */
	prednaSvetlost: number;
	/** trčanie výstuhy do svetlosti [mm] = zvislý rozmer − 15 (95/125/185/235); null bez
	 *  zosilneného nosníka (ch207 1731729) */
	vystuhaTrcanieMm: number | null;
	/** svetlosť bez výstuhy [mm] = zadaná svetlosť + trčanie (kóta výkresu, OP260282: 2325);
	 *  null bez zosilneného nosníka */
	svetlostBezVystuhy: number | null;
	prednaNohaDlzka: number;
	/** null keď na stenu (bez zadných nôh) */
	zadnaNohaDlzka: number | null;
	/** rez výstuhy = šírka − 280 (informatívne, profil O2/O3) */
	vystuhaRezMm: number;
	pocetPriecok: number;
	/** #161 — MANUÁLNY počet krovov (null keď nezadané → zobrazí sa auto pocetPriecok). */
	pocetKrovov: number | null;
	/** #161 — svetlosť medzi krovmi [mm] = (šírka − 50n − 2)/(n−1), null keď n nezadané. */
	svetlostMedziKrovmi: number | null;
	/** dopočítaný rozostup predných nôh [mm], null keď < 2 nohy */
	rozostupPrednychNoh: number | null;
	/** #206 (c) — zvolený profil výstuhy (null = systémový štandard) */
	vystuhaProfil: VystuhaProfil | null;
}

export interface NarezVysledok {
	vypocitane: PolozkaNarezu[];
	informativne: NarezInformativne;
	nepodporovane: NepodporovanaPolozka[];
}

/** Počet priečok z max. rozostupu 700 mm: `ceil(šírka/700) + 1` (rozostup ≤ 700 zaručený).
 *  FALLBACK pre počet krovov, keď manuálny vstup `pocetKrovov` nie je zadaný (spätná
 *  kompatibilita). Dominik 21.8. rozhodol, že správny počet je manuálny (viď `pocetKrovovAleboFallback`). */
export function pocetPriecok(sirka: number): number {
	if (!(sirka > 0)) return 0;
	return Math.ceil(sirka / MAX_ROZOSTUP_PRIECOK) + 1;
}

/** Platný manuálny počet krovov (≥ 2) alebo `null` (→ fallback). Exportované pre
 *  `pergola-sklo.ts` (#223) — počet polí strešného skla = platný počet krovov − 1. */
export function platnyPocetKrovov(v: PergolaNarezVstup): number | null {
	const n = v.pocetKrovov;
	// Zrkadlí `chybaPergolaNarezVstupu`: celé číslo v rozsahu, žiadne tiché zaokrúhlenie (aby
	// caller, ktorý obíde validáciu, nedostal iný počet než ktorý prešiel validáciou).
	return typeof n === 'number' &&
		Number.isInteger(n) &&
		n >= POCET_KROVOV_MIN &&
		n <= POCET_KROVOV_MAX
		? n
		: null;
}

/** Svetlosť medzi krovmi [mm] pre `n` krovov: `(šírka − 50·n − 2)/(n−1)` (Dominik 21.8.).
 *  `null` keď `n < 2` alebo šírka neplatná — nikdy NaN/delenie nulou. 50 = šírka krovu,
 *  2 = 2×1 mm odsadenie od kraja. Overené na golden OP260282: (4990 − 402)/7 = 655,43. */
export function svetlostMedziKrovmi(sirka: number, n: number | null): number | null {
	if (n == null || !(n >= 2) || !(sirka > 0)) return null;
	const s = R2((sirka - KROV_SIRKA_MM * n - KROV_OKRAJ_ODSADENIE_MM) / (n - 1));
	// Backstop: krovy sa do šírky nezmestia (príliš veľa krovov na danú šírku) → svetlosť ≤ 0.
	// Nikdy nevraciame zápornú/nulovú svetlosť do materiálu/Money (validácia to odmieta vopred).
	return s > 0 ? s : null;
}

/** Počet surových tyčí (`tycMm`) na `pocetKs` kusov dĺžky `dlzkaKusu` [mm] — výdaj
 *  materiálu (bin-packing). Rovnaké kusy → first-fit = `ceil(pocetKs / kusovNaTyc)`.
 *  ČISTÁ funkcia — replikuje pattern z `$lib/server/pergola.ts` (Money odpisová cesta),
 *  ktorý display engine NESMIE importovať (money-safety guard), preto sa vzor kopíruje,
 *  neimportuje. `null` keď je kus dlhší než tyč (nevyrobiteľné z tejto tyče) alebo vstup
 *  neplatný — NIKDY NaN/0. */
export function pocetTyci(dlzkaKusu: number, pocetKs: number, tycMm: number): number | null {
	if (!(dlzkaKusu > 0) || !(pocetKs >= 1) || !(tycMm > 0)) return null;
	if (dlzkaKusu > tycMm) return null;
	const kusovNaTyc = Math.floor(tycMm / dlzkaKusu);
	return Math.ceil(pocetKs / kusovNaTyc);
}

/** Výdaj tyčí ako objekt na zobrazenie (`{ tycMm, pocet }`), alebo null keď sa nedá
 *  spočítať (napr. dĺžka rezu nie je známa). */
function spocitajVydaj(
	dlzkaKusu: number,
	pocetKs: number,
	tycMm: number
): { tycMm: number; pocet: number } | null {
	const p = pocetTyci(dlzkaKusu, pocetKs, tycMm);
	return p == null ? null : { tycMm, pocet: p };
}

/** #205 (výkres OP260282): odpočet pre bočný 110×43 „pod fixom" = profil prednej nohy
 *  (systém 110/140) + zadný prvok (na stene = vlastná šírka 43; SS = horný profil zadnej
 *  110/140). Reprodukuje 5 hodnôt poznámky výkresu; OP260282 (massive SS so 110 zadnou):
 *  140 + 110 = 250 → hĺbka 3470 − 250 = 3220 = presný rez. ČISTÁ funkcia.
 *  POZNÁMKA (na potvrdenie Dominikovi): poznámka výkresu dáva 5 kombinácií; aditívny rozklad
 *  ich reprodukuje presne, ale zovšeobecňuje aj na Robust SS so 140 zadnou (110+140), ktorý
 *  poznámka nedokladá (Robust SS uvádza len −220 = 110+110). Rozklad je overený na 5 bodoch. */
export function podFixomOdpocet(v: PergolaNarezVstup): number {
	const frontProfil = SYSTEMY[v.system].stlp.rozmer; // 110 / 140
	const zadnyPrvok =
		v.uchytenie === 'samostatne' ? v.hornyProfilZadnej : POD_FIXOM_STENA_ZADNY_ODPOCET;
	return frontProfil + zadnyPrvok;
}

// (bývalá `efektivnaSvetlost` so −60 pri 200×140 ODSTRÁNENÁ — Dominik model odvolal,
//  ch207 msg 1731729: „tých 60 to je asi zle"; zadaná svetlosť sa už nikde ticho nemení.)

/** Zvislý rozmer (výška) profilu výstuhy [mm] = väčší z dvoch rozmerov prierezu. 110×110→110,
 *  140×140→140, 110×250→250 (A9 doslovne), 200×140→200 (#206: 200×140 je o 60 mm vyššia než
 *  140×140, teda výška = 200). Do vzorca prednej nohy (A9, Dominik Odoo 1724498). */
export const VYSTUHA_VYSKA: Record<VystuhaProfil, number> = {
	'110x110': 110,
	'140x140': 140,
	'200x140': 200,
	'110x250': 250
};

/** Systémový default profilu výstuhy, keď je zosilnený nosník ale profil nie je explicitne
 *  zvolený (formulár default = prázdny → OP260282): Massive → 140×140, Robust → 110×110. */
function defaultVystuhaProfil(system: PergolaSystem): VystuhaProfil {
	return system === 'Massive' ? '140x140' : '110x110';
}

/** Prídavok k (efektívnej) svetlosti pre dĺžku prednej nohy [mm], A9 (Dominik Odoo 1724498):
 *  - BEZ zosilneného nosníka → `PREDNA_NOHA_PRIDAVOK` (15), overené 1:1 na ZAK2026302.
 *  - SO zosilneným nosníkom → zvislý rozmer výstuhy: `vystuhaProfil` ak zadaný, inak systémový
 *    default (Massive 140×140, Robust 110×110). 110→+110, 140→+140, 250→+250 = A9 doslovne.
 *
 *  POZOR — kľúč je `zosilnenyNosnik`, NIE „je zadaný vystuhaProfil": OP260282 má zosilnenyNosnik
 *  s PRÁZDNYM profilom (formulár default) → default 140×140. Model 1731729 (výstuha skovaná
 *  15 mm v žľabe, trčí zvislý rozmer − 15) dáva noha = svetlosť + 15 + trčanie = svetlosť +
 *  zvislý rozmer — VŠEOBECNE, vrátane 200×140 (+200; bývalá −60 odvodenina „svetlosť + 140"
 *  padla s Dominikovým odvolaním −60). 200×140 nemá vlastný golden — na potvrdenie pri prvej
 *  takej zákazke. */
export function prednaNohaPridavok(v: PergolaNarezVstup): number {
	if (!v.zosilnenyNosnik) return PREDNA_NOHA_PRIDAVOK;
	return VYSTUHA_VYSKA[v.vystuhaProfil ?? defaultVystuhaProfil(v.system)];
}

/** Trčanie výstuhy do svetlosti [mm] = zvislý rozmer − skovanie 15 (Dominik ch207 1731729:
 *  110×110 trčí 95, 140×140 trčí 125; 200×140 → 185, 110×250 → 235). `null` bez zosilneného
 *  nosníka (výstuha fyzicky nie je). Odvodené z `prednaNohaPridavok` BY CONSTRUCTION, aby
 *  invariant „noha = svetlosť + 15 + trčanie = svetlosť + zvislý rozmer" držal z definície
 *  (nie z dvoch textovo zhodných lookupov). */
export function vystuhaTrcanieMm(v: PergolaNarezVstup): number | null {
	if (!v.zosilnenyNosnik) return null;
	return prednaNohaPridavok(v) - VYSTUHA_SKOVANIE_MM;
}

/** Dĺžka rezu prednej nohy [mm] = zadaná svetlosť + prídavok (viď `prednaNohaPridavok`;
 *  ekvivalentne svetlosť + 15 + trčanie výstuhy — model 1731729). Jeden zdroj pravdy pre
 *  `spocitajNarez` aj `schemaVykresu` (predtým duplikovaný vzorec `svetlosť+15`). */
export function prednaNohaDlzkaMm(v: PergolaNarezVstup): number {
	return R1(v.prednaSvetlost + prednaNohaPridavok(v));
}

/** Krovové lišty ako riadky nárezu (#161, derivácia 21.8. overená proti golden OP260282).
 *  Prítlačná (18006) / maskovacia (18007) / maskovacia krajová (18008) = nominál krovu + 40 —
 *  emitujú sa LEN keď je nominál (overená konfigurácia + sklon) A zadaný počet krovov `n`;
 *  počty: prítlačná = n, maskovacia stredná = n − 2 (vynechaná pri n = 2), krajová = 2. Overené
 *  na golden: 3279,76 mm, 8/6/2 ks. Zaklapávacia čelná (18005) = svetlosť medzi krovmi, 2(n−1) ks
 *  — nezávisí od systému (svetlosť je geometria zo šírky), potrebuje len `n`. Prázdne pole keď sa
 *  nič neemituje. Čistá funkcia — bez vedľajších efektov, bez Money zápisu. */
function krovoveListy(
	krovNominal: number | null,
	n: number | null,
	svetlostKrovov: number | null,
	system: PergolaSystem
): PolozkaNarezu[] {
	const riadky: PolozkaNarezu[] = [];
	if (krovNominal != null && n != null && n >= 2) {
		// prídavok per systém (Dominik ch207 1724331: Robust +30 / Massive +40)
		const pridavok =
			system === 'Robust' ? PRITLACNA_NAD_NOMINAL_ROBUST_MM : PRITLACNA_NAD_NOMINAL_MM;
		const listaDlzka = R2(krovNominal + pridavok);
		const listaPozn = `= nominál krovu + ${pridavok} (${system})`;
		// Robust čísla (odpočet −220 aj prídavok +30) sú podľa pravidla konštruktéra bez
		// vlastného overovacieho výkresu → emitovaný riadok nesie viditeľnú výhradu.
		const listaDetail =
			system === 'Robust'
				? 'Prídavok +30 aj odpočet dĺžky krovu pri Robust sú podľa pravidla konštruktéra — na potvrdenie pri prvej Robust zákazke.'
				: undefined;
		riadky.push({
			kod: '18006',
			nazov: 'Prítlačná lišta',
			dlzkaRezuMm: listaDlzka,
			pocetKs: n,
			poznamka: listaPozn,
			poznamkaDetail: listaDetail,
			vydajTyce: spocitajVydaj(listaDlzka, n, TYC_STANDARD_MM)
		});
		if (n - 2 >= 1) {
			riadky.push({
				kod: '18007',
				nazov: 'Maskovacia lišta',
				dlzkaRezuMm: listaDlzka,
				pocetKs: n - 2,
				poznamka: listaPozn,
				poznamkaDetail: listaDetail,
				vydajTyce: spocitajVydaj(listaDlzka, n - 2, TYC_STANDARD_MM)
			});
		}
		riadky.push({
			kod: '18008',
			nazov: 'Maskovacia lišta krajová',
			dlzkaRezuMm: listaDlzka,
			pocetKs: 2,
			poznamka: listaPozn,
			poznamkaDetail: listaDetail,
			vydajTyce: spocitajVydaj(listaDlzka, 2, TYC_STANDARD_MM)
		});
	}
	if (n != null && n >= 2 && svetlostKrovov != null) {
		const zaklapKs = 2 * (n - 1);
		riadky.push({
			kod: '18005',
			nazov: 'Zaklapávacia lišta čelná',
			dlzkaRezuMm: svetlostKrovov,
			pocetKs: zaklapKs,
			poznamka: '= svetlosť medzi krovmi',
			vydajTyce: spocitajVydaj(svetlostKrovov, zaklapKs, TYC_STANDARD_MM)
		});
	}
	return riadky;
}

/** Zoznam „zatiaľ nepodporované" (#233): krátka veta + plné odôvodnenie, plain slovenčina
 *  bez interných referencií (tie ostávajú v komentároch). Vyčlenené zo `spocitajNarez`
 *  (~300-r. budget funkcie) — čistý presun, žiadna zmena obsahu. */
function zostavNepodporovane(
	v: PergolaNarezVstup,
	prieckaDlzkaNull: boolean,
	listyEmitovane: boolean,
	zaklapEmitovana: boolean
): NepodporovanaPolozka[] {
	// #233 — každá položka = krátka veta (`kratky`, do zoznamu) + plné odôvodnenie
	// (`detail`, do rozklikávacieho <details>). OBE plain slovenčina bez interných
	// referencií — tie ostávajú tu v komentároch, NIKDY na obrazovke.
	const nepodporovane: NepodporovanaPolozka[] = [];
	// Krov — frézovanie drážok (výrobný list) — VŽDY otvorené (nominál + uloženie sa už počítajú,
	// frézovanie drážok na koncoch krovu ostáva na konštruktérovi; #233 — plain, bez referencií).
	nepodporovane.push({
		kratky: 'Krov — frézovanie drážok (dĺžka/výška/uhol) je výrobný list, doplní ho konštruktér.',
		detail:
			'Nominálna dĺžka krovu a (pri sklone nad 7°) uloženie sa už počítajú. Presné frézovanie drážok na koncoch krovu (dĺžka, výška a uhol drážky) je výrobný list a doplní ho konštruktér.'
	});
	// Priečka dĺžka — LEN keď nominál nemáme (Robust alebo bez sklonu). Pri Massive+sklon sa počíta.
	if (prieckaDlzkaNull) {
		nepodporovane.push({
			kratky: 'Priečka (18004) — dĺžka rezu = nominálna dĺžka krovu, zatiaľ sa nepočíta.',
			detail:
				'Dĺžka priečky = nominálna dĺžka krovu (spodná hrana, meraná po spáde; hĺbka delené kosínusom sklonu, mínus predný a zadný profil). Počíta sa pre samostatne stojacu so zadným profilom 110 (Massive overené výkresom, Robust podľa pravidla konštruktéra), so sklonom strechy do 9° a zadaným počtom krovov; inak ostáva dĺžka čestný null — nič sa nehádže.'
		});
	}
	// Prítlačná / maskovacie — LEN keď sa neemitovali (Robust, alebo bez sklonu / počtu krovov).
	if (!listyEmitovane) {
		nepodporovane.push({
			kratky:
				'Prítlačná / maskovacia / maskovacia krajová lišta — dĺžka viazaná na krov, čaká na vzorec.',
			detail:
				'Dĺžka = nominálna dĺžka krovu + 40 mm (Massive) alebo + 30 mm (Robust). Počíta sa pre samostatne stojacu so zadným profilom 110, so sklonom strechy do 9° a zadaným počtom krovov. Inak ostáva čestný null — nič sa nehádže.'
		});
	}
	// Zaklapávacia — LEN keď sa neemitovala (bez zadaného počtu krovov).
	if (!zaklapEmitovana) {
		nepodporovane.push({
			kratky:
				'Zaklapávacia čelná lišta (18005) — dĺžka = svetlosť medzi krovmi, potrebuje počet krovov.',
			detail:
				'Dĺžka = svetlosť medzi krovmi = (šírka − 50 × počet krovov − 2) / (počet krovov − 1); počet líšt = 2 × (počet krovov − 1). Zadaj počet krovov, aby sa spočítala.'
		});
	}
	// #155 A9 (Dominik Odoo 1724498): výkresová „2340×2 pod 18017" NIE JE samostatná zvislá zadná
	// výstuha — je to PREDNÁ NOHA (svetlosť 2200 + výstuha 140), TERAZ vo `vypocitane`. Skoršia
	// misatribúcia: 2340 = svetlosť 2325 + 15 (zadná svetlosť, nie vstup) vs predná 2200 + 140 dávali
	// rovnaké číslo; A9 to reklasifikoval na prednú nohu. Preto honest-null nota ODSTRÁNENÁ.
	nepodporovane.push(
		{
			// (sklá / strešná výplň = O11)
			kratky: 'Sklá / strešná výplň (šírky, dĺžky, materiál, RAL) — zadáva sa vedome ručne.',
			detail:
				'Rozmery, materiál a RAL skiel appka zámerne nepočíta — zadávajú sa ručne, mimo tohto výpočtu.'
		},
		{
			// (spád/kliny = zasklenie pod pergolou, mimo scope #155)
			kratky: 'Spád / kliny — patria k zaskleniu pod pergolou, nie k nohám pergoly.',
			detail:
				'Spád a kliny sa riešia pri zasklení pod pergolou, nie pri konštrukcii pergoly — sú mimo tohto výpočtu.'
		}
	);
	if (v.zosilnenyNosnik) {
		// (per-systém varianta = O2, presné pravidlo = O3)
		nepodporovane.push({
			kratky: 'Zosilnený nosník — presné per-systém pravidlo profilu čaká na vzorec od Dominika.',
			detail:
				'Žľabová výstuha (Massive = šírka − 280) sa už počíta a odzrkadľuje zvolený profil (140×140 / 200×140); Robust varianta (šírka − 220) je zatiaľ len informatívna a presné per-systém pravidlo dĺžky čaká na potvrdenie.'
		});
	}
	// #206 (c): Robust varianty výstuhy (110×110 / 110×250) — presné dĺžky nad −220 pravidlo
	// nie sú potvrdené → honest-null. (Bývalý −60 model 200×140 bol odvolaný, ch207 1731729.)
	if (v.vystuhaProfil === '110x110' || v.vystuhaProfil === '110x250') {
		const kod =
			v.vystuhaProfil === '110x250'
				? `${KOD_VYSTUHA_250x110} (Profil 250x110)`
				: `${SYSTEMY.Robust.stlp.kod} (Profil 110x110 V2)`;
		nepodporovane.push({
			kratky: `Výstuha Robust ${v.vystuhaProfil} — presná dĺžka rezu čaká na vzorec od Dominika.`,
			detail: `Skovaná 15 mm v žľabe ako nohy; presná dĺžka rezu nad potvrdené pravidlo (šírka − 220) zatiaľ nie je overená → dĺžku nehádžeme. Kód: ${kod}.`
		});
	}
	// #206 (a): jednoduchá pergola bez zasklenia → bočné 110×43 vypnuté (evidencia vo výstupe)
	if (v.jednoduchaBezZasklenia) {
		nepodporovane.push({
			kratky: 'Jednoduchá pergola bez zasklenia — bočné profily 110×43 sú vypnuté.',
			detail:
				'Pri jednoduchej pergole bez zasklenia sa bočné profily 110×43 (2 pod fixom + 2 pod kotviacim pri stene, spolu 4) nepočítajú do materiálu.'
		});
	}
	return nepodporovane;
}

/** Rozdelí materiál na potvrdené položky, informatívne hodnoty a zoznam „zatiaľ
 *  nepodporované". Čistá funkcia — bez vedľajších efektov, bez Money zápisu. */
export function spocitajNarez(v: PergolaNarezVstup): NarezVysledok {
	const sys = SYSTEMY[v.system];
	// #155 A9 (Dominik Odoo 1724498) + model 1731729: predná noha = svetlosť + rozmer výstuhy
	// pri zosilnenom nosníku, inak + 15. Jeden zdroj so `schemaVykresu` cez `prednaNohaDlzkaMm`.
	const prednaNohaDlzka = prednaNohaDlzkaMm(v);
	const trcanie = vystuhaTrcanieMm(v);
	const prednaNohaPozn = v.zosilnenyNosnik
		? `= svetlosť + ${prednaNohaPridavok(v)} (rozmer výstuhy)`
		: '= svetlosť + 15';
	const samostatne = v.uchytenie === 'samostatne';
	const zasklena = !v.jednoduchaBezZasklenia;
	// #316 (Dominik 24.8., kanál 207 msg 1731730): zadná konštrukcia (LEN samostatne stojaca)
	// sleduje HORNÝ PROFIL zadnej (110/140), nie systém. Pri výstuhe 110×110 sú aj zadné nohy 110;
	// horizontálny profil sedí NA nohách → dĺžka zadnej nohy = ZV − rozmer horného profilu
	// (110 → ZV−110, 140 → ZV−140), NIE plná ZV (rieši ZV-protirečenie výkresu OP260282 plná 2790
	// vs call ZV−profil v prospech callu). Kód/názov nohy AJ horného profilu = ZADNA_KONSTRUKCIA_PROFIL
	// → zadná konštrukcia je jednotná by-construction (predtým: noha = systémový kód, horný = hardcoded
	// 18013 → pri Massive so 110 zadnou nejednotná). `hornyProfilZadnej` diskriminuje AJ kaskádu
	// bočného 110×43 „pod fixom" (podFixomOdpocet, nezmenené).
	const zadnaProfil = ZADNA_KONSTRUKCIA_PROFIL[v.hornyProfilZadnej];
	const zadnaNohaDlzka = samostatne ? R1(v.vyskaZadna - v.hornyProfilZadnej) : null;
	const priecky = pocetPriecok(v.sirka);
	// #161 — MANUÁLNY počet krovov (Dominik 21.8.: nie auto ceil(š/700)+1). n = platný manuál
	// alebo null → fallback na auto `priecky`. Svetlosť medzi krovmi + počet zaklapávacích
	// líšt (2(n−1)) sa počítajú LEN z manuálneho n.
	const n = platnyPocetKrovov(v);
	const pocetKrovovAleboFallback = n ?? priecky;
	const svetlostKrovov = svetlostMedziKrovmi(v.sirka, n);
	// Nominálna dĺžka krovu (spodná hrana/uloženie). Massive: −250, overené na golden OP260282;
	// Robust: −220 od 25.8. (Dominik ch207 msg 1724329 — výsuv −154,94 masív / −124,94 Robust =
	// verbatim rozdiel presne 30; kotva = overený masív bod; bez Robust goldenu → poznámka „na
	// potvrdenie"). Gate na konfiguráciu KOTVY: samostatne stojaca + zadný profil 110 — Massive
	// so zadným 140 alebo na stenu ostáva NEOVERENÉ → honest-null (nikdy sa nehádže do Money).
	// A7: sklon nad 9° vracia null priamo `krovDlzkaNominal`. null aj bez sklonu.
	const krovConfigOverena = v.uchytenie === 'samostatne' && v.hornyProfilZadnej === 110;
	const krovNominal = krovConfigOverena
		? krovDlzkaNominal(v.hlbka, v.sklonStrechy, v.system)
		: null;
	// Do MONEY riadku (priečka aj lišty) ide dĺžka LEN keď je zadaný aj MANUÁLNY počet krovov —
	// bez neho by priečka niesla starý auto-počet ceil(š/700)+1 (ktorý výkres vyvrátil: 9 vs 8)
	// do rezervácie. Bez n → čestný null (nominál sa do Money nepustí).
	const krovDlzkaDoMoney = krovNominal != null && n != null ? krovNominal : null;
	const rozostup = v.pocetPrednychNoh > 1 ? R1(v.sirka / (v.pocetPrednychNoh - 1)) : null;

	const vypocitane: PolozkaNarezu[] = [
		{
			kod: sys.stlp.kod,
			nazov: `${sys.stlp.nazov} — predná noha`,
			dlzkaRezuMm: prednaNohaDlzka,
			pocetKs: v.pocetPrednychNoh,
			poznamka: prednaNohaPozn,
			poznamkaDetail: !v.zosilnenyNosnik
				? 'Dĺžka rezu prednej nohy = predná svetlosť plus 15 mm (skovanie v žľabe). Overené na reálnej zákazke.'
				: v.vystuhaProfil === '200x140'
					? 'Pri zosilnenom nosníku je dĺžka nohy predná svetlosť plus zvislý rozmer výstuhy — výstuha je skovaná 15 mm v žľabe a zvyšok trčí do svetlosti. Pri výstuhe 200×140 je to svetlosť plus 200 (všeobecné pravidlo konštruktéra) — na potvrdenie pri prvej takej zákazke.'
					: 'Pri zosilnenom nosníku je dĺžka nohy predná svetlosť plus zvislý rozmer výstuhy (110, 140 alebo 250) — výstuha je skovaná 15 mm v žľabe a zvyšok trčí do svetlosti.'
		}
	];
	if (samostatne) {
		vypocitane.push({
			kod: zadnaProfil.kod,
			nazov: `${zadnaProfil.nazov} — zadná noha`,
			dlzkaRezuMm: zadnaNohaDlzka,
			pocetKs: v.pocetZadnychNoh,
			poznamka: `= zadná výška − horný profil ${v.hornyProfilZadnej}`,
			poznamkaDetail:
				'Dĺžka rezu zadnej nohy = zadná výška ZV mínus rozmer horného profilu zadnej konštrukcie — horizontálny profil sedí na nohách. Pri hornom profile 110 sú aj zadné nohy 110, pri 140 aj nohy 140; zadná konštrukcia je jednotná.'
		});
	}
	// #161 — priečka (krokva): dĺžka = NOMINÁL krovu (LEN overená konfigurácia + zadaný počet
	// krovov; inak čestný null), počet = manuálny počet krovov (fallback auto len pre zobrazenie
	// počtu, do Money ide dĺžka iba s manuálnym n). HH krovu (výkres 3240,93) = nominál + ~1,17 mm
	// reálne uloženie — bez čistého vzorca, preto emitujeme nominál (do rezervácie stačí).
	vypocitane.push({
		kod: v.prieckaLight ? KOD_PRIECKA_LIGHT : KOD_PRIECKA_NORMAL,
		nazov: v.prieckaLight ? 'Priečkový profil 105 (light)' : 'Priečkový profil 105',
		dlzkaRezuMm: krovDlzkaDoMoney,
		pocetKs: pocetKrovovAleboFallback,
		poznamka:
			krovDlzkaDoMoney != null
				? '= nominálna dĺžka krovu (meraná po spáde)'
				: 'dĺžka rezu = nominálna dĺžka krovu — zatiaľ sa nepočíta',
		poznamkaDetail:
			krovDlzkaDoMoney != null
				? 'Dĺžka = nominálna dĺžka krovu (spodná hrana), meraná po spáde: hĺbka delené kosínusom sklonu, mínus predný a zadný profil. Horná hrana krovu je o ~1 mm vyššie (reálne uloženie) — do rezervácie stačí nominál. Počet = zadaný počet krovov.' +
					(v.system === 'Robust'
						? ' Robust odpočet je podľa pravidla konštruktéra — na potvrdenie pri prvej Robust zákazke.'
						: '')
				: 'Dĺžka priečky = nominálna dĺžka krovu (spodná hrana, meraná po spáde). Počíta sa pre samostatne stojacu so zadným profilom 110 (Massive overené výkresom, Robust podľa pravidla konštruktéra — na potvrdenie pri prvej takej zákazke), so zadaným sklonom strechy do 9° a počtom krovov. Inak ostáva dĺžka čestný null — nič sa nehádže.',
		vydajTyce:
			krovDlzkaDoMoney != null
				? spocitajVydaj(krovDlzkaDoMoney, pocetKrovovAleboFallback, TYC_STANDARD_MM)
				: null
	});

	// --- Profily z Plánu rezov výkresu OP260282 (#205) — LEN presne odvoditeľné ---------
	// Žľab (18018/18021) + kotviaci (18019) = šírka, na 6 m tyče; zadná konštrukcia horná
	// (18013, len samostatne stojaca) = šírka, na 7,5 m tyč; výstuha horná (18017, LEN
	// massive so zosilneným nosníkom) = šírka − 280. POZOR (#196/O1): `sirka` musí byť
	// skutočná šírka profilu — vzťah žľab↔rám (presah) je O1-blokovaný a je aj dôvod,
	// prečo počet priečok (ceil(š/700)+1) môže byť o 1 vyšší než na výkrese (rám < žľab).
	// Dĺžky viazané na HH krovu (priečka, prítlačná/maskovacie) sa NEDOPĹŇAJÚ — viď
	// nepodporovane[]. #205: 18016 „pod fixom" (hĺbka − kaskáda) a zadné nohy (plná ZV) SÚ už
	// vo vypocitane (výkresom overené); čestný null ostáva LEN zvislej zadnej výstuhe 2340
	// (svetlosť 2325 nie je vstup) — nefitujeme nepotvrdený vzorec nasilu.
	const sirkaMm = R1(v.sirka);
	vypocitane.push({
		kod: sys.zlab.kod,
		nazov: `${sys.zlab.nazov} — žľab`,
		dlzkaRezuMm: sirkaMm,
		pocetKs: 1,
		poznamka: '= šírka',
		poznamkaDetail: 'Berie sa skutočná šírka profilu; žľab presahuje rám o presah na obe strany.',
		vydajTyce: spocitajVydaj(sirkaMm, 1, TYC_ZLAB_KOTVIACI_MM)
	});
	vypocitane.push({
		kod: '18019',
		nazov: 'Kotviaci profil horný V2',
		dlzkaRezuMm: sirkaMm,
		pocetKs: 1,
		poznamka: '= šírka',
		vydajTyce: spocitajVydaj(sirkaMm, 1, TYC_ZLAB_KOTVIACI_MM)
	});
	if (samostatne) {
		vypocitane.push({
			kod: zadnaProfil.kod,
			nazov: `${zadnaProfil.nazov} — zadná konštrukcia horná`,
			dlzkaRezuMm: sirkaMm,
			pocetKs: 1,
			poznamka: '= šírka',
			poznamkaDetail:
				'Horný profil zadnej konštrukcie = šírka; kód aj profil sledujú horný profil zadnej (110 → 110×110, 140 → 140×140), jednotný so zadnými nohami. Zdieľa 7,5 m tyče so zadnými nohami.',
			vydajTyce: spocitajVydaj(sirkaMm, 1, TYC_STANDARD_MM)
		});
	}
	if (v.zosilnenyNosnik && v.system === 'Massive') {
		const vystuhaHorna = R1(v.sirka - VYSTUHA_ODPOCET);
		// #206 (c): keď je zvolený profil výstuhy 200×140, výstuha horná JE ten profil —
		// odzrkadli kód (18022, z katalógu) a názov, nech dielňa nereže 140×140 pri
		// výslovne zvolenom 200×140. Dĺžka (šírka − 280) je rozpätie medzi nohami, na
		// priereze nezávisí, takže sa nemení. Default (140×140/nezadané) = 18017.
		const je200 = v.vystuhaProfil === '200x140';
		vypocitane.push({
			kod: je200 ? KOD_VYSTUHA_200x140 : '18017',
			nazov: je200
				? 'Profil 200x140 — žľabová výstuha (zosilnenie)'
				: 'Profil 140x140 — žľabová výstuha (zosilnenie)',
			dlzkaRezuMm: vystuhaHorna,
			pocetKs: 1,
			poznamka: '= šírka − 280 (Massive)',
			poznamkaDetail:
				'Žľabová výstuha = šírka − 280 (Massive); zdieľa 7,5 m tyče so zadnou výstuhou.',
			vydajTyce: spocitajVydaj(vystuhaHorna, 1, TYC_STANDARD_MM)
		});
	}

	// --- #205 (výkres OP260282): bočný profil 110×43 „pod fixom" (2 ks, pozdĺžne po bokoch) --
	// Dĺžka z HĹBKY: hĺbka − (profil prednej nohy + zadný prvok). Kaskáda z poznámky výkresu
	// (robust −153/robust SS −220/massive −183/massive SS 110 −250/massive SS 140 −280) sa
	// rozloží na frontProfil (110/140) + zadný prvok (43 stena / 110|140 SS) — viď
	// podFixomOdpocet. OVERENÉ 1:1 na OP260282 (massive SS so 110): 3470 − (140+110) = 3220.
	// „šírka" v poznámke výkresu = rozmer profilu POZDĹŽ boku = smer hĺbky (4990−250 nezmysel;
	// 3470−250=3220 presne). Emituje sa pri VŠETKÝCH konfigoch (SS aj stena), gated na
	// „jednoduchá bez zasklenia" (#206 a ho vypína spolu s pod kotviacim). Oddelený riadok od
	// „pod kotviacim" nižšie (oba 18016, iný názov + iný vzorec).
	if (zasklena) {
		const podFixom = R1(v.hlbka - podFixomOdpocet(v));
		vypocitane.push({
			kod: KOD_PROFIL_110x43,
			nazov: 'Profil 110x43 V2 — bočný pod fixom',
			dlzkaRezuMm: podFixom,
			pocetKs: POCET_BOCNYCH_POD_FIXOM,
			poznamka: '= hĺbka − (profil nohy + zadný prvok)',
			poznamkaDetail:
				'Dĺžka = hĺbka − (profil prednej nohy + zadný prvok), kaskáda z výkresu, overená na Massive samostatne stojacej (3470 − 250 = 3220). Vypne ju voľba „jednoduchá bez zasklenia".',
			vydajTyce: spocitajVydaj(podFixom, POCET_BOCNYCH_POD_FIXOM, TYC_STANDARD_MM)
		});
	}

	// --- #206 (b): bočný profil 110×43 pod kotviacim pri NIE-samostatne stojacej -----------
	// Modrá poznámka: „ak nie je pergola SS, vzadu pod kotviacim profilom je tiež profil
	// 110x43, ZV −190 mm" → POTVRDENÝ vzorec. Emituje sa LEN pri uchytení na stenu (nie SS)
	// A pri zasklenej pergole (checkbox „jednoduchá bez zasklenia" ho vypína — #206 a). ZV sa
	// pri stene inak nevaliduje, preto guardujeme rozsah tu (mimo rozsahu → riadok sa neemituje,
	// bez chyby — „na stenu ZV nevaliduje" zostáva). OP260282 je SS → riadok sa NEobjaví →
	// golden ostáva bit-identický.
	const zvVRozsahu = v.vyskaZadna >= VYSKA_ZADNA_MIN && v.vyskaZadna <= VYSKA_ZADNA_MAX;
	if (zasklena && !samostatne && zvVRozsahu) {
		const podKotv = R1(v.vyskaZadna - POD_KOTVIACI_110x43_ODPOCET);
		vypocitane.push({
			kod: KOD_PROFIL_110x43,
			nazov: 'Profil 110x43 V2 — bočný pod kotviacim (u steny)',
			dlzkaRezuMm: podKotv,
			pocetKs: POCET_BOCNYCH_POD_KOTVIACIM,
			poznamka: 'pri stene = ZV − 190',
			poznamkaDetail:
				'Pri uchytení na stenu = zadná výška ZV − 190 (potvrdené výkresom); skovaný 15 mm v žľabe ako nohy. Vypne ho voľba „jednoduchá pergola bez zasklenia".',
			vydajTyce: spocitajVydaj(podKotv, POCET_BOCNYCH_POD_KOTVIACIM, TYC_STANDARD_MM)
		});
	}

	// #161 — krovové lišty (prítlačná/maskovacie + zaklapávacia) sa budujú v `krovoveListy`;
	// tu ostávajú len flagy pre podmienené „nepodporované" nižšie (aby sa neduplikoval riadok).
	const listyEmitovane = krovNominal != null && n != null && n >= 2;
	const zaklapEmitovana = n != null && n >= 2 && svetlostKrovov != null;
	vypocitane.push(...krovoveListy(krovNominal, n, svetlostKrovov, v.system));

	const nepodporovane = zostavNepodporovane(
		v,
		krovDlzkaDoMoney == null,
		listyEmitovane,
		zaklapEmitovana
	);
	return {
		vypocitane,
		informativne: {
			prednaSvetlost: v.prednaSvetlost,
			vystuhaTrcanieMm: trcanie,
			svetlostBezVystuhy: trcanie != null ? R1(v.prednaSvetlost + trcanie) : null,
			prednaNohaDlzka,
			zadnaNohaDlzka,
			vystuhaRezMm: R1(v.sirka - VYSTUHA_ODPOCET),
			pocetPriecok: priecky,
			pocetKrovov: n,
			svetlostMedziKrovmi: svetlostKrovov,
			rozostupPrednychNoh: rozostup,
			vystuhaProfil: v.vystuhaProfil ?? null
		},
		nepodporovane
	};
}

// #381 VÝROBNÁ varianta hárku (pozičné čísla, reťazové kóty priečok, tolerancie) je
// vyčlenená do `$lib/pergola-vyroba.ts` (large-file split — tento súbor prekročil 1000 r.).
// Konzumenti importujú tie funkcie priamo z `$lib/pergola-vyroba` (acyklický import: vyroba
// → narez, nikdy naopak). Sem sa NEre-exportuje (žiadny cyklus).

// --- Geometria pre technický výkres (#194) ---------------------------------------
// Čistá geometria pre výkresovú vrstvu (`PergolaNarezVykres.svelte`) — rovnaká
// disciplína ako `vypocitajGeometriu` v pergola-navrh.ts / `sekciePozicie` v
// bazen-navrh.ts: geometria žije v .ts engine (unit-testovateľná, pokrytá
// money-safety guardom), komponenta LEN kreslí. Kreslí sa LEN potvrdená geometria
// (nohy/rozostupy/priečky/žľab pozícia) — krov je #161 (O4/O5/O6 blokované), preto
// ho výkres kreslí len ako obrys s poznámkou, NIKDY nehádže sklon/rozostup krovu.

/** Rovnomerné X-pozície `pocet` prvkov na úsečke [0, sirka] (mm). Pri 2+ nohách
 *  krajné sadnú na 0 a sirka, ostatné rovnomerne medzi ne (rozostup = sirka/(n−1)).
 *  Prázdne pole pri `pocet < 1`. */
function rovnomerneX(pocet: number, sirka: number): number[] {
	if (pocet < 1) return [];
	if (pocet === 1) return [R1(sirka / 2)];
	return Array.from({ length: pocet }, (_, i) => R1((i * sirka) / (pocet - 1)));
}

/** Zadná konštrukcia výkresu — na stenu (žiadne zadné nohy, len referenčná stena)
 *  vs samostatne stojaca (zadné nohy s dĺžkou/výškou). */
export type ZadnaKonstrukciaSchema =
	| { typ: 'stena' }
	| {
			typ: 'samostatne';
			nohyX: number[];
			nohaDlzka: number;
			vyskaZadna: number;
			hornyProfil: HornyProfil;
	  };

export interface PergolaNarezSchema {
	sirka: number;
	hlbka: number;
	/** rozmer profilu stĺpu/žľabu systému [mm] (110/140) — vizuálna hrúbka nôh + žľabu */
	profilRozmer: 110 | 140;
	/** predná svetlá výška [mm] — VIZUÁLNA výška prednej nohy po spodok žľabu */
	prednaSvetlost: number;
	/** dĺžka rezu prednej nohy [mm] = svetlosť + rozmer výstuhy (zosilnený nosník) / + 15 (bez);
	 *  info popisok, nie kreslená výška. Viď `prednaNohaDlzkaMm`. */
	prednaNohaDlzka: number;
	/** hrúbka horného nosníka (žľab + kotviaci profil) [mm] = profilRozmer */
	zlabHrubka: number;
	/** X-pozície predných nôh [mm], 0..sirka */
	prednaNohyX: number[];
	/** dopočítaný rozostup predných nôh [mm], null keď < 2 nohy */
	rozostupPrednychNoh: number | null;
	zadnaKonstrukcia: ZadnaKonstrukciaSchema;
	/** priečky (deliace výplne v prednom pohľade). `pocet` = celkový počet vrátane
	 *  dvoch krajných (= vonkajšie profily); `pozicieX` = LEN vnútorné deliace čiary
	 *  (bez krajných), rovnomerne, rozostup ≤ 700 (MAX_ROZOSTUP_PRIECOK). */
	priecky: { pocet: number; pozicieX: number[] };
}

/** Čistá geometria technického výkresu z rozmerov (#194). Kreslí LEN potvrdené
 *  vzorce — krov (sklon/rozostup) NIE JE súčasťou (patrí do #161), komponenta ho
 *  zobrazí len ako obrys s poznámkou. Bez vedľajších efektov, bez Money zápisu. */
export function schemaVykresu(v: PergolaNarezVstup): PergolaNarezSchema {
	const sys = SYSTEMY[v.system];
	const priecky = pocetPriecok(v.sirka);
	// vnútorné deliace čiary priečok — krajné (i=0, i=priecky-1) sadnú na hrany
	// (vonkajšie profily), preto ich vynechávame, aby sa neprekrývali s rámom
	const priezkyVnutorne =
		priecky >= 3
			? Array.from({ length: priecky - 2 }, (_, i) => R1(((i + 1) * v.sirka) / (priecky - 1)))
			: [];
	const samostatne = v.uchytenie === 'samostatne';

	return {
		sirka: v.sirka,
		hlbka: v.hlbka,
		profilRozmer: sys.stlp.rozmer,
		// výkres kreslí ZADANÚ svetlosť (žiadne tiché odpočty — bývalá −60 zrušená, 1731729)
		prednaSvetlost: v.prednaSvetlost,
		// #155 A9: pri zosilnenom nosníku noha = svetlosť + rozmer výstuhy (viď `prednaNohaDlzkaMm`),
		// inak + 15. Rovnaký zdroj ako `spocitajNarez` → výkres a materiál sedia.
		prednaNohaDlzka: prednaNohaDlzkaMm(v),
		zlabHrubka: sys.stlp.rozmer,
		prednaNohyX: rovnomerneX(v.pocetPrednychNoh, v.sirka),
		rozostupPrednychNoh: v.pocetPrednychNoh > 1 ? R1(v.sirka / (v.pocetPrednychNoh - 1)) : null,
		zadnaKonstrukcia: samostatne
			? {
					typ: 'samostatne',
					// #316: CUT dĺžka nohy = ZV − horný profil (Dominik 24.8.); VIZUÁLNA výška ostáva
					// vyskaZadna (noha + horný profil dosiahnu ZV) — geometria kreslenia sa nemení.
					nohyX: rovnomerneX(v.pocetZadnychNoh, v.sirka),
					nohaDlzka: R1(v.vyskaZadna - v.hornyProfilZadnej),
					vyskaZadna: v.vyskaZadna,
					hornyProfil: v.hornyProfilZadnej
				}
			: { typ: 'stena' },
		priecky: { pocet: priecky, pozicieX: priezkyVnutorne }
	};
}

/** Serverová validácia rozsahov — Slovak chybová hláška, alebo null keď je vstup
 *  platný. Server je jediný strážca rozsahov (rovnaká disciplína ako fix.ts /
 *  pergola-navrh.ts). */
export function chybaPergolaNarezVstupu(v: PergolaNarezVstup): string | null {
	if (v.system !== 'Robust' && v.system !== 'Massive') return 'Neplatný systém pergoly.';
	if (!(v.sirka >= SIRKA_MIN && v.sirka <= SIRKA_MAX))
		return `Šírka musí byť ${SIRKA_MIN}–${SIRKA_MAX} mm.`;
	if (!(v.hlbka >= HLBKA_MIN && v.hlbka <= HLBKA_MAX))
		return `Hĺbka musí byť ${HLBKA_MIN}–${HLBKA_MAX} mm.`;
	if (!(v.prednaSvetlost >= SVETLOST_MIN && v.prednaSvetlost <= SVETLOST_MAX))
		return `Predná svetlosť musí byť ${SVETLOST_MIN}–${SVETLOST_MAX} mm.`;
	if (!(v.pocetPrednychNoh >= POCET_NOH_MIN && v.pocetPrednychNoh <= POCET_NOH_MAX))
		return `Počet predných nôh musí byť ${POCET_NOH_MIN}–${POCET_NOH_MAX}.`;
	if (v.hornyProfilZadnej !== 110 && v.hornyProfilZadnej !== 140)
		return 'Horný profil zadnej konštrukcie musí byť 110 alebo 140.';
	// sklon strechy je VOLITEĽNÝ (null = nezadaný, OK); keď zadaný, len obranný rozsah —
	// vetvu pod 7° rieši krov engine čestne, nie chybou
	if (v.sklonStrechy != null && !(v.sklonStrechy > SKLON_MIN && v.sklonStrechy <= SKLON_MAX))
		return `Sklon strechy musí byť ${SKLON_MIN + 0.1}–${SKLON_MAX}° (alebo prázdne).`;
	// #161 — manuálny počet krovov je VOLITEĽNÝ (null → auto fallback); keď zadaný, celé číslo 2–50
	if (v.pocetKrovov != null) {
		if (!(Number.isFinite(v.pocetKrovov) && Number.isInteger(v.pocetKrovov)))
			return 'Počet krovov musí byť celé číslo.';
		if (!(v.pocetKrovov >= POCET_KROVOV_MIN && v.pocetKrovov <= POCET_KROVOV_MAX))
			return `Počet krovov musí byť ${POCET_KROVOV_MIN}–${POCET_KROVOV_MAX} (alebo prázdne).`;
		// krovy sa musia zmestiť do šírky: svetlosť medzi krovmi = (šírka − 50n − 2)/(n−1) > 0.
		// Bez tejto kontroly by prehnaný počet krovov na úzku šírku dal ZÁPORNÚ dĺžku zaklapávacej
		// lišty, ktorá by (kladný počet ks) prešla do Money rezervácie — všetko ostatné je
		// rozsahovo validované, tento Money-zápisový vstup musí byť tiež.
		if (svetlostMedziKrovmi(v.sirka, v.pocetKrovov) == null)
			return 'Počet krovov sa do šírky nezmestí — svetlosť medzi krovmi by bola nulová alebo záporná. Zadaj menej krovov.';
	}
	// #206 (c) — profil výstuhy: buď nezadaný (systémový štandard) alebo známa hodnota, a
	// prierez musí sedieť so systémom (140×140/200×140 = Massive; 110×110/110×250 = Robust) —
	// gate proti system×profil nekonzistencii z ručného POST (formulár ponúka správne per systém).
	if (v.vystuhaProfil != null) {
		if (!['140x140', '200x140', '110x110', '110x250'].includes(v.vystuhaProfil))
			return 'Neplatný profil výstuhy.';
		const massiveProfil = v.vystuhaProfil === '140x140' || v.vystuhaProfil === '200x140';
		if (massiveProfil !== (v.system === 'Massive'))
			return 'Profil výstuhy nesedí so systémom (140×140/200×140 = Massive, 110×110/110×250 = Robust).';
	}
	// #206 (d) — keď je zapnuté frézovanie zvodu, výška SH frézovania musí byť zadaná a v rozsahu
	if (v.zvodFrezovat) {
		if (
			v.zvodFrezovanieSHmm == null ||
			!(v.zvodFrezovanieSHmm > 0 && v.zvodFrezovanieSHmm <= ZVOD_SH_MAX)
		)
			return `Zadaj výšku SH frézovania zvodu (0–${ZVOD_SH_MAX} mm) alebo zvoľ „nefrézovať".`;
	}
	// zadné nohy sa validujú LEN pri samostatne stojacej — na stenu sa nepoužívajú
	if (v.uchytenie === 'samostatne') {
		if (!(v.vyskaZadna >= VYSKA_ZADNA_MIN && v.vyskaZadna <= VYSKA_ZADNA_MAX))
			return `Výška zadná musí byť ${VYSKA_ZADNA_MIN}–${VYSKA_ZADNA_MAX} mm.`;
		if (!(v.pocetZadnychNoh >= POCET_NOH_MIN && v.pocetZadnychNoh <= POCET_NOH_MAX))
			return `Počet zadných nôh musí byť ${POCET_NOH_MIN}–${POCET_NOH_MAX}.`;
	}
	// #206 (b) — ZV je load-bearing aj pri stena+zasklená (bočný 110×43 pod kotviacim = ZV−190),
	// takže ju tu validujeme (inak by mimo rozsahu ticho zmizol riadok bez vysvetlenia). Pri
	// „jednoduchej bez zasklenia" na stene sa ZV nepoužíva → nevaliduje sa (0 je OK).
	if (v.uchytenie === 'stena' && !v.jednoduchaBezZasklenia) {
		if (!(v.vyskaZadna >= VYSKA_ZADNA_MIN && v.vyskaZadna <= VYSKA_ZADNA_MAX))
			return `Výška zadná ZV musí byť ${VYSKA_ZADNA_MIN}–${VYSKA_ZADNA_MAX} mm (pre bočný profil 110×43 pod kotviacim), alebo zvoľ „jednoduchá bez zasklenia".`;
	}
	return null;
}

// --- #195 KUSOVÉ komponenty — vyčlenené do `pergola-komponenty.ts` (#183 large-file split) ------
// Re-export ako fasáda: konzumenti ($lib/pergola-narez) importujú komponenty odtiaľto bez zmeny.
// `pergola-komponenty` importuje LEN typy odtiaľto (`import type` = erased za behu → žiadny cyklus).
export { PERGOLA_KOMPONENTY, komponentyPergoly } from './pergola-komponenty';
export type { PergolaKomponent } from './pergola-komponenty';
