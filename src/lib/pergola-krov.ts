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
//  - pásmo NAD 9° (A7): „nad 9–10° sa drážka zatvára, výška krovu sa dvíha" = zmena režimu;
//    otázka A7 (ch207 msg 1724259 bod 5) ostala NEZODPOVEDANÁ → uloženie AJ nominálna dĺžka
//    sa nad 9° nepočítajú (honest-null, nikdy extrapolácia potvrdeného pásma).
//  - metrický prepočet krovu ako celku (O14 — dohodnuté „vrátiť sa na konci", nedošlo).
//
// POTVRDENÉ dodatočne (Dominik, Odoo ch207 21.8., msg 1724330): konštanta 0,01 JE v mm —
// „je to pomyslený trojuholnik ktorý prehadzuje rovinu bodu uloženia hornej a spodnej
// hrany prieckoveho profilu 105 (krovu)" (bývalá otvorená otázka O5b je uzavretá).

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
 *  nespadne presne na nulu. Jednotka POTVRDENÁ mm (Dominik ch207 msg 1724330): „je to
 *  pomyslený trojuholnik ktorý prehadzuje rovinu bodu uloženia hornej a spodnej hrany
 *  prieckoveho profilu 105 (krovu)". */
export const KROV_KONST = 0.01;
/** prah sklonu strechy [°] — binárny prepínač roviny uloženia (CAD `uhol2`). */
export const KROV_PRAH_STUPNE = 7;
/** odpočet [mm] pre NOMINÁLNU dĺžku krovu = predný profil (140) + zadný (110), odpočítané
 *  po projekcii (meria sa po spáde). OVERENÉ na golden OP260282 (Massive 140, samostatne
 *  stojaca, zadný 110): 3470/cos(6,1°) − 250 = 3239,76.
 *  POZOR — JEDINÝ golden bod: −250 je overené LEN pre presne túto konfiguráciu. Robust má
 *  od 25.8. VLASTNÉ pravidlo (viď `KROV_ODPOCET_ROBUST` = 220, Dominikov verbatim rozdiel 30);
 *  Massive so 140 zadným a uchytenie na stenu ostávajú NEOVERENÉ → `spocitajNarez` emituje
 *  nominál len pre samostatne stojacu so zadným 110 (konfigurácia kotvy), všetko ostatné je
 *  honest-null (nikdy neoverené číslo do Money). Zovšeobecnenie čaká na ďalšiu zákazku /
 *  potvrdenie Dominikom (majiteľ posúdi). */
export const KROV_ODPOCET = 250;
/** odpočet [mm] pre NOMINÁLNU dĺžku krovu — ROBUST. Dominik VERBATIM (ch207 msg 1724329):
 *  krov = „výsuv − 147,94 v predu a v zadu −7 spolu teda pri masíve výsuv −154,94 a pri
 *  robuste je to 124,94" → rozdiel masív↔Robust je PRESNE 30 mm (154,94 − 124,94 = predný
 *  profil 140 − 110; predný odpočet 147,94 = profil + 7,94, takže „výsuv" je meraný od
 *  vonkajšej prednej hrany a od systému nezávislý). Báza „výsuv" nie je vstup appky
 *  (definícia ostala nezodpovedaná — A3), preto sa implementuje LEN Dominikov rozdiel,
 *  ukotvený na overený masív bod: Robust = 250 − 30 = 220. BEZ Robust goldenu — riadok
 *  nesie poznámku „na potvrdenie pri prvej Robust zákazke" (vzor 200×140 z PR #273). */
export const KROV_ODPOCET_ROBUST = 220;
/** sklon [°], nad ktorým Dominik popísal ZMENU správania („nad 9–10° sa drážka zatvára,
 *  výška krovu sa dvíha") — otázka A7 na presné pravidlá pásma ostala NEZODPOVEDANÁ
 *  (ch207 msg 1724259 bod 5), preto je toto HRANICA PODPORY: nad ňou sa uloženie ani
 *  nominálna dĺžka NEPOČÍTAJÚ (honest-null); presne 9° ešte počíta (potvrdený režim
 *  „otvára") a nesie varovnú poznámku o pásme. */
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

