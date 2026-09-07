// Plán rezov — univerzálny optimalizátor (#482). Zoskupí rovnaké profily,
// pre každý spustí FFD bin-packing (reuse ffdPack z compute-model.ts),
// postav MaterialRow[] pre RozpisRezov.svelte. Money-NEUTRÁLNE: žiadny
// import z money, žiadny DB zápis, žiadne katalógové kódy — čistý výpočet.

import { ffdPack, type Kus, type MaterialRow, type Tyc } from '$lib/server/compute';
import type { PlanRezovRiadok, PlanRezovVstup } from './plan-rezov-vstup';

/** Výsledok per profil — pre grafický rozpis + sumár. */
export interface PlanRezovProfil {
	nazov: string;
	material: MaterialRow;
}

/** Celkový výsledok plánu rezov. */
export interface PlanRezovVysledok {
	/** per-profil výsledky (pre RozpisRezov) */
	profily: PlanRezovProfil[];
	/** celkový MaterialRow[] pre RozpisRezov (viac profilov = viac kariet) */
	material: MaterialRow[];
	dlzkaTyce: number;
	reznaMedzera: number;
	/** celkový počet tyčí naprieč profilmi */
	tyceSpolu: number;
	/** celkový odpad (mm) */
	odpadMm: number;
	/** celkový odpad (%) — vážený podľa materiálu */
	odpadPct: number;
	/** rezy, ktoré sú dlhšie ako tyč (aj s reznou medzerou) */
	tooLong: { nazov: string; dlzka: number }[];
	/** varovania pre používateľa */
	varovania: string[];
	/** počet preskočených riadkov vstupného parsera */
	preskocenych: number;
	/** prvé 3 preskočené riadky (pre info) */
	preskoceneUkazka: string[];
}

/** Zoskupí rovnaké profily (podľa PRESNÉHO názvu) a vráti multiset rezov × ks. */
function zoskupiProfily(riadky: PlanRezovRiadok[]): Map<string, { rezMm: number; ks: number }[]> {
	const mapa = new Map<string, { rezMm: number; ks: number }[]>();
	for (const r of riadky) {
		let bucket = mapa.get(r.nazov);
		if (!bucket) {
			bucket = [];
			mapa.set(r.nazov, bucket);
		}
		// hľadaj existujúci rez s rovnakou dĺžkou
		const existujuci = bucket.find((b) => b.rezMm === r.rezMm);
		if (existujuci) {
			existujuci.ks += r.ks;
		} else {
			bucket.push({ rezMm: r.rezMm, ks: r.ks });
		}
	}
	return mapa;
}

/** Spočítaj plán rezov pre všetky profily. */
export function spocitajPlanRezov(
	vstup: PlanRezovVstup,
	preskocene: string[] = []
): PlanRezovVysledok {
	const { dlzkaTyce, reznaMedzera, riadky } = vstup;
	const skupiny = zoskupiProfily(riadky);

	const profily: PlanRezovProfil[] = [];
	const tooLong: { nazov: string; dlzka: number }[] = [];
	let tyceSpolu = 0;
	let odpadMmSpolu = 0;
	const varovania: string[] = [];

	for (const [nazov, rezy] of skupiny) {
		// rozbaľ na jednotlivé kusy
		const kusy: Kus[] = [];
		for (const r of rezy) {
			for (let i = 0; i < r.ks; i++) {
				if (r.rezMm + reznaMedzera > dlzkaTyce) {
					tooLong.push({ nazov, dlzka: r.rezMm });
				} else {
					kusy.push({ rozmer: r.rezMm, dlzka: r.rezMm });
				}
			}
		}

		const bary: Tyc[] = ffdPack(kusy, dlzkaTyce, reznaMedzera);
		const tyce = bary.length;
		tyceSpolu += tyce;

		const odpadMm = Math.round(bary.reduce((s, b) => s + b.zvysok, 0));
		odpadMmSpolu += odpadMm;
		const odpadPct = tyce > 0 ? Math.round((odpadMm / (tyce * dlzkaTyce)) * 1000) / 10 : 0;

		// agregovaná tabuľka rezov (dĺžka → počet), zoradená zostupne
		const byDlzka = new Map<number, number>();
		for (const k of kusy) byDlzka.set(k.dlzka, (byDlzka.get(k.dlzka) ?? 0) + 1);
		const rezyAgg = [...byDlzka.entries()]
			.map(([rozmer, ks]) => ({ rozmer, ks }))
			.sort((a, b) => b.rozmer - a.rozmer);

		const mat: MaterialRow = {
			kod: '', // display-only, žiadne Money kódy
			nazov,
			rezy: rezyAgg,
			tyce,
			bary,
			odpadMm,
			odpadPct,
			barLen: dlzkaTyce,
			sikmyRez: false // generická tyč = rovný 90° rez
		};

		profily.push({ nazov, material: mat });
	}

	// tooLong varovania
	if (tooLong.length > 0) {
		const grouped = new Map<string, number[]>();
		for (const t of tooLong) {
			let bucket = grouped.get(t.nazov);
			if (!bucket) {
				bucket = [];
				grouped.set(t.nazov, bucket);
			}
			bucket.push(t.dlzka);
		}
		for (const [n, dlzky] of grouped) {
			const uniq = [...new Set(dlzky)].sort((a, b) => b - a);
			varovania.push(
				`${dlzky.length} kus(ov) profilu "${n}" je dlhších ako tyč ${dlzkaTyce} mm ` +
					`(aj s medzerou ${reznaMedzera} mm): ${uniq.join(', ')} mm.`
			);
		}
	}

	// preskočené riadky
	if (preskocene.length > 0) {
		varovania.push(`${preskocene.length} riadok(ov) nebolo rozpoznaných a boli preskočené.`);
	}

	const material = profily.map((p) => p.material);
	const celkovyMaterial = tyceSpolu * dlzkaTyce;
	const odpadPct =
		celkovyMaterial > 0 ? Math.round((odpadMmSpolu / celkovyMaterial) * 1000) / 10 : 0;

	return {
		profily,
		material,
		dlzkaTyce,
		reznaMedzera,
		tyceSpolu,
		odpadMm: odpadMmSpolu,
		odpadPct,
		tooLong,
		varovania,
		preskocenych: preskocene.length,
		preskoceneUkazka: preskocene.slice(0, 3)
	};
}
