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

/** zaokrúhlenie na 0,1 mm — rovnaká disciplína ako R1 v pergola-navrh.ts */
const R1 = (x: number) => Math.round(x * 10) / 10;

// --- Potvrdené konštanty (dôkaz = citácie t=… v analýze callu na #155) -----------
/** štandardná predná svetlosť [mm] (spodná hrana žľabu po odčítaní výstuhy), t=1011–1034s */
export const PREDNA_SVETLOST_STD = 2200;
/** dĺžka prednej nohy = predná svetlosť + tento prídavok [mm], t=1061–1072s
 *  (overené 1:1 na ZAK2026302: 2200+15 = 2215, 4× stĺp 2215 mm) */
export const PREDNA_NOHA_PRIDAVOK = 15;
/** rez výstuhy medzi nohami = šírka − toto [mm] (Dominikov doslovný citát t=985–993s).
 *  INFORMATÍVNE — per-systém varianta (šírka − 2×noha) je O2, profil je O3, oboje blokované. */
export const VYSTUHA_ODPOCET = 280;
/** maximálny rozostup priečok [mm] — cieľ 650–700, tvrdý strop 700, t=133–157s */
export const MAX_ROZOSTUP_PRIECOK = 700;

// --- Nové potvrdené konštanty z výkresu OP260282 (modré poznámky, #206) -----------
/** POTVRDENÉ (#206 modrá poznámka c): pri výstuhe 200×140 sa svetlosť zníži o ďalších
 *  60 mm (výstuha je o 60 mm vyššia než štandard 140×140: 200 − 140 = 60). Aplikuje sa na
 *  „efektívnu svetlosť", ktorá preteká do prednej nohy (svetlosť + 15). */
export const VYSTUHA_200x140_SVETLOST_ODPOCET = 60;
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
	poznamka?: string;
	/** výdaj materiálu (bin-packing): dĺžka surovej tyče + počet tyčí. null/neuvedené keď
	 *  dĺžka rezu nie je známa (napr. viazaná na HH krovu). */
	vydajTyce?: { tycMm: number; pocet: number } | null;
}

export interface NarezInformativne {
	/** predná svetlosť ZADANÁ vo formulári [mm] */
	prednaSvetlost: number;
	/** #206 (c) — efektívna svetlosť = zadaná − 60 pri výstuhe 200×140, inak = zadaná.
	 *  Toto je hodnota, ktorá preteká do prednej nohy (svetlosť + 15). */
	efektivnaSvetlost: number;
	prednaNohaDlzka: number;
	/** null keď na stenu (bez zadných nôh) */
	zadnaNohaDlzka: number | null;
	/** rez výstuhy = šírka − 280 (informatívne, profil O2/O3) */
	vystuhaRezMm: number;
	pocetPriecok: number;
	/** dopočítaný rozostup predných nôh [mm], null keď < 2 nohy */
	rozostupPrednychNoh: number | null;
	/** #206 (c) — zvolený profil výstuhy (null = systémový štandard) */
	vystuhaProfil: VystuhaProfil | null;
}

export interface NarezVysledok {
	vypocitane: PolozkaNarezu[];
	informativne: NarezInformativne;
	nepodporovane: string[];
}

