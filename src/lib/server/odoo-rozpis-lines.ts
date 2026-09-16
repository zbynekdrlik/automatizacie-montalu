// #522: appková polovica kontraktu `montalu_narezak_upload` → `lines` (odoo-erp #6517/#6949).
// Mapuje `PlanRezovVysledok` (TEN ISTÝ vysledok, z ktorého ide PDF aj detail plánu — jeden
// zdroj pravdy) na `montalu.rozpis.line[]` pre výrobný tablet „Čo rezať".
//
// Money-NEUTRÁLNE: žiadny import z money, žiadne článkové kódy, žiadny db zápis, žiadna cena —
// čisté mapovanie. `kod` ostáva prázdny (plán rezov nemá Money kódy; identitu profilu nesie
// `nazov`, často s interným číslom profilu, napr. „18013 …"). Samostatný modul zámerne — je to
// budúci domov pre `buildGlassOrder` (#521 glass_order), payload shaping na jednom mieste.
import type { PlanRezovVysledok } from './plan-rezov';

/** Minimálny tvar profilu, ktorý builder potrebuje: názov + agregované rezy (dĺžka → počet).
 *  `MaterialRow` (zasklenia/sietka compute), `PlanRezovProfil.material` (#522) aj ad-hoc adaptéry
 *  backfillu (CAD/clip → tento tvar) ho spĺňajú → JEDEN zdroj pravdy pre `lines`, žiadna duplicita. */
export interface RozpisMaterial {
	nazov: string;
	rezy: { rozmer: number; ks: number }[];
}

/** Jeden riadok rozpisu rezov = jedna kombinácia (profil × dĺžka rezu) → počet kusov.
 *  Zodpovedá elementu `lines[]` v `montalu_narezak_upload` (model `montalu.rozpis.line`). */
export interface RozpisLine {
	/** Money článkový kód profilu/tyče — v pláne rezov prázdny (Money-neutrálny). */
	kod: string;
	/** názov profilu (presne z CAD tabuľky) */
	nazov: string;
	/** počet kusov danej dĺžky (celé číslo) */
	mnozstvo: number;
	/** merná jednotka — rezané kusy = „ks" */
	mj: string;
	/** dĺžka jedného rezu v METROCH (kontrakt: príklad 4.5 = 4500 mm) */
	dlzka: number;
	/** poznámka (posuv/sekcia) — plán rezov ju nedrží (plochá CAD tabuľka) → prázdna */
	poznamka: string;
}

/** mm → m so zachovaním 0.1 mm presnosti (bez FP šumu): 4500 → 4.5, 2834.5 → 2.8345. */
function mmNaMetre(mm: number): number {
	return Math.round(mm * 10) / 10_000;
}

/**
 * JADRO mapovania profilov (názov + agregované rezy) → `montalu.rozpis.line[]`. Pre každý profil
 * vezme jeho AGREGOVANÉ rezy (`rezy` = dĺžka → počet kusov, tie isté, ktoré renderuje `RozpisRezov`
 * na detaile a PDF) a spraví z každej dvojice jeden riadok. Rezy dlhšie ako tyč sa v agregovaných
 * rezoch nenachádzajú (compute ich nezaradil do kusov), takže sa do `lines` prirodzene nedostanú —
 * nemieša sa nerealizovateľný rez do „čo rezať".
 *
 * `poznamka` (default '') sa pripíše KAŽDÉMU riadku — plán rezov (#522) posiela '', backfill (#524)
 * posiela „spätne dopočítané <dátum>" keď sa modul nedá bit-identicky znovu spočítať. `kod` ostáva
 * prázdny (Money-neutrálne, identitu nesie `nazov`) — kiosk je pre rezača bez interných kódov/cien.
 */
export function rozpisLinesFromMaterial(material: RozpisMaterial[], poznamka = ''): RozpisLine[] {
	const lines: RozpisLine[] = [];
	for (const mat of material) {
		for (const rez of mat.rezy) {
			if (!(rez.ks > 0)) continue;
			lines.push({
				kod: '',
				nazov: mat.nazov,
				mnozstvo: rez.ks,
				mj: 'ks',
				dlzka: mmNaMetre(rez.rozmer),
				poznamka
			});
		}
	}
	return lines;
}

/**
 * Postaví `lines` pre `montalu_narezak_upload` z výsledku plánu rezov (#522). Deleguje na
 * `rozpisLinesFromMaterial` — `vysledok.material` je `vysledok.profily.map(p => p.material)`
 * (plan-rezov.ts), takže výstup je BIT-IDENTICKÝ s pôvodnou per-profil iteráciou (žiadna regresia).
 */
export function buildRozpisLines(vysledok: PlanRezovVysledok): RozpisLine[] {
	return rozpisLinesFromMaterial(vysledok.material);
}