// #233 — renderované poznámky (krov.poznamky) sú plain slovenčina bez interných
// referencií (#161/O5/O5b ostávajú v komentároch kódu, nie na obrazovke).
const FREZOVANIE_POZN = 'Frézovanie drážok (dĺžka/výška/uhol) = výrobný list — doplní konštruktér.';
const ODVESNA_POZN = 'Priradenie odvesny c/cc prednej/zadnej hrane je odvodené, nie potvrdené.';
// (bývalá poznámka o neistej jednotke 0,01 odstránená — jednotka mm POTVRDENÁ, msg 1724330)

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
					'vetva NIE JE potvrdeným vzorcom pokrytá. Uloženie sa nepočíta.',
				FREZOVANIE_POZN
			]
		};
	}

	// NAD 9° (A7) — zmena režimu („drážka sa zatvára, výška krovu sa dvíha") bez potvrdeného
	// vzorca; otázka A7 ostala nezodpovedaná → honest-null, potvrdené pásmo sa NEextrapoluje.
	if (s > KROV_FREZ_ZMENA_STUPNE) {
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
				`Sklon nad ${KROV_FREZ_ZMENA_STUPNE}° — drážka sa zatvára a výška krovu sa dvíha ` +
					'(iný režim uloženia). Pásmo zatiaľ NIE JE pokryté potvrdeným vzorcom — uloženie sa nepočíta.',
				FREZOVANIE_POZN
			]
		};
	}

	// 7°–9° — POTVRDENÝ režim (číselne overený pri 8°)
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
		// dostane sa sem už len presne 9° (nad 9° vracia vetva vyššie „nepodporované")
		poznamky.push(
			`Sklon ${KROV_FREZ_ZMENA_STUPNE}° je na hranici pásma, kde sa drážka zatvára a výška ` +
				'krovu sa dvíha — nad ňou sa uloženie už nepočíta (bez potvrdeného vzorca).'
		);
	}
	poznamky.push(ODVESNA_POZN, FREZOVANIE_POZN);

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

/** NOMINÁLNA dĺžka krovu (spodná hrana / uloženie) zo sklonu strechy [mm] — meria sa po
 *  spáde: `hĺbka / cos(sklon) − 250`. Vráti `null` keď sklon/hĺbka nezadané alebo neplatné
 *  (honest-null — bez sklonu sa dĺžka NEDÁ počítať, nič sa nehádže).
 *
 *  Oddelené od `krovUlozenie` (offsety prahu 7°): uloženie sa počíta len pre sklon ≥ 7°,
 *  ale NOMINÁLNA dĺžka funguje pre KAŽDÝ sklon > 0 — golden OP260282 má sklon 6,1° (POD
 *  prahom), takže dĺžka MUSÍ ísť mimo uloženia. Overené na golden: 3470/cos(6,1°) − 250 =
 *  3239,76 mm.
 *
 *  Horná hrana krovu (HH, výkres OP260282 = 3240,93) = nominál + ~1,17 mm reálne uloženie
 *  („nesedí o ~2 mm, nerieš" — Dominik na výkres); +1,17 nemá čistý vzorec, preto sa emituje
 *  NOMINÁL a seating gap sa len dokumentuje (do rezervačného odpisu stačí nominál).
 *
 *  Konštanta `KROV_ODPOCET = 250` je overená pre Massive 140 / zadný 110 (jediný golden);
 *  Robust používa `KROV_ODPOCET_ROBUST = 220` = kotva + Dominikov verbatim rozdiel 30
 *  (ch207 msg 1724329, viď konštantu) — bez Robust goldenu, preto poznámka „na potvrdenie".
 *  Emisiu gatuje `spocitajNarez` (samostatne stojaca + zadný profil 110 = konfigurácia
 *  kotvy). A7: sklon nad 9° (`KROV_FREZ_ZMENA_STUPNE`) → null — „výška krovu sa dvíha",
 *  pásmo nemá potvrdený vzorec, nič sa nehádže. R2 (0,01 mm) = presnosť výkresu (3240,93).
 *  Čistá funkcia, bez vedľajších efektov, bez Money zápisu. */
export function krovDlzkaNominal(
	hlbkaMm: number,
	sklonStupne: number | null | undefined,
	system: 'Robust' | 'Massive' = 'Massive'
): number | null {
	const s = typeof sklonStupne === 'number' && Number.isFinite(sklonStupne) ? sklonStupne : null;
	if (s === null || s <= 0) return null;
	if (s > KROV_FREZ_ZMENA_STUPNE) return null; // A7 — pásmo nad 9° bez vzorca (honest-null)
	if (!(typeof hlbkaMm === 'number' && Number.isFinite(hlbkaMm) && hlbkaMm > 0)) return null;
	const cos = Math.cos(rad(s));
	if (!(cos > 0)) return null; // obranné (sklon → 90° by delil ~0)
	return R2(hlbkaMm / cos - (system === 'Robust' ? KROV_ODPOCET_ROBUST : KROV_ODPOCET));
}
