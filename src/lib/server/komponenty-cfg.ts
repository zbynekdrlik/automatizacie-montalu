// Kovanie a tesnenia — tabuľky od Dominika (2026-07-28, „KOMPONENTY RS ROBUST" /
// „KOMPONENTY RS SLIDE" + jeho odpovede na 6 otázok v ten istý deň; #353 2026-08-31
// aktualizovalo SLIDE zoznam podľa att 14667 — zámok ZASK20254 zrušený, nahradený RAL
// variantmi ZASK202538/ZASK202537, zvyšok tabuľky nezmenený).
//
// MONEY-KRITICKÉ. Robustné položky majú overenú skladovú zásobu na sklade „Materiál"
// (read-only SQL, 2026-07-28/31). Slide položky (vrátane #353 nových RAL zámkov
// ZASK202538/ZASK202537) NEBOLI naživo overené v tomto worktree (chýba SSH kľúč
// `slovnormal_odoo`, viď #353 finding) — preto Slide OSTÁVA vypnutý (`SLIDE_PRIPRAVENY
// = false`), aby appka neposlala pohyb, ktorý nemá kam sadnúť. Flip až po overení
// proti ostrému Money.
//
// Počty NEODVODZUJ z iného systému — Robust a Slide majú vlastné kódy aj vlastné
// pravidlá (Slide napr. nemá zvlášť rohovník krídla).
import type { Komponent } from '$lib/komponenty';

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
 *  rozdelený na RAL varianty (ZASK202538 R7016 / ZASK202537 R9005), počty nezmenené. */
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
	{
		kod: 'ZASK202538',
		nazov: 'Automaticky zamok RS SLIDE R7016',
		mj: 'ks',
		farba: 'R7016',
		pravidlo: { typ: 'konstPreStyl', ks: ZAMKY_SLIDE }
	},
	{
		kod: 'ZASK202537',
		nazov: 'Automaticky zamok RS SLIDE R9005',
		mj: 'ks',
		farba: 'R9005',
		pravidlo: { typ: 'konstPreStyl', ks: ZAMKY_SLIDE }
	},
	{ kod: 'ZASK20255', nazov: 'Protikus zamku', mj: 'ks', pravidlo: { typ: 'naUzaver', koef: 1 } },
	{ kod: 'ZASK20258', nazov: 'Madlo 200', mj: 'ks', pravidlo: { typ: 'naUzaver', koef: 1 } },
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
 * Slide kovanie sa do Money NEPOSIELA, kým jeho kódy (vrátane #353 nových RAL zámkov
 * ZASK202538/ZASK202537) nemajú v Money potvrdenú skladovú zásobu na sklade „Materiál"
 * (2026-07-28 boli pôvodné kódy len artikly; Dominik ich zakladá). Odpis je skladový
 * pohyb — bez zásoby by import zlyhal alebo naviezol špinu. #353: v tomto worktree sa
 * to nedalo overiť naživo (chýba SSH kľúč `slovnormal_odoo`) — flip na `true` až po
 * overení proti ostrému Money (read-only SQL recept, viď money-odpis skill).
 */
export const SLIDE_PRIPRAVENY = false;

/**
 * Automatický zámok Štandard — „1ks na koncové okno" (#338, Dominik 31.8.). Tabuľka
 * NEVYPÍSALA per-štýl počty; zrkadlíme overený vzor „1ks na krajné/koncové krídlo"
 * z Robust uzáveru a Slide zámku (jednoduchý posuv = 2 koncové krídla, opona = 3).
 * IZO variant má rovnaký počet zámkov (IZO je o skle, nie o zámkoch). Zdieľané oboma
 * RAL variantmi zámku (protikus/podložky čerpajú z toho istého čísla). POČTY NA
 * POTVRDENIE Dominikom.
 */
const ZAMKY_STANDARD: Record<string, number> = {};
for (const [styl, ks] of Object.entries({
	'2K': 2,
	'3K': 2,
	'4K': 2,
	'2x2K': 3,
	'2x3K': 3,
	'2x4K': 3
})) {
	ZAMKY_STANDARD[`Štandard|${styl}`] = ks;
	ZAMKY_STANDARD[`Štandard|${styl} IZO`] = ks;
}

