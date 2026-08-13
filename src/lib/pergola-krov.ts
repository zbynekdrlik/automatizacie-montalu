// Pergola — KROV: geometria ULOŽENIA podľa prahu 7° (#161). Čistý TS engine bez
// závislosti na Svelte/DOM/serveri — plne unit-testovateľný (tests/pergola-krov.test.ts).
//
// DISPLAY-ONLY: NIKAM do Money nezapisuje. NEimportuje `$lib/server/money` ani
// `$lib/server/pergola` — statický guard v tests/pergola-narez-money-safety.test.ts
// (tento súbor je v jeho zozname SUBORY). #197 (napojenie na Money) je oddelené a gated.
//
// DISCIPLÍNA (#161): počíta LEN POTVRDENÉ vzorce z analýzy nahrávky callu s Dominikom
// (13.8.2026, komentár na #161). SE tabuľka premenných (overená 4× zväčšením snímky
// scr_030) — POZOR, je to TANGENS, nie sínus (prvá oprava zadania):
//
//   uhol2 = IF( UHOL <= 7, 0, 1 )                 // binárny prepínač roviny uloženia
//   uhol3 = UHOL - 7
//   ls = ps = TAN(RADIANS(uhol3)) * c  + 0,01     // c  ≈ 29 mm    (odvesna 1)
//   lv = pv = TAN(RADIANS(uhol3)) * cc + 0,01     // cc ≈ 37,28 mm (odvesna 2)
//
// Číselne overené pri 8° (uhol3 = 1): ps = ls = tan(1°)·29 + 0,01 = 0,516 → 0,52;
// lv = pv = tan(1°)·37,28 + 0,01 = 0,661 → 0,66 — presne tabuľka na scr_030. Dekódovaný
// „trojuholník 0,52–29–0,01" = (ps, c, konštanta) pri 8°.
//
// NEPODPOROVANÉ (nikdy sa nehádže vzorec):
//  - vetva POD 7° (O5): bod dotyku sa „prehodí" (trojuholník sa otočí), lv/ps by vyšli
//    záporné — vzorcom nie je pokrytá, uloženie sa nepočíta.
//  - frézovanie drážok (dĺžka/výška/uhol drážok = výrobný list, O5) — Dominikova vlastná
//    hranica scope: „návrh áno / výrobný list nie".
//  - priradenie odvesny c/cc prednej/zadnej dotykovej hrane je ODVODENÉ, nie povedané (O5).
//  - jednotka konštanty „0,01" (O5b — mm predpokladané, Dominik jednotku nepovedal).
//  - správanie nad ~9–10° (drážka sa zatvára, výška krovu sa dvíha) je frézovací detail
//    (O5); offsety uloženia z potvrdeného vzorca ostávajú, len sa pridá poznámka.
//  - metrický prepočet krovu ako celku (O14 — dohodnuté „vrátiť sa na konci", nedošlo).

/** zaokrúhlenie na 0,01 mm — uloženie sú sub-mm hodnoty, SE tabuľka udáva 2 desatinné
 *  (0,52 / 0,66). NIE R1 z pergola-narez.ts (0,1 mm) — tá by 0,52 aj 0,66 zlepila na 0,5. */
const R2 = (x: number) => Math.round(x * 100) / 100;
const rad = (deg: number) => (deg * Math.PI) / 180;

// --- Potvrdené konštanty uloženia (dôkaz = kóty na skici scr_009/010/030) -----------
/** vodorovná odvesna 1 [mm], kóta „29" (odvesna trojuholníka 0,52–29–0,01). */
export const KROV_C = 29;
/** vodorovná odvesna 2 [mm], kóta „37,28". */
export const KROV_CC = 37.28;
/** pevný sčítanec [mm] v každom vzorci (kóta „0,01" v bode dotyku) — geometria nikdy
 *  nespadne presne na nulu. Jednotka = O5b (predpoklad mm). */
export const KROV_KONST = 0.01;
/** prah sklonu strechy [°] — binárny prepínač roviny uloženia (CAD `uhol2`). */
export const KROV_PRAH_STUPNE = 7;
/** sklon [°], nad ktorým Dominik popísal ZMENU správania drážky („nad 9–10° sa drážka
 *  zatvára, výška krovu sa dvíha") — frézovací detail (O5). Nemení potvrdené offsety. */
export const KROV_FREZ_ZMENA_STUPNE = 9;

export type KrovRezim = 'nezadane' | 'nepodporovane' | 'rovnobezne' | 'otvara';

