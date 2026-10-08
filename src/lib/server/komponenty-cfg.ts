// Kovanie a tesnenia — tabuľky od Dominika (2026-07-28, „KOMPONENTY RS ROBUST" /
// „KOMPONENTY RS SLIDE" + jeho odpovede na 6 otázok v ten istý deň; #353 2026-08-31
// aktualizovalo SLIDE zoznam podľa att 14667 — zámok ZASK20254 zrušený, nahradený RAL
// variantmi ZASK202538/ZASK202537, zvyšok tabuľky nezmenený).
//
// MONEY-KRITICKÉ. Robustné položky majú overenú skladovú zásobu na sklade „Materiál"
// (read-only SQL, 2026-07-28/31). #357 (2026-08-31): denný snapshot potvrdzuje sklad
// pre 9/11 Slide kódov — Slide je preto ZAPNUTÝ (`SLIDE_PRIPRAVENY = true`); zvyšné 2
// kódy s 0 ks sú vynechané z `KOMPONENTY_SLIDE`, viď komentár pri poli a pri flagu.
//
// Počty NEODVODZUJ z iného systému — Robust a Slide majú vlastné kódy aj vlastné
// pravidlá (Slide napr. nemá zvlášť rohovník krídla).
import type { Komponent, Farba } from '$lib/komponenty';

/**
 * RODINA kovania (#604) — KTORÁ tabuľka komponentov patrí systému. Dispatch ide cez
 * túto mapu, nie cez porovnanie presného reťazca: `Štandard +` je TEN ISTÝ systém
 * RS STANDARD ako starý `Štandard` (líšia sa len profily/rozmery; Odoo/Money katalóg
 * žiadne „PLUS" kovanie nemá), takže patrí do rodiny `Štandard` a dostane
 * KOMPONENTY_STANDARD aj s počtami zámkov, kotvou uzáveru (`KOD_UZAVERU` v kovanie.ts)
 * a honest-null hláškou (`KOVANIE_NEUPLNE`). Rodinou (nie systémom) sa kľúčujú VŠETKY
 * tabuľky kovania: komponenty, `KOD_UZAVERU`, `KOVANIE_NEUPLNE`, `PREDVOLENA_FARBA`,
 * `POPIS_FARBY`; len `konstPreStyl` počty (`ZAMKY_*`) nesú plný `sysStyl`.
 *
 * Pred #604 `komponentyPre` vracal STANDARD len pre reťazec `'Štandard'` → odpis
 * Štandard + (65 ostrých posuvov od 1.9.2026) nemal kladky, zámok ani kefu (Odoo
 * úloha 1261, Patrik: „štandard neobsahuje kefy, zamykáč a kladku").
 */
export type RodinaKovania = 'Robust' | 'Slide' | 'Štandard' | 'Deluxe';

const RODINA_KOVANIA: Readonly<Record<string, RodinaKovania>> = {
	Robust: 'Robust',
	Slide: 'Slide',
	Štandard: 'Štandard',
	'Štandard +': 'Štandard',
	Deluxe: 'Deluxe'
};

/**
 * Systémy VÝSLOVNE bez kovania v odpise — každý s dôvodom (#604). Systém, ktorý nie je
 * ani v `RODINA_KOVANIA`, ani tu, je NEZARADENÝ: `kovanieDoOdpisu` ho odmietne HLASNOU
 * chybou (nikdy tichý odpis bez kladiek/zámkov — presne trieda chyby #604) a test nad
 * `cfg_seed` (tests/kovanie-rodina.test.ts) padne, keď pribudne systém bez zaradenia.
 */
export const SYSTEMY_BEZ_KOVANIA: Readonly<Record<string, string>> = {
	'Štandard Drevo':
		'Drevostavby (#445) — kovanie do odpisu pre ne nikto nezadal; #604 ho zámerne nemení (rozhodnutie v návrhu: Drevo bez zmeny).'
};

/** Rodina kovania systému, alebo `undefined` keď do žiadnej nepatrí. */
export function rodinaKovania(system: string): RodinaKovania | undefined {
	return Object.hasOwn(RODINA_KOVANIA, system) ? RODINA_KOVANIA[system] : undefined;
}

/** Systém je ZARADENÝ: má rodinu kovania, alebo je výslovne bez kovania (#604). */
export function kovanieZaradene(system: string): boolean {
	return rodinaKovania(system) !== undefined || Object.hasOwn(SYSTEMY_BEZ_KOVANIA, system);
}

