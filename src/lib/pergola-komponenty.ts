// Pergola — vrstva KUSOVÝCH komponentov (spojky, krytky, rámové/zakladacie lišty) — #195.
// Vyčlenené z `pergola-narez.ts` (#155/#183 large-file split — súbor prekročil 1000-r. strop);
// PURE MOVE, žiadna zmena správania. DISPLAY-ONLY: neimportuje nič z Money zápisovej cesty
// (statický guard: tests/pergola-narez-money-safety.test.ts, zoznam CISTY_ENGINE). Zdroj TYPOV =
// call 13.8. (scr_014/015 Massive; scr_042 Robust) + výkres OP260282; počty/Money kódy honest-null.
import type { PergolaSystem, PergolaNarezVstup } from './pergola-narez';

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
