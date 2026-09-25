// Sieťka Štandard / Štandard + — JEDEN geometrický model z rámu posuvu (#569, Patrik Odoo
// úloha 1070; owner ROZHODNUTÉ 25.9.2026 „ano tak aby sedela"). Čistý modul (client-safe,
// žiadny IO) — vstupom sú čísla, ktoré server vyčíta z cfg (`compute-sietka.ts`).
//
// PREČO NIE ZO SKLA: pôvodne sieťovina = sklo +3/+3 (#110). IZO sklo je o 23 × 20 mm menšie,
// lebo má rozširovací profil (ZASP202439) — ten do sieťky NEJDE, takže sieťka odvodená zo skla
// vyšla pri IZO o toľko malá (Patrik: „ak sieťku odvíja od skla a nie je tam ten profil tak je
// automaticky malá"). Sieťka sa preto odvíja od RÁMU posuvu (kladkový profil + výška posuvu).
//
// KRÍŽOVÁ KOMBINÁCIA (Patrik 1070): starý Štandard má koncový profil 38 + nos 33, plus
// Štandard 54,5 + nos 33 → pri tom istom kladkovom je plus rám o 16,5 mm širší. Aby vyšlo to
// isté okno, kladkový sieťky INÉHO systému než posuv sa posunie o K:
//   Š+ posuv + stará sieťka → +K (starý rám je užší, kladkový musí byť dlhší)
//   starý posuv + sieťka plus → −K (plus rám je širší, kladkový musí byť kratší)
// Issue 416 to čítal ako +16,5 v OBOCH smeroch — chybne (Patrikovo „+16" tam bola šírka
// SIEŤOVINY v opačnej bunke, nie kladkový).
//
// KONŠTANTY (editovateľné v /zasklenia/nastavenia, tabuľka `cfg_sietka_standard`, v50):
//   K = rozdiel kladkového pri kombinácii starý/plus Štandard (dnes 16,5 = 54,5 − 38)
//   R = šírka rámu sieťky nad kladkovým — sieťovina šírka = kladkový sieťky + R (dnes 17).
//       Odvodené z dát: pre KAŽDÝ Štandard/Štandard + štýl 2K–6K (aj IZO, aj opona) je
//       základné sklo presne o 14 mm širšie než kladkový (sklo.offset − kladkový.offset =
//       14·N), a sieťovina = sklo + 3 (Patrikov nárezák #110) → R = 17 pre každé N.
//   H = výška sieťoviny nad ZÁKLADNÝM (ne-IZO) sklom posuvu (dnes 3, Patrikov nárezák #110).

export interface SietkaStandardParams {
	/** K — rozdiel kladkového pri kombinácii starý/plus Štandard (mm) */
	k: number;
	/** R — šírka rámu sieťky nad kladkovým (mm) */
	r: number;
	/** H — výška sieťky nad základným sklom (mm) */
	h: number;
}

export type SietkaStandardKluc = keyof SietkaStandardParams;

/** Dnešné hodnoty — seed migrácie v50 aj default pre ručne postavené cfg (testy). */
export const SIETKA_STANDARD_SEED: Readonly<SietkaStandardParams> = Object.freeze({
	k: 16.5,
	r: 17,
	h: 3
});

/** Medze pre editor — preklep (169 namiesto 16,9) sa odmietne skôr, než sa zapíše. */
export const SIETKA_STANDARD_BOUNDS: Readonly<
	Record<SietkaStandardKluc, { min: number; max: number }>
> = Object.freeze({
	k: { min: 0, max: 50 },
	r: { min: 0, max: 100 },
	h: { min: -50, max: 50 }
});

/** Popisy pre editor aj audit (jeden zdroj textu). */
export const SIETKA_STANDARD_POPIS: Readonly<
	Record<SietkaStandardKluc, { label: string; help: string }>
> = Object.freeze({
	k: {
		label: 'K — rozdiel kladkového (starý / plus Štandard)',
		help: 'O koľko je kladkový sieťky dlhší (Štandard + posuv so starou sieťkou) alebo kratší (starý posuv so sieťkou plus) než kladkový posuvu. Pri rovnakom systéme sa nepoužije.'
	},
	r: {
		label: 'R — šírka rámu sieťky nad kladkovým',
		help: 'Šírka sieťoviny = kladkový sieťky + R.'
	},
	h: {
		label: 'H — výška sieťky nad základným sklom',
		help: 'Výška sieťoviny = výška základného (nie izolačného) skla posuvu + H. Izolačné sklo sieťku nemení.'
	}
});

export const SIETKA_STANDARD_KLUCE: readonly SietkaStandardKluc[] = ['k', 'r', 'h'];

/** Krížová delta kladkového sieťky voči posuvu (znamienko podľa smeru kombinácie). */
export function krizDelta(posuvSystem: string, sietkaSystem: string, k: number): number {
	if (posuvSystem === 'Štandard +' && sietkaSystem === 'Štandard') return k;
	if (posuvSystem === 'Štandard' && sietkaSystem === 'Štandard +') return -k;
	return 0;
}

export interface SietkaStandardVstup {
	/** kladkový profil POSUVU na jedno krídlo, NEZAOKRÚHLENÝ (mm) */
	kladkovyPosuv: number;
	/** výška ZÁKLADNÉHO (ne-IZO) skla posuvu, NEZAOKRÚHLENÁ (mm) */
	skloVZaklad: number;
	posuvSystem: string;
	sietkaSystem: string;
	params: SietkaStandardParams;
}

export interface SietkaStandardVystup {
	/** o koľko sa kladkový sieťky líši od kladkového posuvu */
	krizDelta: number;
	/** rozmer sieťoviny (objednávka u dodávateľa) — celé mm, zaokrúhlené RAZ na konci */
	sietovina: { sirka: number; vyska: number };
}

/** Rozmer sieťoviny + krížová delta kladkového — JEDINÝ vzorec sieťky Štandard. */
export function sietkaStandardRozmer(v: SietkaStandardVstup): SietkaStandardVystup {
	const delta = krizDelta(v.posuvSystem, v.sietkaSystem, v.params.k);
	return {
		krizDelta: delta,
		sietovina: {
			sirka: Math.round(v.kladkovyPosuv + delta + v.params.r),
			vyska: Math.round(v.skloVZaklad + v.params.h)
		}
	};
}
