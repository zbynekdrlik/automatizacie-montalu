// Kovanie a tesnenia — tabuľky od Dominika (2026-07-28, „KOMPONENTY RS ROBUST" /
// „KOMPONENTY RS SLIDE" + jeho odpovede na 6 otázok v ten istý deň).
//
// MONEY-KRITICKÉ. Každý kód bol overený proti OSTRÉMU Money (read-only SQL, 2026-07-28):
// existuje, `Deleted=0`, názov sedí. Robustné položky majú aj skladovú zásobu na sklade
// „Materiál"; Slide položky `ZASK20253`–`ZASK20259` sú zatiaľ LEN artikel bez zásoby —
// preto je Slide vypnutý (`SLIDE_PRIPRAVENY`), aby appka neposlala pohyb, ktorý nemá
// kam sadnúť.
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

/** Automatický zámok Slide — rovnaký vzor ako uzáver Robust. */
const ZAMKY_SLIDE = {
	'Slide|2K': 2,
	'Slide|3K': 2,
	'Slide|2x2K': 3,
	'Slide|2x3K': 3
};

/** Zasklievacie tesnenie 10 vs 12 sa nedá určiť dopredu — Dominik ho dal zámerne 50/50
 *  (závisí od zlepenia skla a tolerancie profilov; pri 24 mm skle raz 10, raz 12, raz
 *  kombinácia). Preto každý kód dostane polovicu dĺžky rámového profilu. */
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
	// ďalšie +1 krídlo" — tie krajné krídla sú tie isté, na ktoré ide uzáver
	{ kod: 'ZASK00030', nazov: 'Kľučka', mj: 'ks', pravidlo: { typ: 'naUzaverPodlaFab' } },
	{ kod: 'ZASK00031', nazov: 'Podložka uzáveru', mj: 'ks', pravidlo: { typ: 'naUzaver', koef: 5 } },
	// POZOR: prvá verzia tabuľky mala 5 ks (copy-paste z podložky) — Dominik opravil na 2
	{ kod: 'ZASK00032', nazov: 'Protikus uzáveru', mj: 'ks', pravidlo: { typ: 'naUzaver', koef: 2 } },
	{
		kod: 'ZASK00033',
		nazov: 'Protikus uzáveru podložka',
		mj: 'ks',
		pravidlo: { typ: 'naUzaver', koef: 2 }
	},
	{ kod: 'ZASK00034', nazov: 'Upevňovacia sada', mj: 'ks', pravidlo: { typ: 'naUzaver', koef: 1 } },
	{ kod: 'ZASK00035', nazov: 'Krytka vložky', mj: 'ks', pravidlo: { typ: 'naUzaverPodlaFab' } },
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
	{
		kod: 'ZASK20254',
		nazov: 'Automaticky zamok RS SLIDE',
		mj: 'ks',
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
 * Slide kovanie sa do Money NEPOSIELA, kým `ZASK20253`–`ZASK20259` nemajú v Money
 * skladovú zásobu na sklade „Materiál" (2026-07-28 sú len artikly; Dominik ich zakladá).
 * Odpis je skladový pohyb — bez zásoby by import zlyhal alebo naviezol špinu.
 */
export const SLIDE_PRIPRAVENY = false;

/** Kovanie pre daný systém, alebo `null` keď systém kovanie do odpisu (zatiaľ) nedáva. */
export function komponentyPre(system: string): Komponent[] | null {
	if (system === 'Robust') return KOMPONENTY_ROBUST;
	if (system === 'Slide') return SLIDE_PRIPRAVENY ? KOMPONENTY_SLIDE : null;
	return null;
}