/**
 * Komponenty RS STANDARD (#338, Dominik 31.8.). Overené proti OSTRÉMU Money (31.8.):
 * všetky kódy existujú, `Deleted=0`, majú skladovú zásobu — preto je Štandard
 * zapnutý (na rozdiel od Slide). Automatický zámok má RAL varianty R9005/R7016 —
 * do odpisu ide len variant zvolenej farby kovania.
 *
 * NEÚPLNÉ: zasklievacie tesnenia 4/6mm (ZASK00005/00006) a tesniace kefy
 * (ZASK00007/ZASK202541) tu ZATIAĽ NIE SÚ — chýba jednoznačný vzorec (tesnenia:
 * „šírka+výška prírezov kladkového/koncového/stredového profilu podľa hrúbky skla",
 * potrebuje rezné rozmery + hrúbku/IZO, ktoré `ZakladPoctov` nemá; kefy: „viď
 * obrázok" bez vzorca). Náhľad preto pri Štandarde zobrazí hlášku o neúplnosti a je
 * na to samostatný follow-up ticket. NEPRIDÁVAŤ bez vzorca od Dominika.
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
	}
];

/**
 * Komponenty BS DELUXE (#354, Dominik — Odoo kanál 207, msg 1767527/att 14668
 * „KOMPONENTY BS DELUXE.xlsx" + náčrt umiestnenia msg 1767528/att 14670). Overené
 * ŽIVO proti ostrému Money (read-only SQL, 31.8.2026): všetkých 15 kódov existuje,
 * `Deleted=0`, názvy sedia s Dominikovou tabuľkou.
 *
 * MONEY-KRITICKÉ nález: 6mm krytky (ZASK202519/202520/202521/202522/202523/202524)
 * majú v Money 0 ks na sklade (všetky sklady spolu) — presne tá istá situácia, ktorá
 * viedla k `SLIDE_PRIPRAVENY = false` vyššie („artikel bez zásoby… appka neposlala
 * pohyb, ktorý nemá kam sadnúť"). Preto sú tu zámerne VYNECHANÉ, kým sklad nepríde —
 * design komentár na #354 nesie ich úplnú tabuľku aj Money kódy pre budúce doplnenie
 * (mechanizmus `hrubkaSkla` už existuje, doplnenie = 6 riadkov analogických nižšie).
 *
 * Krajná/stredová L-P počítacia formula (`konst`/`naStyk`) je odvodená z existujúcej
 * `cfg_seed` geometrie (Dorazový profil `pocetKs=2` na KAŽDOM Deluxe štýle vrátane
 * opony; Kladkový aj Klzný profil `pocetKs=N`) — plné odvodenie v design komentári.
 */
export const KOMPONENTY_DELUXE: Komponent[] = [
	// 10mm krytky — RAL R9006 / R7016 (6mm vynechané, viď komentár vyššie).
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
 * Systémy, ktorých kovanie do odpisu je NEÚPLNÉ (chýbajú tesnenia/kefy) a náhľad
 * na to musí upozorniť (#338). Prázdne = kompletné.
 *
 * Hodnota je buď PEVNÝ text (Štandard: neúplné VŽDY, nezávisle od vstupu), alebo
 * FUNKCIA `(skloHrubka) => text | null` (Deluxe: neúplné LEN pri 6mm — #354 review
 * nález 🟡, pôvodná pevná hláška sa zobrazovala aj na 10mm objednávkach, kde je
 * odpis kovania v skutočnosti kompletný a hláška by zmiatla/viedla na zbytočné
 * ručné doplnenie 6mm položiek, ktoré sa 10mm objednávky vôbec netýkajú).
 */
export const KOVANIE_NEUPLNE: Record<string, string | ((skloHrubka?: number) => string | null)> = {
	Štandard:
		'STANDARD: zasklievacie tesnenia (4/6mm) a tesniace kefy zatiaľ NIE sú v odpise kovania — doplniť ručne (čaká sa na vzorec od Dominika).',
	Deluxe: (skloHrubka) =>
		skloHrubka === 6
			? 'DELUXE 6mm: krytky (stredová L/P, krajná) zatiaľ NIE sú v odpise kovania — Money má na nich 0 ks skladovej zásoby (overené 31.8.2026); madlo D56 a tesniace kefy odpis dostávajú. Doplniť, keď 6mm dostane sklad (#354).'
			: null
};

/** Kovanie pre daný systém, alebo `null` keď systém kovanie do odpisu (zatiaľ) nedáva. */
export function komponentyPre(system: string): Komponent[] | null {
	if (system === 'Robust') return KOMPONENTY_ROBUST;
	if (system === 'Slide') return SLIDE_PRIPRAVENY ? KOMPONENTY_SLIDE : null;
	if (system === 'Štandard') return KOMPONENTY_STANDARD;
	if (system === 'Deluxe') return KOMPONENTY_DELUXE;
	return null;
}