export interface KrovUlozenie {
	/** vstupný sklon strechy [°] (echo; null keď nezadané/neplatné). */
	sklonStupne: number | null;
	/** či sa dá počítať POTVRDENÉ uloženie (true pre sklon ≥ 7°). */
	podporovane: boolean;
	/** ktorá rovina uloženia platí (Dominikov slovný popis + CAD prepínač). */
	rezim: KrovRezim;
	/** CAD prepínač `uhol2 = IF(UHOL<=7,0,1)`: 0 pre sklon ≤ 7°, 1 pre > 7°. null keď nezadané. */
	uhol2: 0 | 1 | null;
	/** `uhol3 = sklon − 7` [°]. null keď nezadané/nepodporované. */
	uhol3: number | null;
	/** offsety uloženia [mm] z odvesny c (29): `ls = ps`. null keď nepodporované. */
	ls: number | null;
	ps: number | null;
	/** offsety uloženia [mm] z odvesny cc (37,28): `lv = pv`. null keď nepodporované. */
	lv: number | null;
	pv: number | null;
	/** potvrdené konštanty (na zobrazenie vo výkrese/detaile). */
	konstanty: { c: number; cc: number; konst: number };
	/** čestný zoznam toho, čo je STÁLE nepodporované / neuzavreté (frézovanie, O5/O5b/O14). */
	poznamky: string[];
}

const FREZOVANIE_POZN =
	'Frézovanie drážok (dĺžka/výška/uhol) = výrobný list — doplní konštruktér (#161, O5).';
const ODVESNA_POZN =
	'Priradenie odvesny c/cc prednej/zadnej hrane je odvodené, nie potvrdené (O5).';
const JEDNOTKA_POZN = 'Konštanta 0,01 predpokladá mm (O5b — jednotku Dominik nepovedal).';

/** Uloženie krovu z uhla sklonu strechy — LEN potvrdené vzorce prahu 7° (#161). Čistá
 *  funkcia, bez vedľajších efektov, bez Money zápisu. Neodvodzuje sklon z výšok/hĺbky
 *  (vzťah nie je potvrdený) — sklon je priamy vstup, presne ako `uhol` v SE modeli. */
export function krovUlozenie(sklonStupne: number | null | undefined): KrovUlozenie {
	const konstanty = { c: KROV_C, cc: KROV_CC, konst: KROV_KONST };
	const s = typeof sklonStupne === 'number' && Number.isFinite(sklonStupne) ? sklonStupne : null;

	// nezadané / neplatné (prázdny formulár, NaN, ≤ 0) — nič sa nepočíta
	if (s === null || s <= 0) {
		return {
			sklonStupne: s,
			podporovane: false,
			rezim: 'nezadane',
			uhol2: null,
			uhol3: null,
			ls: null,
			ps: null,
			lv: null,
			pv: null,
			konstanty,
			poznamky: ['Sklon strechy nezadaný — uloženie krovu sa nepočíta.']
		};
	}

	const uhol2: 0 | 1 = s <= KROV_PRAH_STUPNE ? 0 : 1;

	// POD 7° — vetva nie je potvrdeným vzorcom pokrytá (O5): bod dotyku sa prehodí,
	// lv/ps by vyšli záporné. Nepočítame — čestne „nepodporované", nikdy nehádžeme.
	if (s < KROV_PRAH_STUPNE) {
		return {
			sklonStupne: s,
			podporovane: false,
			rezim: 'nepodporovane',
			uhol2,
			uhol3: null,
			ls: null,
			ps: null,
			lv: null,
			pv: null,
			konstanty,
			poznamky: [
				`Sklon pod ${KROV_PRAH_STUPNE}° — bod dotyku sa prehodí (trojuholník sa otočí), ` +
					'vetva NIE JE potvrdeným vzorcom pokrytá (O5). Uloženie sa nepočíta.',
				FREZOVANIE_POZN
			]
		};
	}

	// ≥ 7° — POTVRDENÝ režim (číselne overený pri 8°)
	const uhol3 = R2(s - KROV_PRAH_STUPNE);
	const t = Math.tan(rad(s - KROV_PRAH_STUPNE));
	const ps = R2(t * KROV_C + KROV_KONST); // = ls
	const lv = R2(t * KROV_CC + KROV_KONST); // = pv
	const rezim: KrovRezim = s === KROV_PRAH_STUPNE ? 'rovnobezne' : 'otvara';

	const poznamky: string[] = [];
	if (rezim === 'rovnobezne') {
		poznamky.push(
			`Sklon = ${KROV_PRAH_STUPNE}° — krov leží rovnobežne s hranou; uloženie ešte ` +
				`neotvorené (offsety = konštanta ${KROV_KONST} mm).`
		);
	} else {
		poznamky.push(
			`Sklon > ${KROV_PRAH_STUPNE}° — dva dotyky + previs medzi nimi; čím väčší uhol, tým viac sa otvára.`
		);
	}
	if (s >= KROV_FREZ_ZMENA_STUPNE) {
		poznamky.push(
			`Nad ~${KROV_FREZ_ZMENA_STUPNE}–10° sa drážka zatvára a výška krovu sa dvíha — ` +
				'frézovací detail (O5); offsety uloženia ostávajú z potvrdeného vzorca.'
		);
	}
	poznamky.push(ODVESNA_POZN, JEDNOTKA_POZN, FREZOVANIE_POZN);

	return {
		sklonStupne: s,
		podporovane: true,
		rezim,
		uhol2,
		uhol3,
		ls: ps,
		ps,
		lv,
		pv: lv,
		konstanty,
		poznamky
	};
}