/** Všetky systémy danej rodiny (napr. `Štandard` → `Štandard`, `Štandard +`). */
export function systemyRodiny(rodina: RodinaKovania): string[] {
	return Object.keys(RODINA_KOVANIA).filter((s) => RODINA_KOVANIA[s] === rodina);
}

/** Uzáver Robust: jednoduchý systém 2 ks, opona 3 ks (Dominik: 4K-2, 2x3K-3, 2x4K-3). */
const UZAVERY_ROBUST = {
	'Robust|2K': 2,
	'Robust|3K': 2,
	'Robust|4K': 2,
	'Robust|2x2K': 3,
	'Robust|2x3K': 3,
	'Robust|2x4K': 3
};

/** Automatický zámok Slide — rovnaký vzor ako uzáver Robust; od #353 farebne
 *  rozdelený na RAL varianty (ZASK202538 R7016 / ZASK202537 R9005), počty nezmenené.
 *  #357: ZASK202537 (R9005) je od 0 ks skladu VYNECHANÝ z `KOMPONENTY_SLIDE` — tento
 *  počtový vzor (`konstPreStyl`) ostáva platný pre oba varianty, keď sa R9005 vráti. */
const ZAMKY_SLIDE = {
	'Slide|2K': 2,
	'Slide|3K': 2,
	'Slide|2x2K': 3,
	'Slide|2x3K': 3
};

/** Zasklievacie tesnenie 10 vs 12 sa nedá určiť dopredu — Dominik ho dal zámerne 50/50
 *  (závisí od zlepenia skla a tolerancie profilov; pri 24 mm skle raz 10, raz 12, raz
 *  kombinácia). Preto každý kód dostane polovicu dĺžky rámového profilu.
 *
 *  #353: Dominikov nový zoznam pre Slide (att 14667) opisuje výber „podľa hrúbky
 *  skla", čo je v rozpore s vyššie citovanou zdrojovanou odpoveďou (24 mm sklo dáva
 *  OBA výsledky) — Excel k tomu sám nedáva vzorec/prah (obe riadky majú identický
 *  text). Zdieľaný 50/50 vzorec preto ostáva NEZMENENÝ aj pre Slide (rovnaký ako
 *  Robust); zapísané ako finding na #353, nie tichá voľba. */
const TESNENIE_ZASKLIEVACIE: Komponent[] = [
	{
		kod: 'ZASK20242',
		nazov: 'Tesnenie zasklievacie 12',
		mj: 'm',
		pravidlo: { typ: 'dlzkaProfilu', role: 'ramovy', koef: 0.5 }
	},
	{
		kod: 'ZASK20241',
		nazov: 'Tesnenie zasklievacie 10',
		mj: 'm',
		pravidlo: { typ: 'dlzkaProfilu', role: 'ramovy', koef: 0.5 }
	}
];

