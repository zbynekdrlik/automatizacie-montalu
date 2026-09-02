// Pergola — EXPEDIČNÝ ZOZNAM (#419). Čistý transform UŽ VYPOČÍTANÝCH dát nárezu na
// výdajovo-orientovaný pohľad: „čo a koľko kusov fyzicky odchádza z dielne na expedíciu"
// (na rozdiel od interného výrobného/nárezového zoznamu). Žiaden nový výpočet, žiadne
// nové vstupy — len zloženie hotových profilov (`vypocitane`, reálne Money-overené počty,
// s pozičným číslom dielu z `pozicujDiely` = previazanie s balónikmi vo výkrese) a
// kusových komponentov (`komponentyPergoly`, honest-null počty) do jedného zoznamu.
//
// DISPLAY-ONLY: nič do Money nezapisuje, neimportuje Money zápisovú/odpisovú cestu
// (statický guard: tests/pergola-narez-money-safety.test.ts, zoznam CISTY_ENGINE). Iba
// pure transform — vzor `pozicujDiely` (pergola-vyroba.ts) / `komponentyPergoly`.
//
// HONEST-NULL DISCIPLÍNA (Money-priľahlá, rovnaká ako pre profily/komponenty):
//  • POČET: profily majú reálny `pocetKs` (číslo), komponenty honest-null („—") — NIKDY
//    sa počet komponentu nevymýšľa.
//  • DĹŽKA: informatívna; null keď dĺžka rezu ešte nie je známa (čaká na vzorec) alebo
//    komponent → zobrazí sa „—", nikdy hádané číslo. UI odlíši profil čakajúci na dĺžku
//    („— (čaká na výkres)") od komponentu (bez dĺžky, „—").
//  • KÓD: profil = jeho Money kód; komponent = len informatívny CAD kód (kodCad, môže byť
//    null) — NIE potvrdený Money kód. Do odpisu z tohto modulu nič nejde.
//
// DISJUNKTNÉ od odpadovej logiky (#417): expedícia = HOTOVÉ kusy VON z dielne, nie
// zvyškový materiál z nárezov.

import type { NarezVysledok, PergolaKomponent } from './pergola-narez';
import { pozicujDiely } from './pergola-vyroba';

/** Jedna položka expedičného zoznamu — jeden hotový kus/typ, ktorý ide na výdaj. */
export interface ExpedicnaPolozka {
	/** zoskupenie: hotový rezaný profil vs kusový komponent (spojka/krytka) */
	skupina: 'profil' | 'komponent';
	/** pozičné číslo dielu (previazané s balónikmi vo výkrese); null pri komponente */
	poz: number | null;
	/** Money kód (profil) alebo informatívny CAD kód (komponent, môže byť null) */
	kod: string | null;
	/** názov dielu (plain slovenčina, prevzatý z nárezu/katalógu) */
	nazov: string;
	/** počet kusov na expedíciu: reálny pri profiloch (Money-overený), honest-null pri
	 *  komponentoch (pravidlo počtu komponentov zatiaľ neexistuje) */
	pocetKs: number | null;
	/** informatívna dĺžka rezu [mm]; null pri komponente alebo keď dĺžka čaká na vzorec */
	dlzkaRezuMm: number | null;
}

/** Výsledok expedičného zoznamu: položky + počítadlá. `spoluKusov` = súčet ZNÁMYCH počtov
 *  kusov profilov (komponenty s null počtom sa NErátajú — honest, nikdy sa nedopĺňa). */
export interface ExpedicnyZoznam {
	polozky: ExpedicnaPolozka[];
	pocetProfilov: number;
	pocetKomponentov: number;
	spoluKusov: number;
}

/** Zloží expedičný zoznam z už vypočítaných dát nárezu (`spocitajNarez`) a kusových
 *  komponentov (`komponentyPergoly`). ČISTÁ funkcia — žiaden vstup/perzistencia, žiaden
 *  Money zápis. Profily idú prvé (hotové kusy s reálnymi počtami + pozičné číslo z
 *  `pozicujDiely`, rovnaké ako v Pláne rezov/výkrese), komponenty za nimi (honest-null). */
export function expedicnyZoznam(
	vysledok: NarezVysledok,
	komponenty: PergolaKomponent[]
): ExpedicnyZoznam {
	// pozičné čísla dielov = tie isté ako v Materiáli/výkrese (`pozicujDiely`), aby sa
	// expedičný zoznam dal krížovo previazať s balónikmi na výkrese.
	const profily: ExpedicnaPolozka[] = pozicujDiely(vysledok.vypocitane).map((d) => ({
		skupina: 'profil' as const,
		poz: d.cislo,
		kod: d.kod,
		nazov: d.nazov,
		pocetKs: d.pocetKs,
		dlzkaRezuMm: d.dlzkaRezuMm
	}));
	const komp: ExpedicnaPolozka[] = komponenty.map((k) => ({
		skupina: 'komponent' as const,
		poz: null,
		kod: k.kodCad,
		nazov: k.typ,
		pocetKs: k.pocetKs,
		dlzkaRezuMm: null
	}));
	// Súčet počtov profilov zo ZDROJA (`vypocitane.pocetKs` je vždy číslo) — komponenty
	// s honest-null počtom sa do súčtu NErátajú (nikdy sa počet nedopĺňa).
	const spoluKusov = vysledok.vypocitane.reduce((s, p) => s + p.pocetKs, 0);
	return {
		polozky: [...profily, ...komp],
		pocetProfilov: profily.length,
		pocetKomponentov: komp.length,
		spoluKusov
	};
}
