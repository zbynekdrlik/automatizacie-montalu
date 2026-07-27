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
 * `sysStyl` pre výpočet. V štandardových systémoch sa „ IZO" pripája podľa SKLA, nie
 * podľa štýlu — takže aj starý uložený štýl „4K IZO" sa najprv zredukuje na „4K" a IZO
 * variant sa nasadí len vtedy, keď je zvolené izolačné sklo A taký nárezák existuje.
 */
export function sysStylPre(
	system: string,
	styl: string,
	sklo: string,
	existuje: ExistujeSysStyl
): string {
	if (!skloVyberaIzo(system)) return `${system}|${styl}`;
	const base = `${system}|${zakladnyStyl(styl)}`;
	const izo = `${base} IZO`;
	return jeIzoSklo(sklo) && existuje(izo) ? izo : base;
}

/** Štýly do ponuky: štandardy ukážu len počty krídel (IZO variant vyberá sklo). */
export function stylyDoPonuky(system: string, styly: string[]): string[] {
	if (!skloVyberaIzo(system)) return styly;
	return [...new Set(styly.map(zakladnyStyl))];
}

/** Sklá do ponuky: izolačné len tam, kde pre daný štýl IZO nárezák existuje. */
export function sklaDoPonuky(
	system: string,
	styl: string,
	skla: string[],
	existuje: ExistujeSysStyl
): string[] {
	if (!skloVyberaIzo(system)) return skla;
	if (existuje(`${system}|${zakladnyStyl(styl)} IZO`)) return skla;
	return skla.filter((g) => !jeIzoSklo(g));
}