export const KOMPONENTY_ROBUST: Komponent[] = [
	{ kod: 'ZASK00027', nazov: 'Kladka RS ROBUST', mj: 'ks', pravidlo: { typ: 'naKridlo', koef: 2 } },
	{
		kod: 'ZASK00029',
		nazov: 'Uzáver RS ROBSUT',
		mj: 'ks',
		pravidlo: { typ: 'konstPreStyl', ks: UZAVERY_ROBUST }
	},
	// kľučka: „obojstranne 2ks jednostranne 1ks na posledné krídla v krajoch, opona je
	// ďalšie +1 krídlo" — tie krajné krídla sú tie isté, na ktoré ide uzáver.
	// #338 (31.8.): pôvodná ZASK00030 „Kľučka" ZRUŠENÁ (0 sklad), nahradená RAL
	// variantami R9005/R7016 — do odpisu ide len variant zvolenej farby kovania.
	{
		kod: 'ZASK202533',
		nazov: 'Kľučka R9005',
		mj: 'ks',
		farba: 'R9005',
		pravidlo: { typ: 'naUzaverPodlaFab' }
	},
	{
		kod: 'ZASK202534',
		nazov: 'Kľučka R7016',
		mj: 'ks',
		farba: 'R7016',
		pravidlo: { typ: 'naUzaverPodlaFab' }
	},
	{ kod: 'ZASK00031', nazov: 'Podložka uzáveru', mj: 'ks', pravidlo: { typ: 'naUzaver', koef: 5 } },
	// POZOR: prvá verzia tabuľky mala 5 ks (copy-paste z podložky) — Dominik opravil na 2
	{ kod: 'ZASK00032', nazov: 'Protikus uzáveru', mj: 'ks', pravidlo: { typ: 'naUzaver', koef: 2 } },
	{
		kod: 'ZASK00033',
		nazov: 'Protikus uzáveru podložka',
		mj: 'ks',
		pravidlo: { typ: 'naUzaver', koef: 2 }
	},
	// #338: ZASK00034 „Upevňovacia sada" ZRUŠENÁ bez náhrady (0 sklad) — odstránená.
	// #338: ZASK00035 „Krytka vložky" ZRUŠENÁ (0 sklad) → RAL varianty R9005/R7016.
	{
		kod: 'ZASK202535',
		nazov: 'Krytka vložky R9005',
		mj: 'ks',
		farba: 'R9005',
		pravidlo: { typ: 'naUzaverPodlaFab' }
	},
	{
		kod: 'ZASK202536',
		nazov: 'Krytka vložky R7016',
		mj: 'ks',
		farba: 'R7016',
		pravidlo: { typ: 'naUzaverPodlaFab' }
	},
	{
		kod: 'ZASK00036',
		nazov: 'Krytka krídla',
		mj: 'ks',
		pravidlo: { typ: 'naNosovyProfil', koef: 2 }
	},
	{
		kod: 'ZASK00037',
		nazov: 'Rohovník obvodový',
		mj: 'ks',
		// podľa KOĽAJNICE, nie podľa štýlu — opona 2x3K jazdí po tej istej 3K koľajnici
		pravidlo: { typ: 'konstPreKolajnicu', ks: { '2K': 8, '3K': 12, '4K': 12 } }
	},
	{ kod: 'ZASK00038', nazov: 'Rohovník krídla', mj: 'ks', pravidlo: { typ: 'naKridlo', koef: 4 } },
	{
		kod: 'ZASK00039',
		nazov: 'Rohovník zarovnávací',
		mj: 'ks',
		pravidlo: { typ: 'naKridlo', koef: 8 }
	},
	...TESNENIE_ZASKLIEVACIE,
	{
		kod: 'ZASK00041',
		nazov: 'Kefové tesnenie 7x,3,5',
		mj: 'm',
		// súčet dĺžok nosového profilu, pri opone + 2× oponový profil
		pravidlo: { typ: 'dlzkaNosovehoSOponou', koef: 1 }
	},
	{
		kod: 'ZASK00042',
		nazov: 'Kefové tesnenie 7x5,00',
		mj: 'm',
		pravidlo: { typ: 'dlzkaRozdiel', koef: 2 }
	}
];

