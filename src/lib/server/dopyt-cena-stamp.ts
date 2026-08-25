// Opečiatkovanie ceny + typu HLADINY + verzie cenníka pri PODANÍ dopytu (#309, #318). Pri podaní sa
// vypočítaná cena (MO default, alebo VO ak podáva prihlásený veľkoobchodný b2b účet — `opeciatkujCenu`
// dostane hladinu z `dopyt-action`), typ hladiny (`cena_hladina`) a verzia cenníka ULOŽIA do `dopyt`
// riadka; re-download PDF potom reprodukuje cenu AJ hladinu PLATNÚ V ČASE PODANIA (nie prepočet zo
// živej matice). MONEY-NEUTRÁLNE: predajná cena (MO/VO), NIKDY Money kód. Súbor matchuje `/dopyt/`,
// takže je auto-krytý statickým guardom `tests/dopyt-money-safety.test.ts` (žiadny import money/pergola/`/data`).
import { CENNIK_VERZIA, cenaPreModel } from './konfigurator-cena';
import type { PonukaConfig } from '$lib/ponuka';
import type { ModelPergoly, VerejnaCena, CenovaHladina } from '$lib/konfigurator';

/** Orientačná cena z konfigurácie v danej HLADINE (LEN keď sú prítomné oba rozmery); inak `null`
 *  (honest-degrade — bez rozmerov cenu neurčíme). Zdieľané s `ponuka-pdf` (prepočet bez stampu).
 *  #318: `hladina` default `'MO'` → verejný/re-download prepočet ostáva MO (spätná kompatibilita);
 *  `'VO'` pri podaní od prihláseného veľkoobchodného účtu (cez `opeciatkujCenu`). */
export function cenaZCfg(cfg: PonukaConfig, hladina: CenovaHladina = 'MO'): VerejnaCena | null {
	if (!(cfg.sirka && cfg.sirka > 0) || !(cfg.hlbka && cfg.hlbka > 0)) return null;
	return cenaPreModel({ hlbkaMm: cfg.hlbka, sirkaMm: cfg.sirka, model: cfg.model }, hladina);
}

/** Pečiatka ceny na uloženie do `dopyt` (#309): vypočítaná verejná (MO) cena + verzia cenníka.
 *  `cena` je `null`, keď rozmery chýbajú (dopyt bez ceny) — verzia sa uloží aj tak (audit,
 *  z ktorej matice bol dopyt podaný). */
export interface CenaStamp {
	cena: VerejnaCena | null;
	cennikVerzia: string;
}

/** Opečiatkuj cenu pri podaní: spočíta cenu z cfg v danej HLADINE (#318 — default MO; VO pri
 *  podaní od prihláseného veľkoobchodného účtu) a priloží aktuálnu verziu cenníka. Typ hladiny
 *  sa opečiatkuje do `cena.hladina` (VO) → `stampNaStlpce` ho uloží do `cena_hladina`. */
export function opeciatkujCenu(cfg: PonukaConfig, hladina: CenovaHladina = 'MO'): CenaStamp {
	return { cena: cenaZCfg(cfg, hladina), cennikVerzia: CENNIK_VERZIA };
}

/** Uložené cenové stĺpce `dopyt` riadka (migrácia v30, #318 rozšírené o `cena_hladina` v32).
 *  `cena_druh === null` = neopečiatkovaný (starý) riadok. `cennik_verzia` môže byť prítomná aj bez
 *  ceny (dopyt bez rozmerov). `cena_hladina === 'VO'` = veľkoobchodná pečiatka; `null` = MO/starý. */
export interface DopytCenaStlpce {
	cena_druh: string | null;
	cena_bez_dph: number | null;
	cena_s_dph: number | null;
	cena_hlbka_grid_m: number | null;
	cena_sirka_grid_m: number | null;
	cena_model: string | null;
	cennik_verzia: string | null;
	cena_hladina: string | null;
}

/** Rozlož pečiatku (`CenaStamp`) na uložiteľné stĺpce `dopyt` (v30). Bez stampu → všetko NULL
 *  (neopečiatkovaný riadok). Cena `null` (bez rozmerov) → cena_* NULL, ale verzia sa uloží.
 *  `individualna-ponuka` → cenové sumy NULL, `cena_druh`+`cena_model`+verzia. */
