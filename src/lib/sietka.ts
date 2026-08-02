// Sieťka (moskytiéra) na posuve — Patrik 2026-07-31 (Odoo, kanál Vyroba automatizacia),
// KOREKCIA 2026-08-02 (msg #1614821/#1614823/#1614827, kanál 207): sieťka je ĎALŠIE
// krídlo TOHO ISTÉHO posuvu — „úplne rovnaký rozmer ako každé iné okno v tom posuve" —
// nie samostatný objekt s ručne zadaným rozmerom. Zaškrtávacie pole „so sieťkou" pridá
// na poslednej koľaji ďalší rám (3K: rám 6+6 ks → 8+8 ks) + 1 nosový rez, sieťka beží
// na strane podľa smeru posuvu a namiesto kľučky sa ponúka úchyt.
//
// MONEY-RELEVANTNÉ (od korekcie 2026-08-02, Robust aj Slide, len jeden súvislý beh
// krídel — nie opona): rám + nos + [2K→3K koľajnica] IDE do Money odpisu — pozri
// `sietkaExtraPocetKs`/`jeSietkaMoneyRelevant`/`sietkaKolajnicaSwap` v `compute.ts`.
// Joklík (bez Money karty) a Slide sieťkový profil (neoverený, #90) OSTÁVAJÚ mimo.
// Úchyt zostáva DISPLAY-ONLY — Patrik: „dáva sa tam všetko, čo nájdeme na firme…
// neviem či by som to extra riešil" (#88, explicitná odpoveď, nie chýbajúci údaj).

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
	/** úchyt namiesto kľučky — sieťka kľučku/FAB nemá (#88), display-only */
	uchyt: SietkaUchyt;
}

/** Rozmer SIEŤOVINY (látky) na objednávku u iného dodávateľa — Patrik 2026-08-02:
 *  „rozmer sieťky je rozmer skla +2mm +1", potvrdené aj jeho foto z nárezáka (Sklo
 *  1063×1795 → Rozmer sieťky 1065×1796, msg #1614828, kanál 207). Do Money odpisu
 *  NEJDE (sieťovina sa objednáva mimo appky) — len na tlač/nárezák. Počíta sa zo
 *  skla BEŽNÉHO krídla toho posuvu (appka ho už má, sieťka má rovnaký rozmer). */
export function rozmerSietoviny(skloS: number, skloV: number): { sirka: number; vyska: number } {
	return { sirka: skloS + 2, vyska: skloV + 1 };
}

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
 *  Od korekcie 2026-08-02 appka koľajnicu v odpise SKUTOČNE mení (`sietkaKolajnicaSwap`
 *  v `compute.ts`, keď je sieťka Money-relevantná) — táto funkcia určuje KEDY, gate aj
 *  pre výpočet aj pre UI upozornenie (jeden zdroj pravdy). */
export function potrebuje3KKolajnicu(styl: string): boolean {
	return styl === '2K';
}

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/** jednoriadkový popis sieťky do plánu / detailu histórie (rovnaký vzor ako klinPopis).
 *  `rozmer` = `rozmerSietoviny(skloS, skloV)` toho posuvu — appka ho vždy vie (je
 *  odvodený zo skla), preto tu nie je nepovinný ako predtým. */
export function sietkaPopis(s: Sietka, rozmer: { sirka: number; vyska: number }): string {
	return `sieťka — ${fmt(rozmer.sirka)} × ${fmt(rozmer.vyska)} mm, úchyt: ${uchytLabel(s.uchyt)}`;
}
