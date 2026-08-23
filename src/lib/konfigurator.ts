// Verejný zákaznícky konfigurátor pergoly (#275, fáza 1) — ČISTÝ výpočtový modul.
// Display-only, BEZ CIEN, BEZ Money kódov, BEZ nárezu. Znovupoužíva geometriu z
// `pergola-navrh.ts` (sklon, svetlá výška) — importuje LEN geometrické funkcie/
// konštanty, NIKDY katalóg strešného skla (`sklo-strecha.ts` nesie Money kód).
// Vstupy sú primitíva (názvy skla/farby prídu ako reťazce), takže tento modul sa
// nikdy nedotkne Money kód a je bezpečný aj pre klientsky bundle (client-safe:
// žiadne server/DB/Money závislosti) → priamo unit-testovateľný. Súčasť #280.

import { vypocitajSklon, NOSNIK_HRUBKA_MM, VYSKA_MAX } from '$lib/pergola-navrh';

// Zákaznícke rozmedzia — zámerná PODMNOŽINA rozmedzí enginu `pergola-navrh` (každá
// hodnota v nich je preto bezpečne validná aj pre engine). Šírka/hĺbka sú užšie než
// engine (zákaznícka pergola má rozumné rozmery), výška vpredu je nad hrúbkou nosníka
// (→ svetlá výška > 0). Dopočítaná výška pri stene sa validuje voči `VYSKA_MAX` enginu.
export const KONF_SIRKA_MIN = 2000;
export const KONF_SIRKA_MAX = 12000;
export const KONF_HLBKA_MIN = 1500;
export const KONF_HLBKA_MAX = 6000;
export const KONF_VYSKA_MIN = 2000; // výška vpredu; > NOSNIK_HRUBKA_MM (190) → svetlá výška > 0
export const KONF_VYSKA_MAX = 4000;
export const KONF_SKLON_MIN = 0;
export const KONF_SKLON_MAX = 30;
/** Dopočítaná výška pri stene nesmie prekročiť konštrukčné maximum enginu — priame
 *  rozmedzie `pergola-navrh` (VYSKA_MAX). Dolná hranica netreba: výška vpredu je vždy
 *  ≥ KONF_VYSKA_MIN (2000) a stena ≥ výška vpredu, takže nikdy neklesne pod VYSKA_MIN. */
export const KONF_VYSKA_STENA_MAX = VYSKA_MAX;

/** Rozmedzia pre klienta (input min/max hinty) — žiadny Money údaj. */
export const KONF_RANGES = {
	sirka: { min: KONF_SIRKA_MIN, max: KONF_SIRKA_MAX },
	hlbka: { min: KONF_HLBKA_MIN, max: KONF_HLBKA_MAX },
	vyskaVpredu: { min: KONF_VYSKA_MIN, max: KONF_VYSKA_MAX },
	sklon: { min: KONF_SKLON_MIN, max: KONF_SKLON_MAX }
} as const;

export interface KonfiguratorVstup {
	/** celková šírka pergoly [mm] */
	sirka: number;
	/** hĺbka [mm] */
	hlbka: number;
	/** výška vpredu (k stĺpom) [mm] */
	vyskaVpredu: number;
	/** sklon strechy [°] — pultová (lean-to) pergola, stena je vyššia */
	sklonDeg: number;
	/** názov typu strešného skla (validovaný voči katalógu v parseri) — BEZ Money kód */
	sklo: string;
	/** farba konštrukcie ako display label, napr. „RAL 7016 ANTRACIT" */
	farba: string;
}

export interface KonfiguratorSuhrn {
	sirka: number;
	hlbka: number;
	vyskaVpredu: number;
	/** dopočítaná výška pri stene [mm] = vpredu + tan(sklon)·hĺbka */
	vyskaPriStene: number;
	/** sklon strechy [°] (z enginu, konzistentný s dopočítanou výškou pri stene) */
	sklonDeg: number;
	/** svetlá výška (clearance) vpredu [mm] = vpredu − hrúbka nosníka */
	svetlaVyska: number;
	/** zastrešená pôdorysná plocha [m²] */
	zastresenaPlochaM2: number;
	/** názov typu strešného skla (BEZ ceny, BEZ Money kód) */
	sklo: string;
	/** farba konštrukcie (display label) */
	farba: string;
}

const R1 = (x: number) => Math.round(x * 10) / 10;

/** Dopočítaná výška pri stene [mm] — pultová strecha stúpa k stene o tan(sklon)·hĺbka. */
export function vyskaPriStene(vyskaVpredu: number, sklonDeg: number, hlbka: number): number {
	return R1(vyskaVpredu + Math.tan((sklonDeg * Math.PI) / 180) * hlbka);
}

/** Zastrešená pôdorysná plocha [m²] zo šírky a hĺbky [mm], zaokrúhlená na 1 desatinu. */
export function zastresenaPlocha(sirka: number, hlbka: number): number {
	return Math.round(((sirka * hlbka) / 1_000_000) * 10) / 10;
}

/** Zostaví zákaznícky súhrn konfigurácie (display-only). Sklon sa recalibruje cez engine
 *  `vypocitajSklon` z dopočítanej výšky pri stene → jeden zdroj pravdy, konzistentný so
 *  zvyškom appky (round-trip späť na zadaný sklon v rámci zaokrúhlenia). */
export function konfiguruj(v: KonfiguratorVstup): KonfiguratorSuhrn {
	const stena = vyskaPriStene(v.vyskaVpredu, v.sklonDeg, v.hlbka);
	return {
		sirka: v.sirka,
		hlbka: v.hlbka,
		vyskaVpredu: v.vyskaVpredu,
		vyskaPriStene: stena,
		sklonDeg: R1(vypocitajSklon(v.vyskaVpredu, stena, v.hlbka)),
		svetlaVyska: Math.max(0, R1(v.vyskaVpredu - NOSNIK_HRUBKA_MM)),
		zastresenaPlochaM2: zastresenaPlocha(v.sirka, v.hlbka),
		sklo: v.sklo,
		farba: v.farba
	};
}