export function stampNaStlpce(stamp?: CenaStamp): DopytCenaStlpce {
	if (!stamp) {
		return {
			cena_druh: null,
			cena_bez_dph: null,
			cena_s_dph: null,
			cena_hlbka_grid_m: null,
			cena_sirka_grid_m: null,
			cena_model: null,
			cennik_verzia: null,
			cena_hladina: null
		};
	}
	const { cena, cennikVerzia } = stamp;
	if (cena === null) {
		return {
			cena_druh: null,
			cena_bez_dph: null,
			cena_s_dph: null,
			cena_hlbka_grid_m: null,
			cena_sirka_grid_m: null,
			cena_model: null,
			cennik_verzia: cennikVerzia,
			cena_hladina: null
		};
	}
	// #318: `cena.hladina` je 'VO' iba pri veľkoobchodnej pečiatke; MO cenu `naCenu` nechá bez
	// poľa → `?? null` uloží NULL (spätne kompatibilné so starými/MO riadkami).
	if (cena.druh === 'cena') {
		return {
			cena_druh: 'cena',
			cena_bez_dph: cena.bezDph,
			cena_s_dph: cena.sDph,
			cena_hlbka_grid_m: cena.hlbkaGridM,
			cena_sirka_grid_m: cena.sirkaGridM,
			cena_model: cena.model,
			cennik_verzia: cennikVerzia,
			cena_hladina: cena.hladina ?? null
		};
	}
	return {
		cena_druh: 'individualna-ponuka',
		cena_bez_dph: null,
		cena_s_dph: null,
		cena_hlbka_grid_m: null,
		cena_sirka_grid_m: null,
		cena_model: cena.model,
		cennik_verzia: cennikVerzia,
		cena_hladina: cena.hladina ?? null
	};
}

/** Zrekonštruuj `VerejnaCena` z uložených stĺpcov dopyt riadka (#309). `null` = riadok nie je
 *  opečiatkovaný (starý dopyt / dopyt bez rozmerov) → volajúci (regen) prepočíta zo živej matice
 *  (honest-degrade; historickú cenu, ktorú sme nikdy neuložili, nedopĺňame). `dovod` sa pri
 *  `individualna-ponuka` neukladá (PDF ho nevykresľuje — reprodukcia dokumentu ho nepotrebuje). */
export function cenaZoStampu(row: DopytCenaStlpce): VerejnaCena | null {
	// neopečiatkovaný riadok (alebo obranne: opečiatkovaný bez modelu) → null = prepočet zo živej
	if (row.cena_druh === null || row.cena_model === null) return null;
	const model = row.cena_model as ModelPergoly;
	// #318: rekonštruuj hladinu z `cena_hladina` — 'VO' pole doplní (label „veľkoobchod"), inak
	// (NULL/'MO' = starý/MO riadok) sa `hladina` NEnastaví (byte-identicky s pôvodným MO tvarom).
	const vo = row.cena_hladina === 'VO' ? { hladina: 'VO' as const } : {};
	if (row.cena_druh === 'cena') {
		// opečiatkovaný 'cena' riadok má VŽDY vyplnené sumy+grid (`stampNaStlpce` ich píše spolu).
		// Ak by niektorá chýbala (poškodený riadok), NEDEGRADUJ ticho na 0 € — vráť null a nechaj
		// volajúceho prepočítať zo živej matice (čestný fallback, nie klamlivá 0 € cena; #309 review).
		if (
			row.cena_bez_dph === null ||
			row.cena_s_dph === null ||
			row.cena_hlbka_grid_m === null ||
			row.cena_sirka_grid_m === null
		)
			return null;
		return {
			druh: 'cena',
			model,
			bezDph: row.cena_bez_dph,
			sDph: row.cena_s_dph,
			hlbkaGridM: row.cena_hlbka_grid_m,
			sirkaGridM: row.cena_sirka_grid_m,
			...vo
		};
	}
	return { druh: 'individualna-ponuka', model, dovod: '', ...vo };
}
