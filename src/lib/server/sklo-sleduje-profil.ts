// #610 (Odoo úloha 1416, Patrik 17.10.2026): pri niektorých štýloch je šírka skla VIAZANÁ na
// profil pravidlom výroby „sklo = profil − X mm NA KRÍDLO". Štandard + opona IZO: kladkový − 10 mm
// („Kladkový profil má byť väčší o 10 mm … Meniť šírku skla, nie profilov"). Riadok `Sklo šírka`
// editor vzorcov NEUKAZUJE (`typ='sklo'`), takže bez väzby by výrobou doladený kladkový ticho
// rozbil pravidlo (presne úloha 1416). Rozširujúci profil (+6 mm) je VÝSLEDOK pravidla, nie zdroj —
// sklo nedrží.
//
// JEDINÉ miesto, kde žije množina štýlov s väzbou a jej pravidlo — `saveCfgChanges` (zápis +
// audit) aj editor (`load` → poznámka pri profile) ju čítajú odtiaľto; žiadne `system === …`
// v kóde. Nový štýl s rovnakým pravidlom = nový riadok mapy (a test v
// `tests/cfg-editor-sklo-kladkovy-610.test.ts`).
//
// Pravidlo platí v PRIESTORE OFFSETOV: profil aj sklo šírka sú `(S + offset)/N` (koef 1,
// delitN 1, bez prerezu), takže `profil − sklo = mm` na krídlo ⇔ `off_sklo = off_profil − mm·N`.

export interface SkloSledujeProfil {
	/** Money kód profilu (dim S), ktorý šírka skla sleduje — stabilná identita riadka cfg_rez */
	profilKod: string;
	/** ľudský názov profilu (audit záznam, poznámka v editore) */
	profilPopis: string;
	/** o koľko mm je sklo NA KRÍDLO užšie než profil */
	mmNaKridlo: number;
}

const KLADKOVY_MINUS_10: SkloSledujeProfil = {
	profilKod: 'ZASP202415',
	profilPopis: 'kladkový',
	mmNaKridlo: 10
};

/** sysStyl → väzba šírky skla na profil (#610). */
export const SKLO_SLEDUJE_PROFIL: Readonly<Record<string, SkloSledujeProfil>> = {
	'Štandard +|2x2K IZO': KLADKOVY_MINUS_10,
	'Štandard +|2x3K IZO': KLADKOVY_MINUS_10,
	'Štandard +|2x4K IZO': KLADKOVY_MINUS_10
};

export const skloSledujeProfil = (sysStyl: string): SkloSledujeProfil | null =>
	SKLO_SLEDUJE_PROFIL[sysStyl] ?? null;

// Offsety sú REAL a editor má `step="any"` — porovnanie s toleranciou a výsledok bez float šumu
// (inak by audit/editor ukázal −313,29999999999995 a ďalšie uloženie by väzbu „stratilo").
const EPS = 1e-6;
const bezSumu = (x: number) => Math.round(x * 1e6) / 1e6;

/** Offset skla šírky, ktorý pravidlo predpisuje pre daný offset profilu (N = počet krídel). */
export const skloOffsetZProfilu = (p: SkloSledujeProfil, profilOffset: number, n: number) =>
	bezSumu(profilOffset - p.mmNaKridlo * n);

/** Sklo pravidlo PRÁVE sleduje? Inak je to ručná výnimka a väzba sa jej nedotkne. */
export const skloSleduje = (
	p: SkloSledujeProfil,
	skloOffset: number,
	profilOffset: number,
	n: number
) => Math.abs(skloOffset - skloOffsetZProfilu(p, profilOffset, n)) < EPS;

/** Text audit záznamu (`cfg_audit`) pri posunutí skla väzbou. */
export const skloSledujePole = (p: SkloSledujeProfil) =>
	`Sklo šírka (S) offset — sleduje ${p.profilPopis} − ${p.mmNaKridlo} mm`;
