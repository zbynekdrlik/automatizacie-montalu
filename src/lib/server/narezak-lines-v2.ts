// #529: v2 nárezák payload builder — kontrakt appka↔odoo-erp #6949 (GROUNDWORK, za flagom
// `ODOO_NAREZ_LINES_V2=1` default OFF). Odoo intake je LENIENT (top-level `**extra` + per-riadok
// `.get()` — overené v `sale_order_narezak.py`), takže tieto polia sa dajú posielať bezpečne a
// spätne kompatibilne; Odoo ich zatiaľ IGNORUJE a vykreslí ich neskôr (tablet „Čo rezať" nakreslí
// tyče graficky + odškrtávanie po tyči).
//
// v1 `lines` (profil × dĺžka, `odoo-rozpis-lines.ts`) OSTÁVAJÚ NEZMENENÉ (kiosk na ne dnes spolieha).
// v2 ide ako SAMOSTATNÝ top-level kľúč `narezak_v2` (NIE ako ďalšie riadky v `lines[]`, ktoré by dnes
// kiosk zobrazil ako nepochopené). Odvodené z `MaterialRow[]` (FFD `ffdPack`) — JEDEN riadok = JEDNA
// tyč s poradím rezov. Money-NEUTRÁLNE (žiadna cena; `kod` je profilový článkový kód, ktorý owner
// v ROZHODNUTÉ #529 chce vidieť — „kód profilu", nie cena).
import type { MaterialRow } from './compute';
import { maObrazok, obrazokUrl } from '$lib/profil-obrazky';

/** Verejná base URL appky pre absolútne odkazy na obrázky profilov (webp). */
const APP_PUBLIC_URL = (process.env.APP_PUBLIC_URL || 'https://app.montalu.cloud').replace(
	/\/+$/,
	''
);

/** Jeden v2 riadok = JEDNA tyč profilu s jej poradím rezov, uhlami, odpadom a (voliteľne) posuvom. */
export interface NarezakV2Line {
	/** Money článkový kód profilu (owner #529 „kód profilu"); '' keď neznámy (manuálny plán). */
	kod: string;
	nazov: string;
	/** poradie tyče v rámci profilu (1-based). */
	tyc_index: number;
	/** počet tyčí profilu spolu. */
	tyc_pocet: number;
	/** dĺžka tyče (mm). */
	tyc_dlzka_mm: number;
	/** dĺžky rezov v poradí na tyči (mm). */
	rezy_mm: number[];
	/** uhol ľavého/pravého rezu (° — 45 pri šikmom, 90 pri rovnom). */
	uhol_l: number;
	uhol_r: number;
	/** odpad (offcut) na konci tyče (mm). */
	odpad_mm: number;
	/** posuv (zimná záhrada) — len keď VŠETKY rezy tyče sú z jedného posuvu; inak vynechané. */
	posuv?: number;
	/** absolútna https URL na rez profilu (webp) — len keď máme obrázok. */
	profil_obrazok?: string;
}

/** Sumár per profil — rýchly prehľad (rezy/tyče/odpad) bez prechádzania všetkých tyčí. */
export interface NarezakV2Sumar {
	kod: string;
	nazov: string;
	/** počet rezov (kusov) spolu za profil. */
	rezy: number;
	/** počet tyčí. */
	tyce: number;
	/** odpad spolu za profil (mm). */
	odpad_mm: number;
	profil_obrazok?: string;
}

export interface NarezakV2 {
	lines: NarezakV2Line[];
	sumar: NarezakV2Sumar[];
}

/** Absolútna URL obrázka profilu, alebo undefined keď preň obrázok nemáme. */
function profilObrazokUrl(kod: string, baseUrl: string): string | undefined {
	return kod && maObrazok(kod) ? `${baseUrl}${obrazokUrl(kod)}` : undefined;
}

/** Uniformný posuv tyče (všetky rezy z jedného posuvu), alebo undefined (žiadny / zmiešaný). */
function uniformPosuv(kusy: { posuv?: number }[]): number | undefined {
	const set = new Set<number>();
	for (const k of kusy) if (k.posuv != null) set.add(k.posuv);
	return set.size === 1 ? [...set][0] : undefined;
}

/**
 * Postaví v2 payload z `MaterialRow[]` (FFD výstup s tyčami). Jeden `line` per TYČ (s poradím rezov,
 * uhlami, odpadom, obrázkom), + `sumar` per profil. Ráta LEN profily s aspoň jednou tyčou (rovnaká
 * množina ako grafický PDF). `baseUrl` prepíše default `APP_PUBLIC_URL` (pre testy).
 */
export function buildNarezakV2(
	material: MaterialRow[],
	baseUrl: string = APP_PUBLIC_URL
): NarezakV2 {
	const lines: NarezakV2Line[] = [];
	const sumar: NarezakV2Sumar[] = [];
	for (const m of material.filter((mm) => mm.tyce > 0)) {
		const uhol = (m.sikmyRez ?? true) ? 45 : 90;
		const obrazok = profilObrazokUrl(m.kod, baseUrl);
		let rezovSpolu = 0;
		m.bary.forEach((tyc, i) => {
			rezovSpolu += tyc.kusy.length;
			const posuv = uniformPosuv(tyc.kusy);
			lines.push({
				kod: m.kod,
				nazov: m.nazov,
				tyc_index: i + 1,
				tyc_pocet: m.tyce,
				tyc_dlzka_mm: m.barLen,
				rezy_mm: tyc.kusy.map((k) => k.rozmer),
				uhol_l: uhol,
				uhol_r: uhol,
				odpad_mm: Math.round(tyc.zvysok),
				...(posuv != null ? { posuv } : {}),
				...(obrazok ? { profil_obrazok: obrazok } : {})
			});
		});
		sumar.push({
			kod: m.kod,
			nazov: m.nazov,
			rezy: rezovSpolu,
			tyce: m.tyce,
			odpad_mm: Math.round(m.odpadMm),
			...(obrazok ? { profil_obrazok: obrazok } : {})
		});
	}
	return { lines, sumar };
}