export const KOMPONENTY_SLIDE: Komponent[] = [
	{ kod: 'ZASK20253', nazov: 'Kladka RS SLIDE', mj: 'ks', pravidlo: { typ: 'naKridlo', koef: 2 } },
	// #353 (att 14667): pôvodná ZASK20254 „Automaticky zamok RS SLIDE" ZRUŠENÁ,
	// nahradená RAL variantami R9005/R7016 — rovnaký vzor ako Robust kľučka a
	// Standard zámok (#338). Počet (konstPreStyl → ZAMKY_SLIDE) NEZMENENÝ.
	//
	// #357: ZASK202537 (R9005 variant) MÁ 0 ks skladovej zásoby (overené proti
	// dennému snapshotu 2026-08-31T14:45Z) — ZÁMERNE VYNECHANÝ, kým nedostane
	// sklad (rovnaký vzor ako #354 Deluxe 6mm krytky). R9005-farebné objednávky
	// preto zámok do odpisu nedostanú — pozri KOVANIE_NEUPLNE.Slide nižšie.
	{
		kod: 'ZASK202538',
		nazov: 'Automaticky zamok RS SLIDE R7016',
		mj: 'ks',
		farba: 'R7016',
		pravidlo: { typ: 'konstPreStyl', ks: ZAMKY_SLIDE }
	},
	{ kod: 'ZASK20255', nazov: 'Protikus zamku', mj: 'ks', pravidlo: { typ: 'naUzaver', koef: 1 } },
	// #357: ZASK20258 „Madlo 200" MÁ 0 ks skladovej zásoby (overené proti dennému
	// snapshotu 2026-08-31T14:45Z) a je MANDATÓRNA položka (naUzaver, bez farba
	// filtra — počíta sa na KAŽDÚ platnú Slide objednávku bez ohľadu na farbu).
	// ZÁMERNE VYNECHANÁ, kým nedostane sklad — pozri KOVANIE_NEUPLNE.Slide nižšie.
	{
		kod: 'ZASK20256',
		nazov: 'Krytka ramoveho profilu',
		mj: 'ks',
		pravidlo: { typ: 'naNosovyProfil', koef: 2 }
	},
	{
		kod: 'ZASK20257',
		nazov: 'Rohovnik zarovnavaci',
		mj: 'ks',
		pravidlo: { typ: 'naKridlo', koef: 8 }
	},
	// Slide NEMÁ zvlášť rohovník krídla — `ZASK00037` je jeden kód na obvod AJ na krídla
	// (Dominik: „len rohovník obvodový pre všetko, aj pre koľajnicu aj pre krídlo").
	// Dva riadky sa v `pocitajKomponenty` zlúčia do jedného riadku odpisu.
	{
		kod: 'ZASK00037',
		nazov: 'Rohovník obvodový',
		mj: 'ks',
		pravidlo: { typ: 'konstPreKolajnicu', ks: { '2K': 8, '3K': 8 } }
	},
	{
		kod: 'ZASK00037',
		nazov: 'Rohovník obvodový',
		mj: 'ks',
		pravidlo: { typ: 'naKridlo', koef: 4 }
	},
	...TESNENIE_ZASKLIEVACIE,
	{
		kod: 'ZASK20259',
		nazov: 'Kefové tesnenie 5x8',
		mj: 'm',
		pravidlo: { typ: 'dlzkaRozdiel', koef: 2 }
	}
];

/**
 * Slide kovanie IDE do Money (#357, 2026-08-31) — denný snapshot (2026-08-31T14:45Z)
 * potvrdzuje skladovú zásobu pre 9/11 kódov v `KOMPONENTY_SLIDE`. Zvyšné 2 kódy
 * (ZASK202537 zámok R9005, ZASK20258 Madlo 200) MAJÚ 0 ks — sú preto ZÁMERNE
 * VYNECHANÉ z `KOMPONENTY_SLIDE` vyššie (rovnaký vzor ako #354 Deluxe 6mm krytky:
 * odpis je skladový pohyb, bez zásoby by naviezol špinu), nie ticho preskočené.
 * Operátor dostane upozornenie cez `KOVANIE_NEUPLNE.Slide` nižšie a doplní ich
 * ručne, kým Dominik nenaskladní; keď dostanú sklad, vrátiť ich do zoznamu a
 * zoštíhliť/odstrániť KOVANIE_NEUPLNE.Slide.
 */
export const SLIDE_PRIPRAVENY = true;

/**
 * Automatický zámok Štandard — „1ks na koncové okno" (#338, Dominik 31.8.). Tabuľka
 * NEVYPÍSALA per-štýl počty; zrkadlíme overený vzor „1ks na krajné/koncové krídlo"
 * z Robust uzáveru a Slide zámku (jednoduchý posuv = 2 koncové krídla, opona = 3).
 * IZO variant má rovnaký počet zámkov (IZO je o skle, nie o zámkoch). Zdieľané oboma
 * RAL variantmi zámku (protikus/podložky čerpajú z toho istého čísla). POČTY NA
 * POTVRDENIE Dominikom.
 *
 * #604: platí pre CELÚ rodinu Štandard (`systemyRodiny('Štandard')` = Štandard aj
 * Štandard +) — kľúč `konstPreStyl` je plný `sysStyl`, preto sa generuje per systém.
 * 5K/6K má len Štandard + — rovnaké pravidlo (jednoduchý posuv = 2 koncové krídla),
 * žiadny nový odhad. Štýl mimo tabuľky (napr. budúci 7K) ostáva HLASNÁ chyba.
 */
const ZAMKY_NA_STYL_STANDARD: Readonly<Record<string, number>> = {
	'2K': 2,
	'3K': 2,
	'4K': 2,
	'5K': 2,
	'6K': 2,
	'2x2K': 3,
	'2x3K': 3,
	'2x4K': 3
};
const ZAMKY_STANDARD: Record<string, number> = {};
for (const system of systemyRodiny('Štandard'))
	for (const [styl, ks] of Object.entries(ZAMKY_NA_STYL_STANDARD)) {
		ZAMKY_STANDARD[`${system}|${styl}`] = ks;
		ZAMKY_STANDARD[`${system}|${styl} IZO`] = ks;
	}

