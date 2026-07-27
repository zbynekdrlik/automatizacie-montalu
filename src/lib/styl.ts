// Ktorý nárezák (`sysStyl`) sa má ťahať pre zvolenú kombináciu systém + štýl + sklo.
//
// Patrik 2026-07-27: „si dám štandard + zvolím si príklad 4K IZO (ide o to že to má
// byť izo) a pri výbere skla mi ponúkne 4, 6, 10 mm sklo… najlepšie by bolo ako pri
// SLIDE, že si zvolím počet okien a podľa výberu skla mi určí, ktorý nárezák to bude
// ťahať." → v systéme **Štandard +** nesie štýl LEN POČET KRÍDEL (2K…6K, opona
// 2x2K…2x4K) a o tom, či sa počíta basic alebo IZO variant, rozhoduje ZVOLENÉ SKLO.
// Predtým sa IZO vyberalo štýlom a formulár k štýlu „4K IZO" pokojne ponúkol
// jednoduché Float 4/6/10 mm (a naopak k „4K" izolačné) — dve nezávislé voľby, ktoré
// si mohli odporovať.
//
// Ostatné systémy (Robust / Slide / Deluxe) sa NEMENIA — ich `sysStyl` je 1:1 so
// štýlom, presne ako doteraz.
//
// Money: tento modul mení len to, KTORÁ z už existujúcich konfigurácií sa použije.
// Žiadny vzorec ani kód profilu sa nemení.

export const STANDARD = 'Štandard +';

/** Izolačná skladba (Štandard + „Izolačné sklo 4.8.4"). */
export function jeIzoSklo(sklo: string): boolean {
	return /izola[čc]n/i.test(sklo);
}

/** Štýl bez prípony „ IZO" — v ponuke Štandard + je len počet krídel. */
export function zakladnyStyl(styl: string): string {
	return styl.replace(/\s*IZO\s*$/i, '').trim();
}

/** Opona = dvojitý systém („2x…"); IZO skladbu nemá (spec: opona = Float 4 mm). */
export function jeOponaStyl(styl: string): boolean {
	return styl.startsWith('2x');
}

/**
 * `sysStyl` pre výpočet. Pri Štandard + sa „ IZO" pripája podľa SKLA, nie podľa
 * štýlu — takže aj starý uložený štýl „4K IZO" sa najprv zredukuje na „4K" a IZO
 * variant sa nasadí len vtedy, keď je zvolené izolačné sklo.
 */
export function sysStylPre(system: string, styl: string, sklo: string): string {
	if (system !== STANDARD) return `${system}|${styl}`;
	const base = zakladnyStyl(styl);
	const izo = !jeOponaStyl(base) && jeIzoSklo(sklo);
	return `${system}|${base}${izo ? ' IZO' : ''}`;
}

/** Štýly do ponuky: Štandard + ukáže len počty krídel (IZO variant vyberá sklo). */
export function stylyDoPonuky(system: string, styly: string[]): string[] {
	if (system !== STANDARD) return styly;
	return [...new Set(styly.map(zakladnyStyl))];
}

/** Sklá do ponuky pre kombináciu systém+štýl: Štandard + opona nemá IZO skladbu. */
export function sklaDoPonuky(system: string, styl: string, skla: string[]): string[] {
	if (system !== STANDARD || !jeOponaStyl(zakladnyStyl(styl))) return skla;
	return skla.filter((g) => !jeIzoSklo(g));
}
