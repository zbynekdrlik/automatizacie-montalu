// RAL farebná logika pre návrhové výkresy (#137+) — vyextrahované z
// `pergola-navrh.ts` (#162, druhý konzument): generická, nie-pergolová farebná
// logika patrí do `$lib/vykres/`, rovnaký precedens ako `iso.ts` (viď jeho
// hlavičkový komentár — "znovupoužiteľný … nie je pergola-špecifický, žije preto
// v `$lib/vykres/`"). `pergola-navrh.ts` re-exportuje všetko odtiaľto pod
// pôvodnými menami, takže existujúce importy sa NEMENIA.

/** Režim výkresu — technický (čiernobiely) alebo farebný podľa zvoleného RAL.
 *  Kóty/poznámky/raster/pečiatka sa NIKDY nefarbia — len konštrukcia. */
export type VykresRezim = 'technicky' | 'farebny';
export const VYKRES_REZIM_DEFAULT: VykresRezim = 'technicky';

export interface RalOdtien {
	/** kód z dropdownu, napr. "7016" — NIE je to plné RAL číslo (RAL 7016), len
	 *  interná hodnota `<option>` / `ralKod` */
	kod: string;
	nazov: string;
	hex: string;
	/** svetlé odtiene (9010 BIELA, 9006 STRIEBORNÁ) by sa na bielom hárku bez
	 *  ďalšieho obrysu strácali — tenký tmavý obrys */
	tmavyObrys: boolean;
}

/** Firemná paleta bežných RAL odtieňov. "iný…" (voľný text) NIE JE v tomto
 *  zozname — je to sentinel `RAL_INY_KOD` riešený osobitne cez `farbaKonstrukcie`
 *  fallback nižšie. */
export const RAL_PALETA: RalOdtien[] = [
	{ kod: '7016', nazov: 'ANTRACIT', hex: '#383E42', tmavyObrys: false },
	{ kod: '9006', nazov: 'STRIEBORNÁ', hex: '#A5A8A6', tmavyObrys: true },
	{ kod: '9010', nazov: 'BIELA', hex: '#F1EDE1', tmavyObrys: true },
	{ kod: '8014', nazov: 'HNEDÁ', hex: '#382C1E', tmavyObrys: false },
	{ kod: '9005', nazov: 'ČIERNA', hex: '#0E0E10', tmavyObrys: false }
];

/** sentinel hodnota `ralKod` pre „iný…" (voľný text) v dropdowne */
export const RAL_INY_KOD = 'iny';

/** neutrálna tmavosivá pre neznámy/vlastný RAL — vtedy farebný režim použije
 *  neutrálnu tmavosivú a povie to. Nikdy natvrdo predstieraný presný odtieň,
 *  ktorý appka nepozná. */
export const RAL_FALLBACK_HEX = '#4b5563';

export interface FarbaKonstrukcie {
	hex: string;
	tmavyObrys: boolean;
}

/** Farba konštrukcie pre farebný režim — nájde odtieň v `RAL_PALETA` podľa kódu.
 *  Neznámy kód (vrátane `RAL_INY_KOD` a prázdneho reťazca „nič nevybraté") vráti
 *  čestný neutrálny fallback, nikdy predstieraný presný odtieň. */
export function farbaKonstrukcie(ralKod: string): FarbaKonstrukcie {
	const vzorka = RAL_PALETA.find((r) => r.kod === ralKod);
	if (vzorka) return { hex: vzorka.hex, tmavyObrys: vzorka.tmavyObrys };
	return { hex: RAL_FALLBACK_HEX, tmavyObrys: false };
}

/** Zmieša hex farbu s čiernou o `faktor` (0..1) — pre stmavenie svetlých odtieňov. */
function tmavsia(hex: string, faktor: number): string {
	const n = parseInt(hex.slice(1), 16);
	const zloz = (posun: number) => {
		const c = Math.round(((n >> posun) & 255) * (1 - faktor));
		return c.toString(16).padStart(2, '0');
	};
	return `#${zloz(16)}${zloz(8)}${zloz(0)}`;
}

/** Stroke farba pre ČIAROVÉ prvky bez fill (napr. drôtený model) — na rozdiel od
 *  vyplnených tvarov (tie majú svoj CIERNA `stroke` nezmenený, čo im dáva rovnaký
 *  "tenký tmavý obrys" zadarmo) tu žiadny existujúci obrys nie je, takže pri
 *  svetlom RAL (`tmavyObrys`) sa farba pred použitím ako stroke stmaví, nech čiara
 *  na bielom hárku nezmizne. Tmavé odtiene sa nemenia. */
export function ciarovaFarba(f: FarbaKonstrukcie): string {
	return f.tmavyObrys ? tmavsia(f.hex, 0.55) : f.hex;
}