/**
 * Komponenty RS STANDARD (#338, Dominik 31.8.). Overené proti OSTRÉMU Money (31.8.):
 * všetky kódy existujú, `Deleted=0`, majú skladovú zásobu — preto je Štandard
 * zapnutý (na rozdiel od Slide). Automatický zámok má RAL varianty R9005/R7016 —
 * do odpisu ide len variant zvolenej farby kovania. #604: tabuľka celej RODINY
 * Štandard — starý Štandard AJ Štandard + (ten istý RS STANDARD, katalóg nemá
 * samostatné „PLUS" kódy; kladkový profil Štandard + má dĺžku, takže kefa je nenulová).
 *
 * ČIASTOČNE NEÚPLNÉ: zasklievacie tesnenia (ZASK00005/ZASK00006) počíta tesnenie.ts
 * a pridáva do odpisu podľa skla (4mm→00005, 6mm→00006, IZO→žiadne; #342 round 2).
 * Kefa ZASK00007 (4,8×4) je tu — rovnaká formula ako Deluxe (kladkový×2, Dominik
 * 8.9.: „kefy ostávajú všade rovnako podľa výpočtu"). ZASK202541 (4,8×5) ZATIAĽ
 * NIE JE — neznáma rola profilu v STANDARD kontexte (STANDARD nemá klzný profil).
 */
export const KOMPONENTY_STANDARD: Komponent[] = [
	{ kod: 'ZASK00002', nazov: 'Kladka dvojitá', mj: 'ks', pravidlo: { typ: 'naKridlo', koef: 2 } },
	{ kod: 'ZASK20252', nazov: 'Protikus zamku', mj: 'ks', pravidlo: { typ: 'naUzaver', koef: 1 } },
	{
		kod: 'ZASK202531',
		nazov: 'Automaticky zamok R9005',
		mj: 'ks',
		farba: 'R9005',
		pravidlo: { typ: 'konstPreStyl', ks: ZAMKY_STANDARD }
	},
	{
		kod: 'ZASK202532',
		nazov: 'Automaticky zamok R7016',
		mj: 'ks',
		farba: 'R7016',
		pravidlo: { typ: 'konstPreStyl', ks: ZAMKY_STANDARD }
	},
	// Tesniaca kefa 4,8×4 — Dominik 8.9.2026 (msg 1807247): „kefy ostávajú všade
	// rovnako podľa výpočtu". Rovnaká formula ako Deluxe (kladkový profil × 2).
	// STANDARD má kladkový profil ZASP202415, takže dlzkaKladkovehoMm je nenulové.
	{
		kod: 'ZASK00007',
		nazov: 'Tesniaca kefa 4,8×4 mm',
		mj: 'm',
		pravidlo: { typ: 'dlzkaProfilu', role: 'kladkovy', koef: 2 }
	}
	// ZASK202541 (Tesniaca kefa 4,8×5 mm) — HONEST-NULL. Kód je INÝ než Deluxe
	// ZASK202542 a STANDARD nemá klzný profil. Bez potvrdenia od Dominika, KTORÁ rola
	// profilu mapuje na 202541, sa nedá pridať do odpisu (netipovať Money).
];

