// Sieťka (moskytiéra) na posuve — Patrik 2026-07-31 (Odoo, kanál Vyroba automatizacia):
// zaškrtávacie pole „so sieťkou" pri posuve pridá na poslednej koľaji ďalší rám
// (o jedno krídlo viac — príklad 3K: rám 6+6 ks → 8+8 ks) + prídavný joklík, sieťka
// beží na strane podľa smeru posuvu a namiesto kľučky sa ponúka úchyt.
//
// DISPLAY-ONLY (rovnaký princíp ako klín, `$lib/klin`): tento modul a všetko, čo
// z neho čerpá, ide LEN do náhľadu, nárezového plánu/tlače a do detailu histórie
// odpisov. Do Money odpisu (.xlsx položky) NEVSTUPUJE — chýbajú potvrdené Money
// kódy/kusy (joklík nemá v Money kartu vôbec, presné kusy nie sú potvrdené — pozri
// komentáre na #86–#90 z 2026-07-31). Rozmer sieťky sa NEPOČÍTA z rozmeru otvoru
// (vzorec/offset nie je daný) — zadáva ho ručne dielňa, presne ako 4 kóty klina.

export type SietkaUchyt = 'ziadny' | 'madloVelke' | 'madloMale' | 'zamok';

export const SIETKA_UCHYTY: { value: SietkaUchyt; label: string }[] = [
	{ value: 'ziadny', label: 'bez ničoho' },
	{ value: 'madloVelke', label: 'vystúpené madlo veľké' },
	{ value: 'madloMale', label: 'vystúpené madlo malé (Ľko)' },
	{ value: 'zamok', label: 'mŕtvy zapadávací zámok' }
];

export function jeSietkaUchyt(x: unknown): x is SietkaUchyt {
	return SIETKA_UCHYTY.some((u) => u.value === x);
}

export function uchytLabel(u: SietkaUchyt): string {
	return SIETKA_UCHYTY.find((x) => x.value === u)?.label ?? 'bez ničoho';
}

export interface Sietka {
	/** rozmer sieťky — šírka [mm]; NEPOVINNÉ, meria/dopĺňa dielňa (nie je rozmer skla) */
	sirka: number | null;
	/** rozmer sieťky — výška [mm]; NEPOVINNÉ */
	vyska: number | null;
	/** úchyt namiesto kľučky — sieťka kľučku/FAB nemá (#88) */
	uchyt: SietkaUchyt;
}

/** hraničné hodnoty rozmeru sieťky — rovnaké ako klín (HTML5 min/max aj server) */
export const SIETKA_MAX_ROZMER = 20000;

/** Systémy, kde appka sieťku ponúka (Patrik 2026-07-31 pri #90: „malo by to byť
 *  všetko totožné" ako Robust). Štandard/Deluxe/Bazén/Pergola sieťku nemajú. */
export const SIETKA_SYSTEMY = ['Robust', 'Slide'];

export function maSietkaSystem(system: string): boolean {
	return SIETKA_SYSTEMY.includes(system);
}

/** Strana, na ktorej sieťka beží — podľa smeru posuvu (Patrik: „ak je L-P tak na
 *  ľavú stranu, ak P-L tak opačné garde"). Opona/neurčené = null (sieťka na oponových
 *  štýloch appka zatiaľ neponúka — 2x* nie sú v ponuke systémov so sieťkou). */
export function sietkaStrana(otvaranie: string): 'ľavá' | 'pravá' | null {
	const o = otvaranie.replace(/\s/g, '');
	if (o === 'L-P') return 'ľavá';
	if (o === 'P-L') return 'pravá';
	return null;
}

/** 2K nemá voľnú koľaj pre sieťku — treba 3K koľajnicu (Patrik 2026-07-31, #87).
 *  Len detekcia pre UPOZORNENIE; appka koľajnicu v odpise NEMENÍ (Money-kritické,
 *  presný pár kódov nie je potvrdený). */
export function potrebuje3KKolajnicu(styl: string): boolean {
	return styl === '2K';
}

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/** jednoriadkový popis sieťky do plánu / detailu histórie (rovnaký vzor ako klinPopis) */
export function sietkaPopis(s: Sietka): string {
	const rozmer =
		s.sirka && s.vyska ? `${fmt(s.sirka)} × ${fmt(s.vyska)} mm` : 'rozmer doplní dielňa';
	return `sieťka — ${rozmer}, úchyt: ${uchytLabel(s.uchyt)}`;
}
