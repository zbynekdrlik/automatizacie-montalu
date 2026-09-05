// Tesnenia (gumy) pergoly — čistý výpočet dĺžok z nárezových dát (#339).
//
// EXTRAHOVANÉ z `server/pergola-rezervacia.ts` (#419): funkcia `spocitajTesnenia` je čistá
// (závisí len na `NarezVysledok.vypocitane`, žiadne Money/server imporfy) a potrebuje ju
// client-safe `pergola-expedicia.ts`. Typy + katalóg + funkcia žijú tu; `pergola-rezervacia`
// ich re-importuje. Pridané do `CISTY_ENGINE` money-safety guardu.
//
// MONEY-ZÁMKA: `TesnenieRozmer.kod` má literálový typ `null` — štrukturálne sa NEDÁ
// priradiť na `Polozka` (`kod: string`), takže tesnenie nikdy nevstúpi do `job.polozky`.
// Overené `@ts-expect-error` testom v `tests/pergola-tesnenia.test.ts`.
//
// Data-driven: doplnenie Money kódov = úprava `TESNENIA`, nie redizajn.

import type { NarezVysledok } from './pergola-narez';

/** `ok` = dĺžka spočítaná; `caka` = základ nepotvrdený/nespočítaný (nikdy hádané číslo). */
export type TesnenieStav = 'ok' | 'caka';

export interface TesnenieRozmer {
	/** stabilné id pravidla (na test/UI kľúč) */
	id: 'na-skla' | 'zlab' | 'kotviaci';
	nazov: string;
	/** dĺžka tesnenia [mm]; null keď `stav==='caka'` (nikdy vymyslené číslo) */
	dlzkaMm: number | null;
	/** koeficient pravidla (na sklá ×4, žľab/kotviaci ×1) */
	koef: number;
	stav: TesnenieStav;
	/** ľudský popis vzorca (plain slovenčina, na obrazovku) */
	vzorec: string;
	/** dôvod, keď `stav==='caka'` */
	dovod?: string;
	/** Money kód — VŽDY null, kým Dominik nedodá zoznam. Literálový typ = Money-zámka:
	 *  `TesnenieRozmer` sa nedá priradiť na `Polozka` (`kod: string`). */
	kod: null;
}

/** Definícia jedného tesnenia. `zakladKody: null` = základ („stropný profil")
 *  nepotvrdený → `stav:'caka'`; inak dĺžka = súčet `dlzkaRezuMm × pocetKs` riadkov
 *  s tými kódmi × `koef`. Data-driven: doplnenie kódov/potvrdenie základu = úprava
 *  tohto poľa, nie redizajn. */
interface TesnenieDef {
	id: 'na-skla' | 'zlab' | 'kotviaci';
	nazov: string;
	koef: number;
	zakladKody: string[] | null;
	vzorec: string;
	dovodCaka?: string;
}

const TESNENIA: TesnenieDef[] = [
	{
		id: 'na-skla',
		nazov: 'Tesnenie na sklá',
		koef: 4,
		// „stropný profil" nie je doslovný názov v katalógu — prítlačná lišta (18006) vs
		// priečkový profil (18004) dávajú iné súčty; NEHÁDAŤ, čaká na potvrdenie Dominika.
		zakladKody: null,
		vzorec: 'dĺžka stropného profilu × 4',
		dovodCaka: 'čaká na potvrdenie, ktorý profil je „stropný profil", a či ×4 platí na súčet dĺžok'
	},
	{
		id: 'zlab',
		nazov: 'Tesnenie žľabu',
		koef: 1,
		// žľab: Robust 18021 / Massive 18018 (dĺžka = šírka, overené goldenom OP260282)
		zakladKody: ['18021', '18018'],
		vzorec: 'dĺžka žľabu'
	},
	{
		id: 'kotviaci',
		nazov: 'Tesnenie kotviaceho profilu',
		koef: 1,
		// kotviaci profil horný 18019 (dĺžka = šírka, overené goldenom OP260282)
		zakladKody: ['18019'],
		vzorec: 'dĺžka kotviaceho profilu'
	}
];

/**
 * Tesnenia (gumy) pre pergolu (#339) — dĺžky z potvrdených riadkov nárezu.
 * Žiadne tesnenie NEIDE do Money (kód nie je známy; `kod: null` na type je
 * štrukturálna zámka). Pravidlá #2/#3 majú jednoznačný základ (žľab/kotviaci = šírka),
 * pravidlo #1 je odložené (`stav:'caka'`) — základ „stropný profil" je nejednoznačný.
 * Základ, ktorý zatiaľ nie je v spočítanom náreze (napr. bez krovu), degraduje na
 * `caka` — nikdy hádané číslo.
 *
 * ČISTÁ funkcia — bez vedľajších efektov, bez Money zápisu (Money-neutrálne, display-only).
 */
export function spocitajTesnenia(vysledok: NarezVysledok): TesnenieRozmer[] {
	return TESNENIA.map((def): TesnenieRozmer => {
		if (def.zakladKody === null) {
			return {
				id: def.id,
				nazov: def.nazov,
				dlzkaMm: null,
				koef: def.koef,
				stav: 'caka',
				vzorec: def.vzorec,
				dovod: def.dovodCaka,
				kod: null
			};
		}
		const kody = def.zakladKody;
		const rows = vysledok.vypocitane.filter(
			(p) => kody.includes(p.kod) && p.dlzkaRezuMm != null && p.pocetKs > 0
		);
		if (rows.length === 0)
			return {
				id: def.id,
				nazov: def.nazov,
				dlzkaMm: null,
				koef: def.koef,
				stav: 'caka',
				vzorec: def.vzorec,
				dovod: 'základový profil zatiaľ nie je v spočítanom náreze',
				kod: null
			};
		const zaklad = rows.reduce((s, p) => s + (p.dlzkaRezuMm as number) * p.pocetKs, 0);
		return {
			id: def.id,
			nazov: def.nazov,
			dlzkaMm: zaklad * def.koef,
			koef: def.koef,
			stav: 'ok',
			vzorec: def.vzorec,
			kod: null
		};
	});
}
