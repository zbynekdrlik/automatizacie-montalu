// Opečiatkovanie orientačnej ceny + verzie cenníka pri PODANÍ dopytu (#309). Pri podaní sa
// vypočítaná MO cena a verzia cenníka ULOŽIA do `dopyt` riadka; re-download PDF potom
// reprodukuje cenu PLATNÚ V ČASE PODANIA (nie prepočet zo živej matice, ktorá sa medzitým
// zmenila). MONEY-NEUTRÁLNE: LEN maloobchod (MO) cez `naVerejnuCenu` (VO strip) — žiadna VO
// cena, žiadny Money kód. Súbor matchuje `/dopyt/`, takže je auto-krytý statickým guardom
// `tests/dopyt-money-safety.test.ts` (žiadny import money/pergola/`/data`).
import { CENNIK_VERZIA, verejnaCenaPreModel } from './konfigurator-cena';
import type { PonukaConfig } from '$lib/ponuka';
import type { ModelPergoly, VerejnaCena } from '$lib/konfigurator';

/** Orientačná cena z konfigurácie (LEN keď sú prítomné oba rozmery); inak `null`
 *  (honest-degrade — bez rozmerov cenu neurčíme). Zdieľané s `ponuka-pdf` (prepočet bez stampu).
 *  VO sa nikdy nepočíta — `verejnaCenaPreModel` vracia LEN MO. */
export function cenaZCfg(cfg: PonukaConfig): VerejnaCena | null {
	if (!(cfg.sirka && cfg.sirka > 0) || !(cfg.hlbka && cfg.hlbka > 0)) return null;
	return verejnaCenaPreModel({ hlbkaMm: cfg.hlbka, sirkaMm: cfg.sirka, model: cfg.model });
}

/** Pečiatka ceny na uloženie do `dopyt` (#309): vypočítaná verejná (MO) cena + verzia cenníka.
 *  `cena` je `null`, keď rozmery chýbajú (dopyt bez ceny) — verzia sa uloží aj tak (audit,
 *  z ktorej matice bol dopyt podaný). */
export interface CenaStamp {
	cena: VerejnaCena | null;
	cennikVerzia: string;
}

/** Opečiatkuj cenu pri podaní: spočíta verejnú MO cenu z cfg a priloží aktuálnu verziu cenníka. */
export function opeciatkujCenu(cfg: PonukaConfig): CenaStamp {
	return { cena: cenaZCfg(cfg), cennikVerzia: CENNIK_VERZIA };
}

/** Uložené cenové stĺpce `dopyt` riadka (migrácia v30). `cena_druh === null` = neopečiatkovaný
 *  (starý) riadok. `cennik_verzia` môže byť prítomná aj bez ceny (dopyt bez rozmerov). */
export interface DopytCenaStlpce {
	cena_druh: string | null;
	cena_bez_dph: number | null;
	cena_s_dph: number | null;
	cena_hlbka_grid_m: number | null;
	cena_sirka_grid_m: number | null;
	cena_model: string | null;
	cennik_verzia: string | null;
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
			cennik_verzia: null
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
			cennik_verzia: cennikVerzia
		};
	}
	if (cena.druh === 'cena') {
		return {
			cena_druh: 'cena',
			cena_bez_dph: cena.bezDph,
			cena_s_dph: cena.sDph,
			cena_hlbka_grid_m: cena.hlbkaGridM,
			cena_sirka_grid_m: cena.sirkaGridM,
			cena_model: cena.model,
			cennik_verzia: cennikVerzia
		};
	}
	return {
		cena_druh: 'individualna-ponuka',
		cena_bez_dph: null,
		cena_s_dph: null,
		cena_hlbka_grid_m: null,
		cena_sirka_grid_m: null,
		cena_model: cena.model,
		cennik_verzia: cennikVerzia
	};
}

/** Zrekonštruuj `VerejnaCena` z uložených stĺpcov dopyt riadka (#309). `null` = riadok nie je
 *  opečiatkovaný (starý dopyt / dopyt bez rozmerov) → volajúci (regen) prepočíta zo živej matice
 *  (honest-degrade; historickú cenu, ktorú sme nikdy neuložili, nedopĺňame). `dovod` sa pri
 *  `individualna-ponuka` neukladá (PDF ho nevykresľuje — reprodukcia dokumentu ho nepotrebuje). */
export function cenaZoStampu(row: DopytCenaStlpce): VerejnaCena | null {
	if (row.cena_druh === null) return null;
	const model = (row.cena_model ?? 'LIGHT') as ModelPergoly;
	if (row.cena_druh === 'cena') {
		return {
			druh: 'cena',
			model,
			bezDph: row.cena_bez_dph ?? 0,
			sDph: row.cena_s_dph ?? 0,
			hlbkaGridM: row.cena_hlbka_grid_m ?? 0,
			sirkaGridM: row.cena_sirka_grid_m ?? 0
		};
	}
	return { druh: 'individualna-ponuka', model, dovod: '' };
}
