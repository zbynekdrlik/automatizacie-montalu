// Pergola — VÝROBNÁ varianta výkresového hárku (#381, podmnožina 1+3+4). Vyčlenené z
// `pergola-narez.ts` (large-file split, #183 vzor) — čistý display engine, žiadny Money
// zápis, žiadny server import (money-safety guard `tests/pergola-narez-money-safety.test.ts`,
// pridané do CISTY_ENGINE). Acyklický import: TENTO modul importuje z `pergola-narez`
// (typy, konštanty, potvrdené vzorce), `pergola-narez` NEimportuje odtiaľto.
//
// Podmnožina 1+3+4: (1) pozičné čísla dielov (kusovník ↔ pohľady), (3) reťazové kóty
// priečok v pôdoryse — LEN z POTVRDENÉHO počtu krovov + svetlosti (honest-null bez neho),
// (4) montážne tolerancie (CAD konštanty). Časti 2 (Detail C/D) a 5 (rezný náčrt krovu)
// sú viazané na #161 — NIE SÚ tu. Generický helper `retazoveKoty` žije v `$lib/vykres/kota.ts`.
import {
	KOD_PRIECKA_NORMAL,
	KOD_PRIECKA_LIGHT,
	KROV_SIRKA_MM,
	KROV_OKRAJ_ODSADENIE_MM,
	platnyPocetKrovov,
	svetlostMedziKrovmi,
	type PergolaNarezVstup,
	type PolozkaNarezu
} from './pergola-narez';

const R1 = (x: number) => Math.round(x * 10) / 10;

/** Diel kusovníka s POZIČNÝM číslom (#381). `cislo` = poradie v Pláne rezov. */
export interface DielSPoziciou extends PolozkaNarezu {
	cislo: number;
}

/** Pozičné čísla dielov (#381 časť 1): kusovník + stabilné `cislo = index + 1` v poradí,
 *  v akom `spocitajNarez` buduje `vypocitane` (poradie Plánu rezov). Súvislé, žiadne
 *  preskakovanie. Čistá funkcia — pre stĺpec „Poz." v materiálovej tabuľke aj previazanie
 *  pohľadov s kusovníkom. */
export function pozicujDiely(vypocitane: PolozkaNarezu[]): DielSPoziciou[] {
	return vypocitane.map((p, i) => ({ ...p, cislo: i + 1 }));
}

/** Pozičné čísla NAKRESLENÝCH dielov (#381 časť 1) pre balóniky vo výkrese — rola → jej
 *  pozičné číslo z `pozicujDiely`. `null` keď diel v kusovníku nie je (napr. zadná noha
 *  pri uchytení na stenu) → balónik sa nekreslí (honest-null). Roly sa hľadajú TÝMI
 *  ISTÝMI predikátmi, aké používa golden test (`tests/pergola-narez-op260282.test.ts`):
 *  názov obsahuje „predná noha" / „zadná noha", názov končí na „žľab", kód = priečkový
 *  profil. */
export interface PoziciePohladov {
	prednaNoha: number | null;
	zadnaNoha: number | null;
	zlab: number | null;
	priecka: number | null;
}

export function pozicieVoVykrese(vypocitane: PolozkaNarezu[]): PoziciePohladov {
	const cislo = (pred: (p: PolozkaNarezu) => boolean): number | null => {
		const i = vypocitane.findIndex(pred);
		return i >= 0 ? i + 1 : null;
	};
	return {
		prednaNoha: cislo((p) => p.nazov.includes('predná noha')),
		zadnaNoha: cislo((p) => p.nazov.includes('zadná noha')),
		zlab: cislo((p) => p.nazov.endsWith('žľab')),
		priecka: cislo((p) => p.kod === KOD_PRIECKA_NORMAL || p.kod === KOD_PRIECKA_LIGHT)
	};
}

/** POTVRDENÉ osové X-pozície priečok (krovov) v pôdoryse [mm] (#381 časť 3) — z MANUÁLNEHO
 *  počtu krovov a svetlosti medzi krovmi (Dominik 21.8.). n krovov šírky 50 mm
 *  (`KROV_SIRKA_MM`), medzera = svetlosť medzi krovmi, 1 mm od kraja
 *  (`KROV_OKRAJ_ODSADENIE_MM` / 2). Rozstup krovov (`KROV_SIRKA_MM + svetlosť`) je POTVRDENÝ
 *  vzorec, NIE schematické rovnomerné delenie `pocetPriecok` — to sa do VÝROBNÝCH kót
 *  nikdy nekreslí (protirečilo by kusovníku a Dominikovmu výkresu, počet 8 vs schéma 9).
 *
 *  `null` keď počet krovov nie je zadaný alebo sa do šírky nezmestí — honest-null (rozostup
 *  sa NEHÁDŽE, presne ako dĺžka rezu priečky do Money, viď `krovDlzkaDoMoney` v
 *  `spocitajNarez`). Bez potvrdeného počtu → reťazová kóta priečok sa vôbec nekreslí. */
export function prieckyOsiPotvrdene(v: PergolaNarezVstup): number[] | null {
	const n = platnyPocetKrovov(v);
	const svetlost = svetlostMedziKrovmi(v.sirka, n);
	if (n == null || svetlost == null) return null;
	const rozstup = KROV_SIRKA_MM + svetlost;
	const okraj = KROV_OKRAJ_ODSADENIE_MM / 2; // 1 mm od kraja
	return Array.from({ length: n }, (_, i) => R1(okraj + KROV_SIRKA_MM / 2 + i * rozstup));
}

/** Montážne tolerancie HĹBKY [mm] (#381 časť 4) — CAD KONŠTANTY z výkresu OP260282
 *  (audit #377): View A (+2), View B (+3/+12), všetky pri celkovej hĺbke 3470. Podľa
 *  validácie (rescope #381) NIE sú odvodené z rozmerov (platia ako montážna vôľa nezávisle
 *  od hĺbky/systému) a NEHÁDAJÚ sa — mimo týchto overených hodnôt sa žiadna tolerancia
 *  nezobrazuje (ŠÍRKA toleranciu nemá, grounding pri nej žiadnu neuvádza). Náš jediný bočný
 *  pohľad (bokorys) zlučuje CAD View A+B, preto sa per-view rozklad nereprodukuje; hodnoty
 *  ostávajú presné CAD konštanty. */
export const MONTAZNE_TOLERANCIE_HLBKA_MM = [2, 3, 12] as const;