/**
 * Komponenty BS DELUXE (#354, Dominik — Odoo kanál 207, msg 1767527/att 14668
 * „KOMPONENTY BS DELUXE.xlsx" + náčrt umiestnenia msg 1767528/att 14670). Overené
 * ŽIVO proti ostrému Money (read-only SQL, 31.8.2026): všetkých 15 kódov existuje,
 * `Deleted=0`, názvy sedia s Dominikovou tabuľkou.
 *
 * #431 KOLO 2 (Dominik, Odoo úloha 574, 11.9.2026 „krytky evidovať v RAL" + príloha
 * 15952 = celý 12-kódový katalóg krytiek Delux): 6mm krytky
 * (ZASK202519–202524) sú TERAZ v odpise — evidujú sa podľa RAL (6mm: R9006/R9005,
 * 10mm: R9006/R7016). 0-ks caution z #354 (6mm mali 0 ks skladu 31.8, preto boli
 * dovtedy VYNECHANÉ, rovnaký vzor ako Slide #357) je PREKONANÁ majiteľským
 * rozhodnutím výroby — krytky sa evidujú, obsluha vyberie farbu, odpis pošle
 * zodpovedajúci Money kód. Farba je pole na úrovni objednávky (`farbaKovania`);
 * kovanie (mušľa) ostáva pevne nerezová (RAL voľba je „Farba krytiek", nie kovania).
 * Slide vynechania (#357) sa TENTO tiket NEDOTÝKA.
 *
 * Krajná/stredová L-P počítacia formula (`konst`/`naStyk`) je odvodená z existujúcej
 * `cfg_seed` geometrie (Dorazový profil `pocetKs=2` na KAŽDOM Deluxe štýle vrátane
 * opony; Kladkový aj Klzný profil `pocetKs=N`) — plné odvodenie v design komentári.
 * 6mm používa ROVNAKÉ pravidlá ako 10mm (líši sa len hrúbka + farebná dvojica).
 */
export const KOMPONENTY_DELUXE: Komponent[] = [
	// 6mm krytky — RAL R9006 / R9005 (#431 kolo 2). Rovnaké pravidlá ako 10mm nižšie.
	{
		kod: 'ZASK202519',
		nazov: 'Krytka stredová L 6 mm R9006',
		mj: 'ks',
		hrubkaSkla: 6,
		farba: 'R9006',
		pravidlo: { typ: 'naStyk', koef: 1 }
	},
	{
		kod: 'ZASK202520',
		nazov: 'Krytka stredová L 6 mm R9005',
		mj: 'ks',
		hrubkaSkla: 6,
		farba: 'R9005',
		pravidlo: { typ: 'naStyk', koef: 1 }
	},
	{
		kod: 'ZASK202521',
		nazov: 'Krytka stredová P 6 mm R9006',
		mj: 'ks',
		hrubkaSkla: 6,
		farba: 'R9006',
		pravidlo: { typ: 'naStyk', koef: 1 }
	},
	{
		kod: 'ZASK202522',
		nazov: 'Krytka stredová P 6 mm R9005',
		mj: 'ks',
		hrubkaSkla: 6,
		farba: 'R9005',
		pravidlo: { typ: 'naStyk', koef: 1 }
	},
	{
		kod: 'ZASK202523',
		nazov: 'Krytka krajná 6 mm R9006',
		mj: 'ks',
		hrubkaSkla: 6,
		farba: 'R9006',
		pravidlo: { typ: 'konst', ks: 2 }
	},
	{
		kod: 'ZASK202524',
		nazov: 'Krytka krajná 6 mm R9005',
		mj: 'ks',
		hrubkaSkla: 6,
		farba: 'R9005',
		pravidlo: { typ: 'konst', ks: 2 }
	},
	// 10mm krytky — RAL R9006 / R7016.
	{
		kod: 'ZASK202525',
		nazov: 'Krytka stredová L 10 mm R9006',
		mj: 'ks',
		hrubkaSkla: 10,
		farba: 'R9006',
		pravidlo: { typ: 'naStyk', koef: 1 }
	},
	{
		kod: 'ZASK202526',
		nazov: 'Krytka stredová L 10 mm R7016',
		mj: 'ks',
		hrubkaSkla: 10,
		farba: 'R7016',
		pravidlo: { typ: 'naStyk', koef: 1 }
	},
	{
		kod: 'ZASK202527',
		nazov: 'Krytka stredová P 10 mm R9006',
		mj: 'ks',
		hrubkaSkla: 10,
		farba: 'R9006',
		pravidlo: { typ: 'naStyk', koef: 1 }
	},
	{
		kod: 'ZASK202528',
		nazov: 'Krytka stredová P 10 mm R7016',
		mj: 'ks',
		hrubkaSkla: 10,
		farba: 'R7016',
		pravidlo: { typ: 'naStyk', koef: 1 }
	},
	{
		kod: 'ZASK202529',
		nazov: 'Krytka krajná 10 mm R9006',
		mj: 'ks',
		hrubkaSkla: 10,
		farba: 'R9006',
		pravidlo: { typ: 'konst', ks: 2 }
	},
	{
		kod: 'ZASK202530',
		nazov: 'Krytka krajná 10 mm R7016',
		mj: 'ks',
		hrubkaSkla: 10,
		farba: 'R7016',
		pravidlo: { typ: 'konst', ks: 2 }
	},
	// Madlo D56 — 2 ks na posuv, vždy krajné krídlo (Dominik): hrúbko/farbo-neutrálne.
	{ kod: 'ZASK00049', nazov: 'Madlo D56', mj: 'ks', pravidlo: { typ: 'konst', ks: 2 } },
	// Tesniace kefy — súčet dĺžok kladkového/klzného profilu × 2 (m): hrúbko/farbo-neutrálne.
	{
		kod: 'ZASK00007',
		nazov: 'Tesniaca kefa 4,8×4 mm',
		mj: 'm',
		pravidlo: { typ: 'dlzkaProfilu', role: 'kladkovy', koef: 2 }
	},
	{
		kod: 'ZASK202542',
		nazov: 'Tesniaca kefa 4,8×7 mm',
		mj: 'm',
		pravidlo: { typ: 'dlzkaProfilu', role: 'klzny', koef: 2 }
	}
];