/** Počet priečok z max. rozostupu 700 mm: `ceil(šírka/700) + 1` (rozostup ≤ 700 zaručený). */
export function pocetPriecok(sirka: number): number {
	if (!(sirka > 0)) return 0;
	return Math.ceil(sirka / MAX_ROZOSTUP_PRIECOK) + 1;
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

/** Efektívna predná svetlosť [mm] (#206 c): zadaná svetlosť znížená o 60 mm, keď je zvolená
 *  výstuha 200×140 (výstuha je o 60 mm vyššia než štandard 140×140). Inak = zadaná svetlosť.
 *  Toto je hodnota, ktorá preteká do prednej nohy `svetlosť + 15` — kompozícia dvoch
 *  POTVRDENÝCH pravidiel (noha = svetlosť + 15; 200×140 → svetlosť − 60), NIE vymyslený vzorec.
 *  Reziduálna neistota (mení −60 reálnu dĺžku nohy alebo len svetlú výšku?) je gap na #198. */
export function efektivnaSvetlost(v: PergolaNarezVstup): number {
	// −60 je Massive-only pravidlo (200×140 je Massive profil); gate proti system×profil
	// nekonzistencii z ručného POST (formulár ponúka 200×140 len pri Massive).
	const odpocet =
		v.vystuhaProfil === '200x140' && v.system === 'Massive' ? VYSTUHA_200x140_SVETLOST_ODPOCET : 0;
	return R1(v.prednaSvetlost - odpocet);
}

/** Rozdelí materiál na potvrdené položky, informatívne hodnoty a zoznam „zatiaľ
 *  nepodporované". Čistá funkcia — bez vedľajších efektov, bez Money zápisu. */
export function spocitajNarez(v: PergolaNarezVstup): NarezVysledok {
	const sys = SYSTEMY[v.system];
	const svetlost = efektivnaSvetlost(v);
	const prednaNohaDlzka = R1(svetlost + PREDNA_NOHA_PRIDAVOK);
	const samostatne = v.uchytenie === 'samostatne';
	const zasklena = !v.jednoduchaBezZasklenia;
	// #205 (výkres OP260282): zadná noha = PLNÁ zadná výška (ZV = dĺžka nohy), nie ZV − horný
	// profil. Call citoval „ZV − 110/140" (t=1402–1417s), no reálny výkres OP260282 uvádza
	// zadnú nohu 2790 = plná ZV → rozdiel je v mieste merania ZV (výkres: ZV = dĺžka nohy).
	// Na potvrdenie Dominikovi. Dôsledok: hornyProfilZadnej UŽ neurčuje dĺžku nohy — po novom
	// diskriminuje kaskádu bočného 110×43 „pod fixom" (podFixomOdpocet).
	const zadnaNohaDlzka = samostatne ? R1(v.vyskaZadna) : null;
	const priecky = pocetPriecok(v.sirka);
	const rozostup = v.pocetPrednychNoh > 1 ? R1(v.sirka / (v.pocetPrednychNoh - 1)) : null;

	const vypocitane: PolozkaNarezu[] = [
		{
			kod: sys.stlp.kod,
			nazov: `${sys.stlp.nazov} — predná noha`,
			dlzkaRezuMm: prednaNohaDlzka,
			pocetKs: v.pocetPrednychNoh
		}
	];
	if (samostatne) {
		vypocitane.push({
			kod: sys.stlp.kod,
			nazov: `${sys.stlp.nazov} — zadná noha`,
			dlzkaRezuMm: zadnaNohaDlzka,
			pocetKs: v.pocetZadnychNoh,
			poznamka:
				'= plná zadná výška ZV (výkres OP260282; ZV = dĺžka nohy). Call citoval ZV − horný profil (110/140) — rozdiel je v mieste merania ZV, na potvrdenie Dominikovi.'
		});
	}
	vypocitane.push({
		kod: v.prieckaLight ? KOD_PRIECKA_LIGHT : KOD_PRIECKA_NORMAL,
		nazov: v.prieckaLight ? 'Priečkový profil 105 (light)' : 'Priečkový profil 105',
		// dĺžka = HH krovu (výkres OP260282 3240.9) — HH krovu je CAD výsledok geometrie
		// krovu (#161), NIE potvrdený vzorec zo vstupov → NIKDY nehádžeme, ostáva null.
		dlzkaRezuMm: null,
		pocetKs: priecky,
		poznamka: 'dĺžka rezu = HH krovu (horná hrana krovu) — čaká na potvrdenie odvodenia (#161/#198)'
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
		poznamka: '= šírka (O1/#196: `sirka` = skutočná šírka profilu; vzťah žľab↔rám je presah)',
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
			kod: '18013',
			nazov: 'Profil 110x110 V2 — zadná konštrukcia horná',
			dlzkaRezuMm: sirkaMm,
			pocetKs: 1,
			poznamka:
				'= šírka; profil 110×110 potvrdený z výkresu OP260282 (Massive-SS) — pri inom systéme kód overiť s Dominikom pred napojením na Money (#197). Výkres zdieľa 7,5 m tyče so zadnými nohami.',
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
				? 'Profil 200x140 — výstuha horná (zosilnenie)'
				: 'Profil 140x140 — výstuha horná (zosilnenie)',
			dlzkaRezuMm: vystuhaHorna,
			pocetKs: 1,
			poznamka:
				'výstuha horná = šírka − 280 (massive); výkres zdieľa 7,5 m tyče so zadnou výstuhou',
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
			poznamka:
				'= hĺbka − (profil prednej nohy + zadný prvok); kaskáda výkresu OP260282, overené massive SS so 110 zadnou (3470−250=3220). Vypne „jednoduchá bez zasklenia".',
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
			poznamka:
				'NIE-samostatne stojaca (u steny) = ZV − 190 (potvrdené, výkres OP260282); skovaný 15 mm v žľabe ako nohy. Vypne „jednoduchá pergola bez zasklenia".',
			vydajTyce: spocitajVydaj(podKotv, POCET_BOCNYCH_POD_KOTVIACIM, TYC_STANDARD_MM)
		});
	}

	const nepodporovane: string[] = [
		'Krov / krokvy (počet, rozostup, dĺžka rezu) — geometria krovu je v #161; strop 700 mm pre rozostup krovu je otvorená otázka (O4).',
		'Priečka (18004) dĺžka rezu = HH krovu (horná hrana krovu, výkres OP260282 3240.9) — HH krovu je CAD výsledok geometrie krovu (#161), NIE vzorec zo vstupov → čestný null. Aj počet priečok sa môže líšiť: ceil(šírka/700)+1 vs výkres (rám < žľab, O1/#196).',
		'Prítlačná (18006) / maskovacia (18007) / maskovacia krajová (18008) — dĺžka = HH krovu + 40 (massive); Robust HH krovu + 39 je NEPOTVRDENÉ (Dominikov otáznik na výkrese, O18). HH krovu neodvoditeľné → čestný null (#161/#198). Tolerancia ~2 mm vs reálne uloženie je Dominikom akceptovaná.',
		'Zaklapávacia čelná lišta (18005) — dĺžka = (šírka − 402) / (počet krovov − 1); počet krovov závisí od skutočného rozostupu krovov (O1-blokovaný, na výkrese 8 krovov vs engine ceil(šírka/700)+1). Čestný null.',
		'Zvislá zadná výstuha (18017, zvislá časť) = 2340 na výkrese OP260282. Modrá poznámka „skovaná 15 mm v žľabe ako nohy" → tvar svetlosť + 15, ale 2340 = svetlosť 2325 + 15, kde 2325 NIE JE vstup (predná svetlosť zákazky 2200 dáva 2215, nie 2340). Svetlosť 2325 sa z rozmerov neodvodí, +15 vs +profil sa nedá rozlíšiť → čestný null; formula zvislej výstuhy položená Dominikovi (#198).',
		'Sklá / strešná výplň (šírky, dĺžky, materiál, RAL) — vedome ručne, appka ich nepočíta (O11).',
		'Spád / kliny — patria k zaskleniu pod pergolou, nie k nohám pergoly (mimo scope #155).'
	];
	if (v.zosilnenyNosnik) {
		nepodporovane.push(
			'Zosilnený nosník — per-systém varianta (šírka − 2×noha) je O2, presné pravidlo O3. Výstuha horná (massive = šírka − 280) je vo vypocitane a odzrkadľuje zvolený profil (140×140=18017 / 200×140=18022 z katalógu); Robust (šírka − 220) je zatiaľ len informatívny.'
		);
	}
	// #206 (c): Robust varianty výstuhy (110×110 / 110×250) — presné dĺžky nad −220 pravidlo
	// nie sú potvrdené → honest-null. Massive 200×140 mení LEN svetlosť (−60, potvrdené).
	if (v.vystuhaProfil === '110x110' || v.vystuhaProfil === '110x250') {
		nepodporovane.push(
			`Výstuha Robust ${v.vystuhaProfil} — skovaná 15 mm v žľabe (ako nohy). Presná dĺžka rezu nad potvrdené pravidlo (šírka − 220) nie je overená → čestný null (#198). Kód: ${v.vystuhaProfil === '110x250' ? KOD_VYSTUHA_250x110 + ' (Profil 250x110)' : SYSTEMY.Robust.stlp.kod + ' (Profil 110x110 V2)'}.`
		);
	}
	// #206 (a): jednoduchá pergola bez zasklenia → bočné 110×43 vypnuté (evidencia vo výstupe)
	if (v.jednoduchaBezZasklenia) {
		nepodporovane.push(
			'Jednoduchá pergola bez zasklenia (#206 a): bočné profily 110×43 (2 pod fixom + 2 pod kotviacim/u steny, spolu 4) sú VYPNUTÉ — v materiáli sa nepočítajú.'
		);
	}

	return {
		vypocitane,
		informativne: {
			prednaSvetlost: v.prednaSvetlost,
			efektivnaSvetlost: svetlost,
			prednaNohaDlzka,
			zadnaNohaDlzka,
			vystuhaRezMm: R1(v.sirka - VYSTUHA_ODPOCET),
			pocetPriecok: priecky,
			rozostupPrednychNoh: rozostup,
			vystuhaProfil: v.vystuhaProfil ?? null
		},
		nepodporovane
	};
}

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
	/** dĺžka rezu prednej nohy [mm] = svetlosť + 15 (info popisok, nie kreslená výška) */
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
	// #206 (c) — výkres kreslí EFEKTÍVNU svetlosť (pri 200×140 zníženú o 60), aby predná výška
	// aj kóta sedeli s materiálom (noha = efektívna svetlosť + 15). Pri štandarde = zadaná.
	const svetlost = efektivnaSvetlost(v);

	return {
		sirka: v.sirka,
		hlbka: v.hlbka,
		profilRozmer: sys.stlp.rozmer,
		prednaSvetlost: svetlost,
		prednaNohaDlzka: R1(svetlost + PREDNA_NOHA_PRIDAVOK),
		zlabHrubka: sys.stlp.rozmer,
		prednaNohyX: rovnomerneX(v.pocetPrednychNoh, v.sirka),
		rozostupPrednychNoh: v.pocetPrednychNoh > 1 ? R1(v.sirka / (v.pocetPrednychNoh - 1)) : null,
		zadnaKonstrukcia: samostatne
			? {
					typ: 'samostatne',
					// #205: dĺžka nohy = plná ZV (výkres OP260282), nezávisí od hornyProfilZadnej
					nohyX: rovnomerneX(v.pocetZadnychNoh, v.sirka),
					nohaDlzka: R1(v.vyskaZadna),
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

// --- #195: vrstva KUSOVÝCH komponentov (spojky, krytky, rámové/zakladacie lišty) --------
// Doteraz nárez emitoval LEN metrážové profily; kusové komponenty (spojky, krytky) z
// reálnych výkresov chýbali. Zdroj = TYPY vyčítané z callu 13.8. (scr_014/015 Massive
// „KOMPONENTY Pergola 140"; scr_042 Robust „KOMPONENTY Pergola 110"/expedícia) + výkres
// OP260282. Dominik sľúbil kompletné tabuľky spojok/krytiek (počty+kódy), ZATIAĽ nedodané —
// user (16.8., komentár na #195) rozhodol „len mi stačia tie typy": implementovať TERAZ
// z dostupných TYPOV, počty/kódy sa doplnia keď tabuľky prídu.
//
// SAMOSTATNÁ funkcia (nie súčasť NarezVysledok) — golden `pergola-narez-op260282` a
// `spocitajNarez` ostávajú bit-identické. Display-only: žiadny Money zápis (guard
// pergola-narez-money-safety.test.ts pokrýva tento súbor).
//
// HONEST-NULL DISCIPLÍNA (Money-priľahlá, rovnaká ako pre profily vyššie):
//  • POČET: iba keď ho odvodí POTVRDENÉ pravidlo. Žiadne pravidlo počtu komponentov
//    zatiaľ nie je (Dominik ich neklasifikoval) → `pocetKs = null` („—") pre VŠETKY typy.
//    Jednorazové pozorovanie z JEDNÉHO výkresu (spojka U 12 ks, rámová lišta 2 ks na
//    OP260282) NIE JE pravidlo → ostáva v `poznamka`, NIKDY v stĺpci počet.
//  • MONEY KÓD: iba potvrdený ZASK* z Money katalógu (#197/#E). Kódy 24xxx sú CAD kódy
//    zo Solid Edge tabuľky, NEoverené proti Money → `kodMoney` sa NEZAVÁDZA (do odpisu
//    nič nejde). `kodCad` je len informatívny; nečitateľná číslica (2400?) sa NIKDY
//    nedopĺňa → `kodCad = null` + poznámka.
//  • SYSTÉM: evidence-strict — typ patrí systému, kde je doložený zo zdroja.

/** Jeden TYP kusového komponentu pergoly (spojka, krytka, rámová/zakladacia lišta). */
export interface PergolaKomponent {
	/** názov typu (vyčistený z OCR zo zdrojovej snímky) */
	typ: string;
	/** kde sa v pergole používa (plain Slovak) */
	kdePouzity: string;
	/** systémy, kde je typ doložený zo zdroja (evidence-strict, nie odhadom) */
	systemy: PergolaSystem[];
	/** CAD kód zo Solid Edge tabuľky — NIE potvrdený Money kód (ZASK*). null keď žiadny
	 *  alebo na snímke nečitateľný (číslica sa nedopĺňa). */
	kodCad: string | null;
	/** citácia zdroja (snímka callu / výkres) */
	zdroj: string;
	/** počet ks: null = neodvoditeľný z POTVRDENÉHO pravidla (honest-null). Zatiaľ vždy
	 *  null — pravidlo počtu komponentov neexistuje (čaká na Dominikove tabuľky). */
	pocetKs: number | null;
	/** voliteľná poznámka (napr. jednorazovo pozorovaný počet, nečitateľný CAD kód) */
	poznamka?: string;
}

/** Statický katalóg TYPOV kusových komponentov, vyčítaných zo zdrojov (#195). Počty sú
 *  honest-null (žiadne pravidlo); Money kódy sa neasertujú (žiaden potvrdený ZASK*). */
export const PERGOLA_KOMPONENTY: PergolaKomponent[] = [
	// --- Massive 140 („KOMPONENTY Pergola 140", scr_014/015 + OP260282) -----------------
	{
		typ: 'Spojka U 100×50 (140×140)',
		kdePouzity: 'spojka výstuhy (nosníka) 140×140 s nohami',
		systemy: ['Massive'],
		kodCad: null,
		zdroj: 'scr_015 (čitateľné) / scr_014, výkres OP260282',
		pocetKs: null,
		poznamka:
			'na výkrese OP260282 12 ks (Massive, samostatne stojaca) — jednorazové pozorovanie, NIE potvrdené pravidlo počtu'
	},
	{
		typ: 'Profil rámová lišta',
		kdePouzity: 'rámová lišta (obvod rámu strechy)',
		systemy: ['Massive'],
		kodCad: '24007',
		zdroj: 'scr_014 (KOMPONENTY Pergola 140)',
		pocetKs: null,
		poznamka:
			'na výkrese OP260282 2 ks — jednorazové pozorovanie, nie pravidlo. CAD kód 24007 je informatívny (NIE Money kód).'
	},
	{
		typ: 'Krytka maskovacej lišty',
		kdePouzity: 'krytka maskovacej lišty',
		systemy: ['Massive'],
		kodCad: '24003',
		zdroj: 'scr_014 (KOMPONENTY Pergola 140)',
		pocetKs: null,
		poznamka: 'CAD kód 24003 je informatívny (NIE Money kód)'
	},
	{
		typ: 'Krytka maskovacej lišty krajová',
		kdePouzity: 'krytka krajovej maskovacej lišty',
		systemy: ['Massive'],
		kodCad: '24003',
		zdroj: 'scr_014 (KOMPONENTY Pergola 140)',
		pocetKs: null,
		poznamka: 'CAD kód 24003 je informatívny (NIE Money kód)'
	},
	{
		typ: 'Krytka zadná roh',
		kdePouzity: 'krytka zadného rohu',
		systemy: ['Massive'],
		kodCad: null,
		zdroj: 'scr_014 (KOMPONENTY Pergola 140)',
		pocetKs: null,
		poznamka: 'CAD kód 2400? — posledná číslica na snímke nečitateľná, nedopĺňa sa'
	},
	// --- Robust 110 („KOMPONENTY Pergola 110" / expedícia, scr_042) ---------------------
	// (Robust profily — kotviaci, 110×110, žľabový 110, priečkový, prítlačná/maskovacie —
	// už emituje engine ako profily; sem patria LEN kusové komponenty navyše.)
	{
		typ: 'Zakladacia lišta',
		kdePouzity: 'zakladacia lišta (spodné uloženie zasklenia)',
		systemy: ['Robust'],
		kodCad: null,
		zdroj: 'scr_042 (KOMPONENTY Pergola 110 / expedícia)',
		pocetKs: null
	},
	{
		typ: 'Krytka vrchná',
		kdePouzity: 'vrchná krytka (nohy/profilu)',
		systemy: ['Robust'],
		kodCad: null,
		zdroj: 'scr_042 (KOMPONENTY Pergola 110 / expedícia)',
		pocetKs: null
	}
];

/** Kusové komponenty (spojky, krytky, rámové/zakladacie lišty) relevantné pre systém
 *  zvolený vo vstupe. DISPLAY-ONLY: počty honest-null (žiadne potvrdené pravidlo), žiadny
 *  Money kód sa neasertuje. Filtruje katalóg podľa `v.system` — evidence-strict systémová
 *  príslušnosť (typ sa zobrazí len pre systém, kde je doložený zo zdroja). */
export function komponentyPergoly(v: PergolaNarezVstup): PergolaKomponent[] {
	return PERGOLA_KOMPONENTY.filter((k) => k.systemy.includes(v.system));
}
