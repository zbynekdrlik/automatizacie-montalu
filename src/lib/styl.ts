// Ktorý nárezák (`sysStyl`) sa má ťahať pre zvolenú kombináciu systém + štýl + sklo.
//
// Patrik 2026-07-27: „si dám štandard + zvolím si príklad 4K IZO (ide o to že to má
// byť izo) a pri výbere skla mi ponúkne 4, 6, 10 mm sklo… najlepšie by bolo ako pri
// SLIDE, že si zvolím počet okien a podľa výberu skla mi určí, ktorý nárezák to bude
// ťahať." → v štandardových systémoch nesie štýl LEN POČET KRÍDEL (2K…6K, opona
// 2x2K…) a o tom, či sa počíta basic alebo IZO variant, rozhoduje ZVOLENÉ SKLO.
// Predtým sa IZO vyberalo štýlom a formulár k štýlu „4K IZO" pokojne ponúkol
// jednoduché Float 4/6/10 mm (a naopak k „4K" izolačné) — dve nezávislé voľby, ktoré
// si mohli odporovať.
//
// Ktoré IZO varianty EXISTUJÚ sa nehádže do kódu — pýta sa to konfigurácie
// (`existuje`): Štandard + IZO oponu nemá, starší Štandard áno. Robust / Slide /
// Deluxe sú 1:1 so štýlom, presne ako doteraz.
//
// Money: tento modul mení len to, KTORÁ z už existujúcich konfigurácií sa použije.
// Žiadny vzorec ani kód profilu sa nemení.

export const STANDARD_PLUS = 'Štandard +';
export const STANDARD = 'Štandard';
/** Systémy, kde IZO/basic nárezák vyberá SKLO (nie štýl). */
export const SYSTEMY_SKLO_VYBERA_IZO = [STANDARD_PLUS, STANDARD];

/** Existuje daný `sysStyl` v konfigurácii? (klient z `data.styly`, server z cfg) */
export type ExistujeSysStyl = (sysStyl: string) => boolean;

/** Izolačná skladba („Izolačné sklo 4.8.4"). */
export function jeIzoSklo(sklo: string): boolean {
	return /izola[čc]n/i.test(sklo);
}

/** Lookup „meno skla → trieda skladby" (#443) — server má glass record priamo
 *  (`skloPre`), klient ho stavia z `data.skla`. */
export type TriedaZaNazov = (nazov: string) => 6 | 16 | null;

/**
 * Je toto sklo IZO-skladba? (#443) — TRIEDA (6 mm / 16 mm) je teraz PRIMÁRNY zdroj
 * pravdy: `trieda === 16` ⇒ IZO, `trieda === 6` ⇒ basic. Meno-regex `jeIzoSklo` je
 * FALLBACK len pre neklasifikované sklo (`trieda == null` — Robust/Deluxe/'ALL', alebo
 * ešte-neklasifikovaný Odoo import). Pre všetky dnešné klasifikované sklá dáva trieda
 * ROVNAKÝ výsledok ako regex (parity test #443) — rozdiel sa prejaví len na NOVOM
 * Odoo dvojskle, ktorého názov by regex uhádol nesprávne.
 */
export function jeIzoTrieda(trieda: 6 | 16 | null | undefined, nazov: string): boolean {
	return trieda != null ? trieda === 16 : jeIzoSklo(nazov);
}

/** Štýl bez prípony „ IZO" — v ponuke je len počet krídel. */
export function zakladnyStyl(styl: string): string {
	return styl.replace(/\s*IZO\s*$/i, '').trim();
}

/** Opona = dvojitý systém („2x…"). */
export function jeOponaStyl(styl: string): boolean {
	return styl.startsWith('2x');
}

/** Vyberá v tomto systéme basic/IZO nárezák sklo? */
export function skloVyberaIzo(system: string): boolean {
	return SYSTEMY_SKLO_VYBERA_IZO.includes(system);
}

/**
 * Pôvodný gate LEN pre Štandard + (#134) — zachovaný pre `pridavnaKolajnicaDefault`
 * (auto-default IZO ostáva len pre Štandard +, Patrik msg #1646652).
 * Pre VIDITEĽNOSŤ checkboxu a pre `railUpsize` používaj `plusRailEligible` (#456).
 */
export function standardPlusRailEligible(system: string, styl: string): boolean {
	return system === STANDARD_PLUS && !styl.startsWith('6K');
}

/**
 * Najvyššia K veľkosť koľajnice, pre ktorú +1 variant NEEXISTUJE v Money.
 * Checkbox sa pre tento (a vyšší) štýl NEZOBRAZÍ — presne rovnaká logika
 * ako pôvodný `!styl.startsWith('6K')` u Štandardu +, len per systém.
 *
 * Slide: 3K Slide (ZASP00100) → 4K Slide neexistuje
 * Robust: 4K (ZASP20254) → 5K Robust neexistuje
 * Štandard +/Deluxe: 6K (ZASP202437) → 7K neexistuje
 */