/**
 * Rodiny kovania, ktorých kovanie do odpisu je NEÚPLNÉ (chýbajú tesnenia/kefy) a náhľad
 * na to musí upozorniť (#338). Prázdne = kompletné. Kľúč je RODINA (#604) — hláška
 * `Štandard` platí aj pre Štandard + (ZASK202541 honest-null tam rovnako).
 *
 * Hodnota je buď PEVNÝ text (Štandard: neúplné VŽDY, nezávisle od vstupu), alebo
 * FUNKCIA `(skloHrubka, farbaKovania) => text | null` (Slide, #357: neúplné VŽDY kvôli
 * madlu, PLUS zámok pri R9005 — druhý parameter `farbaKovania`). Deluxe už tu NIE JE:
 * #431 kolo 2 doplnilo 6mm krytky, takže Deluxe 6mm aj 10mm sú kompletné (predtým
 * #354 mal Deluxe funkciu hlásiacu chýbajúce 6mm krytky pri 0 ks sklade — prekonané).
 */
export const KOVANIE_NEUPLNE: Partial<
	Record<RodinaKovania, string | ((skloHrubka?: number, farbaKovania?: Farba) => string | null)>
> = {
	Štandard:
		'STANDARD: tesniaca kefa ZASK202541 (4,8×5 mm) zatiaľ NIE JE v odpise kovania — neznáma rola profilu, doplniť ručne.',
	// #431 kolo 2: Deluxe už NEMÁ neúplné kovanie — 6mm krytky (ZASK202519–524) sú
	// teraz v odpise (predtým 0 ks caution #354). Deluxe 6mm aj 10mm sú kompletné
	// (krytky + madlo + kefy), preto tu Deluxe kľúč ZÁMERNE NIE JE (kovanie.ts znesie
	// chýbajúci kľúč — `KOVANIE_NEUPLNE[rodina]` je undefined = žiadne varovanie).
	// #357: madlo 200 chýba VŽDY (mandatórna položka, 0 ks); automatický zámok chýba
	// LEN pri R9005 (R7016 má sklad a odpis dostáva). Bez zvolenej farby (chyba inde
	// vo výpočte, nie tu) sa zobrazí len madlová veta.
	Slide: (_skloHrubka, farbaKovania) =>
		farbaKovania === 'R9005'
			? 'SLIDE: madlo 200 (ZASK20258) a automatický zámok R9005 (ZASK202537) zatiaľ NIE sú v odpise kovania — Money má na nich 0 ks skladovej zásoby (overené 31.8.2026 o 14:45). R7016 zámok (ZASK202538) odpis dostáva. Doplniť ručne, kým nedostanú sklad (#357).'
			: 'SLIDE: madlo 200 (ZASK20258) zatiaľ NIE JE v odpise kovania — Money má na ňom 0 ks skladovej zásoby (overené 31.8.2026 o 14:45). Doplniť ručne, kým nedostane sklad (#357).'
};

