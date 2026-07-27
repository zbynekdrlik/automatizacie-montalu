// Klín zasklenia (Patrik 2026-07-27) — trapézový klin nad posuvom: dlhá horná
// hrana (dĺžka), hĺbka (šírka) a dve výšky (nižšia/vyššia strana). Zadáva sa per
// posuv, môže byť viac kusov.
//
// DISPLAY-ONLY: klín ide LEN do náhľadu, nárezového plánu/tlače a do detailu
// v histórii odpisov. Do Money odpisu (.xlsx položky) NEVSTUPUJE — Patrik:
// „Nemusí to nič meniť, len čísla nech tam sú." Preto je typ v klientskom
// $lib (kreslí ho Nahlad2D) a výpočet ho len prenáša.

export interface Klin {
	/** dĺžka klina — dlhá horná hrana [mm] */
	dlzka: number;
	/** šírka = hĺbka klina [mm] */
	sirka: number;
	/** výška 1 — jedna strana klina [mm]; 0 = ostrý koniec */
	v1: number;
	/** výška 2 — druhá strana klina [mm]; 0 = ostrý koniec */
	v2: number;
	/** počet kusov */
	ks: number;
}

/** hraničné hodnoty klina — rovnaké pre klienta (HTML5 min/max) aj server */
export const KLIN_MIN_ROZMER = 1;
export const KLIN_MAX_ROZMER = 20000;
export const KLIN_MAX_KS = 99;

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/** jednoriadkový popis klina do plánu / detailu histórie */
export function klinPopis(k: Klin): string {
	return `${k.ks}× klín ${fmt(k.dlzka)} × ${fmt(k.sirka)} mm, výška ${fmt(k.v1)} → ${fmt(k.v2)} mm`;
}