const RAIL_MAX_K: Record<string, string> = {
	'Štandard +': '6K',
	Deluxe: '6K',
	Slide: '3K',
	Robust: '4K'
};

/** Systémy s jednou obvodovou koľajnicou (nie horná + spodná). */
export const SYSTEMY_OBVODOVA = new Set(['Slide', 'Robust']);

/**
 * Je tento systém + štýl spôsobilý pre checkbox „Prídavná koľajnica"?
 * Generalizácia pôvodného `standardPlusRailEligible` (#134) na Slide, Deluxe
 * a Robust (#456). Gate pre VIDITEĽNOSŤ checkboxu aj pre `railUpsize` swap.
 *
 * K-level sa extrahuje aj z opona štýlov: 2x3K → 3K (koľajnica je podľa
 * čísla za 2x). IZO prípona sa ignoruje (`zakladnyStyl`).
 */
export function plusRailEligible(system: string, styl: string): boolean {
	const maxK = RAIL_MAX_K[system];
	if (!maxK) return false;
	// 2x3K → 3K, 3K IZO → 3K
	const k = zakladnyStyl(styl).replace(/^2x/, '');
	return k !== maxK;
}

/**
 * Má sa checkbox „Prídavná koľajnica" predvyplniť zaškrtnutý? (#132, Patrik —
 * Odoo 207, msg #1646652, 2026-08-09: „my vždy dávame pri štandardoch IZO
 * spodnú koľaj navyše ale iba spodnú"). DEFAULT, nie vynútenie — obsluha ho
 * môže kedykoľvek odškrtnúť; MENÍ Money odpis (railUpsize v compute.ts:
 * ZASP00104→ZASP00030 na 2K, ZASP00030→ZASP00033 na 3K).
 *
 * Platí len tam, kde checkbox vôbec EXISTUJE — rovnaký `standardPlusRailEligible`
 * gate ako viditeľnosť checkboxu v +page.svelte A `railUpsize` v compute.ts (#134).
 * IZO stav berie z `jeIzoSklo` — z toho istého zdroja pravdy, ktorý používa
 * `sysStylPre` na výber basic/IZO nárezáku, žiadny vlastný zoznam skiel.
 *
 * Reaktívne volanie (kedy sa táto hodnota naozaj premietne do checkboxu —
 * HRANOVO, nie „vždy keď true", aby neprepísala ručný klik obsluhy) je v
 * `src/routes/zasklenia/+page.svelte`, `pridavnaKolajnicaOdporucana` +
 * susedný `$effect`.
 */
export function pridavnaKolajnicaDefault(
	system: string,
	styl: string,
	sklo: string,
	trieda?: 6 | 16 | null
): boolean {
	return standardPlusRailEligible(system, styl) && jeIzoTrieda(trieda, sklo);
}

/**
 * `sysStyl` pre výpočet. V štandardových systémoch sa „ IZO" pripája podľa SKLA, nie
 * podľa štýlu — takže aj starý uložený štýl „4K IZO" sa najprv zredukuje na „4K" a IZO
 * variant sa nasadí len vtedy, keď je zvolené izolačné sklo A taký nárezák existuje.
 */
export function sysStylPre(
	system: string,
	styl: string,
	sklo: string,
	existuje: ExistujeSysStyl,
	trieda?: 6 | 16 | null
): string {
	if (!skloVyberaIzo(system)) return `${system}|${styl}`;
	const base = `${system}|${zakladnyStyl(styl)}`;
	const izo = `${base} IZO`;
	return jeIzoTrieda(trieda, sklo) && existuje(izo) ? izo : base;
}

/** Štýly do ponuky: štandardy ukážu len počty krídel (IZO variant vyberá sklo). */
export function stylyDoPonuky(system: string, styly: string[]): string[] {
	if (!skloVyberaIzo(system)) return styly;
	return [...new Set(styly.map(zakladnyStyl))];
}

/** Sklá do ponuky: izolačné len tam, kde pre daný štýl IZO nárezák existuje.
 *  `triedaZa` (#443) — voliteľný lookup „meno skla → trieda", ktorý IZO-nosť rozhoduje
 *  primárne cez triedu (regex `jeIzoSklo` len pre neklasifikované/chýbajúce meno). */
export function sklaDoPonuky(
	system: string,
	styl: string,
	skla: string[],
	existuje: ExistujeSysStyl,
	triedaZa?: TriedaZaNazov
): string[] {
	if (!skloVyberaIzo(system)) return skla;
	if (existuje(`${system}|${zakladnyStyl(styl)} IZO`)) return skla;
	return skla.filter((g) => !jeIzoTrieda(triedaZa?.(g), g));
}
