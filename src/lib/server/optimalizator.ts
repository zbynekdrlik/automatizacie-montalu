// Nárezový optimalizátor (#212) — samostatná kalkulačka. Znovupoužíva existujúci
// bin-packing engine `ffdPack` (First-Fit-Decreasing) a vizuálny kontrakt
// `MaterialRow` z compute.ts. Žiadny Money odpis, žiadne katalógové kódy, žiadny
// DB zápis — čistý výpočet (display-only). Viď dizajn na #212.
import { ffdPack, type Kus, type MaterialRow, type Tyc } from '$lib/server/compute';
import type { OptimalizatorVstup } from './optimalizator-vstup';

export interface OptimalizatorVysledok {
	/** jedna „materiálová" karta pre grafický rozpis (RozpisRezov) */
	material: MaterialRow[];
	/** koľko tyčí engine reálne potreboval */
	tyceUsed: number;
	/** koľko tyčí používateľ zadal (na porovnanie) */
	pocetTyci: number;
	dlzkaTyce: number;
	reznaMedzera: number;
	/** koncový odpad (mm) = súčet zvyškov, rovnaký vzorec ako compute.ts */
	odpadMm: number;
	odpadPct: number;
	/** súčet dĺžok všetkých (zabalených) kusov (mm) */
	celkovaDlzkaKusov: number;
	/** dĺžky kusov, ktoré sa ani s reznou medzerou nezmestia na jednu tyč */
	tooLong: number[];
	/** upozornenia pre používateľa (slovenčina) */
	varovania: string[];
	/** true = všetky kusy sa zmestia do zadaného počtu tyčí a nič nie je príliš dlhé */
	vojdeSa: boolean;
}

/**
 * Optimalizuj nárez: rozbaľ kusy, oddeľ príliš dlhé, zabaľ zvyšok cez `ffdPack`
 * (s používateľovou reznou medzerou) a postav jeden `MaterialRow` pre grafický
 * rozpis rovnakým spôsobom ako /zasklenia.
 */
export function optimalizuj(v: OptimalizatorVstup): OptimalizatorVysledok {
	const { dlzkaTyce, pocetTyci, reznaMedzera } = v;

	// rozbaľ riadky na jednotlivé kusy; oddeľ tie, čo sa ani s reznou medzerou
	// nezmestia na tyč (inak by ffdPack dal záporný zvyšok)
	const kusy: Kus[] = [];
	const tooLong: number[] = [];
	for (const r of v.kusy) {
		for (let i = 0; i < r.pocet; i++) {
			if (r.dlzka + reznaMedzera > dlzkaTyce) tooLong.push(r.dlzka);
			else kusy.push({ rozmer: r.dlzka, dlzka: r.dlzka });
		}
	}

	const bary: Tyc[] = ffdPack(kusy, dlzkaTyce, reznaMedzera);
	const tyceUsed = bary.length;

	// odpad rovnakým vzorcom ako compute.ts (odpadMm/odpadPct)
	const odpadMm = Math.round(bary.reduce((s, b) => s + b.zvysok, 0));
	const odpadPct = tyceUsed > 0 ? Math.round((odpadMm / (tyceUsed * dlzkaTyce)) * 1000) / 10 : 0;

	// agregovaná tabuľka rezov (dĺžka → počet), zoradená zostupne
	const byDlzka = new Map<number, number>();
	for (const k of kusy) byDlzka.set(k.dlzka, (byDlzka.get(k.dlzka) ?? 0) + 1);
	const rezy = [...byDlzka.entries()]
		.map(([rozmer, ks]) => ({ rozmer, ks }))
		.sort((a, b) => b.rozmer - a.rozmer);

	const celkovaDlzkaKusov = kusy.reduce((s, k) => s + k.dlzka, 0);

	const material: MaterialRow[] =
		tyceUsed > 0
			? [
					{
						kod: '', // display-only, žiadne katalógové kódy
						nazov: `Tyč ${dlzkaTyce} mm`,
						rezy,
						tyce: tyceUsed,
						bary,
						odpadMm,
						odpadPct,
						barLen: dlzkaTyce,
						sikmyRez: false // generická tyč = rovný 90° rez
					}
				]
			: [];

	const varovania: string[] = [];
	if (tooLong.length > 0) {
		const uniq = [...new Set(tooLong)].sort((a, b) => b - a);
		varovania.push(
			`${tooLong.length} kus(ov) je dlhších ako tyč ${dlzkaTyce} mm ` +
				`(aj s reznou medzerou ${reznaMedzera} mm) — nedajú sa zarezať: ${uniq.join(', ')} mm.`
		);
	}
	if (tyceUsed > pocetTyci) {
		varovania.push(
			`Kusy sa nezmestia do zadaných ${pocetTyci} tyčí — potrebných je ${tyceUsed}.`
		);
	}

	const vojdeSa = tooLong.length === 0 && tyceUsed <= pocetTyci;

	return {
		material,
		tyceUsed,
		pocetTyci,
		dlzkaTyce,
		reznaMedzera,
		odpadMm,
		odpadPct,
		celkovaDlzkaKusov,
		tooLong,
		varovania,
		vojdeSa
	};
}