/** Systémy s PREDVOLENOU farbou (#431 bod 1/kolo 2, Patrik msg 1801337) — Deluxe:
 *  kovanie je pevne nerezová mušľa (žiadny farebný variant KOVANIA), ale KRYTKY
 *  existujú v RAL variantoch per hrúbka (6mm R9006/R9005, 10mm R9006/R7016), takže
 *  RAL select OSTÁVA viditeľný. `predvolenaFarba` je len PREDVOLBA — operátor ju môže
 *  zmeniť. MUSÍ byť platná na OBOCH hrúbkach krytiek (invariant v komponenty.test.ts),
 *  inak by sa serverový fallback (kovanieFor) zmenil na fail-loud; R9006 to spĺňa.
 *  Defence: ak formulár farbu nepošle, engine použije túto hodnotu. */
export const PREDVOLENA_FARBA: Partial<Record<RodinaKovania, Farba>> = {
	Deluxe: 'R9006'
};

/** Predvolená farba pre systém (podľa jeho RODINY kovania, #604 — variant Deluxe by
 *  zdedil predvoľbu spolu s krytkami), alebo `undefined` keď ju systém nemá. */
export function predvolenaFarba(system: string): Farba | undefined {
	const rodina = rodinaKovania(system);
	return rodina === undefined ? undefined : PREDVOLENA_FARBA[rodina];
}

/**
 * PLATNÉ RAL farby pre daný systém (a hrúbku skla, keď od nej variant závisí) —
 * JEDEN zdroj pravdy pre validitu farby (#537 / gk #6413). Číta sa priamo z
 * `komponentyPre(system)`: farba je platná, ak existuje aspoň jeden farebný
 * komponent s tou `farba` a — ak nesie `hrubkaSkla` — platí pre danú hrúbku
 * (Deluxe krytky: 6mm R9006/R9005, 10mm R9006/R7016). Systém bez farebných
 * komponentov (alebo bez kovania) → prázdne pole = farbo-neutrálny.
 *
 * Žiadna NOVÁ tabuľka — validita je odvodená z tých istých `Komponent` záznamov,
 * z ktorých sa počíta odpis (netvorí sa druhý, rozchádzajúci sa zoznam).
 */
export function platneFarbyPre(system: string, skloHrubka?: number): Farba[] {
	const komponenty = komponentyPre(system);
	if (!komponenty) return [];
	const out = new Set<Farba>();
	for (const k of komponenty) {
		if (k.farba === undefined) continue;
		// hrúbko-viazaný variant (Deluxe krytky) platí len pre svoju hrúbku;
		// hrúbko-neutrálny farebný variant (Robust kľučka, Štandard/Slide zámok) vždy.
		if (k.hrubkaSkla !== undefined && k.hrubkaSkla !== skloHrubka) continue;
		out.add(k.farba);
	}
	return [...out];
}

/** Popis (label) RAL selectu per systém (#431 kolo 2). Deluxe: RAL voľba sa týka
 *  KRYTIEK (kovanie = pevne nerezová mušľa), preto „Farba krytiek", nie „Farba
 *  kovania" (Patrik/Dominik: „farba kovania je len nerezová mušľa"). Systémy tu
 *  neuvedené = default label „Farba kovania" (kľučka/zámok RAL). Config-derived —
 *  žiadny `system==='Deluxe'` v stránke (zasklenia-form-reactivity.md). */
export const POPIS_FARBY: Partial<Record<RodinaKovania, string>> = {
	Deluxe: 'Farba krytiek'
};

/** Popis RAL selectu pre systém (podľa RODINY kovania, #604), alebo `undefined` keď
 *  systém používa default label. */
export function popisFarby(system: string): string | undefined {
	const rodina = rodinaKovania(system);
	return rodina === undefined ? undefined : POPIS_FARBY[rodina];
}

/**
 * Kovanie pre daný systém (podľa jeho RODINY, #604), alebo `null` keď systém kovanie do
 * odpisu nedáva — výslovne (`SYSTEMY_BEZ_KOVANIA`), vypnutou tabuľkou (`*_PRIPRAVENY`),
 * alebo je NEZARADENÝ (to `kovanieDoOdpisu` odmietne hlasnou chybou, `kovanieZaradene`).
 */
export function komponentyPre(system: string): Komponent[] | null {
	const rodina = rodinaKovania(system);
	if (rodina === undefined) return null;
	switch (rodina) {
		case 'Robust':
			return KOMPONENTY_ROBUST;
		case 'Slide':
			return SLIDE_PRIPRAVENY ? KOMPONENTY_SLIDE : null;
		case 'Štandard':
			return KOMPONENTY_STANDARD;
		case 'Deluxe':
			return KOMPONENTY_DELUXE;
	}
}
