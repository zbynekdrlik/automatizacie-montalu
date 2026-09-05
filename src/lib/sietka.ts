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
// Joklík (bez Money karty) OSTÁVA mimo. Úchyt zostáva DISPLAY-ONLY — Patrik: „dáva
// sa tam všetko, čo nájdeme na firme… neviem či by som to extra riešil" (#88,
// explicitná odpoveď, nie chýbajúci údaj).
//
// ROZŠÍRENIE 2026-08-03 (#110, #90, Odoo kanál 207 msg #1614895/#1616278–#1616285):
// - Slide dostal vlastný redukčný profil na sieťku (namiesto zužovacieho pri 6mm
//   skle) — `sietkaSlideExtra` v `compute.ts`.
// - Štandard aj Štandard + dostali sieťku — a NAVYŠE si obsluha vyberá SYSTÉM
//   sieťky nezávisle od systému posuvu (Patrik #1616278: „Vyberiem si systém či
//   plus alebo starý a keď si dám sieťku vyberiem si či chcem sieťku plus štandard
//   alebo starý"). Pole `Sietka.system` nesie tento výber — pozri
//   `maSietkaSystemVyber`/`sietkaStandardExtra` v `compute.ts`.
//
// OPRAVA 2026-08-07 (#91 nález 1, adversariálna revízia PR #122): na Štandarde/
// Štandard + o IZO/basic nárezáku ROZHODUJE ZVOLENÉ SKLO, nie štýl (`sysStylPre`
// v `styl.ts`) — takže samotný výpočet dostane `styl = '2K IZO'`, nikdy holé
// `'2K'`. `potrebuje3KKolajnicu` aj `sietkaKolajnicaSwap` preto gejtujú na
// `zakladnyStyl(styl) === '2K'`, nie na prísnu rovnosť — inak sa swap na IZO
// skle vôbec nespustí, hoci UI hlásku aj tak zobrazí (hláška sa vždy riadila
// základným štýlom cez `vstup.styl`, ktorý IZO nikdy nenesie).

import { zakladnyStyl, plusRailEligible, SYSTEMY_OBVODOVA } from './styl';

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
	/** SYSTÉM sieťky, keď sa líši od systému posuvu — LEN pri dvojici Štandard /
	 *  Štandard + (#110, Patrik #1616278). `undefined`/chýbajúce = sieťka je
	 *  toho istého systému ako posuv (jediná možnosť pre Robust/Slide, aj default
	 *  pre Štandard-rodinu). Sanitizuje sa cez `sanitizeSietkaSystem` v `vstup.ts`. */
	system?: string;
}

/** Rozmer SIEŤOVINY (látky) na objednávku u iného dodávateľa — Patrik 2026-08-02:
 *  „rozmer sieťky je rozmer skla +2mm +1", potvrdené aj jeho foto z nárezáka (Sklo
 *  1063×1795 → Rozmer sieťky 1065×1796, msg #1614828, kanál 207). Do Money odpisu
 *  NEJDE (sieťovina sa objednáva mimo appky) — len na tlač/nárezák. Počíta sa zo
 *  skla BEŽNÉHO krídla toho posuvu (appka ho už má, sieťka má rovnaký rozmer). */
export function rozmerSietoviny(skloS: number, skloV: number): { sirka: number; vyska: number } {
	return { sirka: skloS + 2, vyska: skloV + 1 };
}

/** Rozmer SIEŤOVINY pre Štandard/Štandard + (#110, jeho vlastný nárezák
 *  „ŠTANDARD PLUS V2 3K+1K sieťka", msg #1616284): sklo 957×1735 → riadok
 *  „sieťka" 960×1738 → +3mm šírka, +3mm výška. INÁ delta ako Robust/Slide
 *  (`rozmerSietoviny`, +2/+1) — preto samostatná funkcia, nie parameter. */
export function rozmerSietovinyStandard(
	skloS: number,
	skloV: number
): { sirka: number; vyska: number } {
	return { sirka: skloS + 3, vyska: skloV + 3 };
}

/** Rozmer sieťoviny podľa RODINY systému posuvu — jeden vstupný bod pre UI,
 *  aby si komponenty nemuseli pamätať, ktorá formula patrí ktorému systému. */
export function rozmerSietovinyPre(
	system: string,
	skloS: number,
	skloV: number
): { sirka: number; vyska: number } {
	return maSietkaSystemVyber(system)
		? rozmerSietovinyStandard(skloS, skloV)
		: rozmerSietoviny(skloS, skloV);
}

/** Systémy, kde appka sieťku ponúka NA POSUVE (Patrik 2026-07-31 pri #90: „malo
 *  by to byť všetko totožné" ako Robust; #110 pridal Štandard/Štandard +).
 *  Deluxe/Bazén/Pergola sieťku nemajú. */
export const SIETKA_SYSTEMY = ['Robust', 'Slide', 'Štandard', 'Štandard +'];

export function maSietkaSystem(system: string): boolean {
	return SIETKA_SYSTEMY.includes(system);
}

/** Systémy pre SAMOSTATNÚ sieťku (`/sietka`, „dodatočná sieťka bez posuvu", #89)
 *  — ZÁMERNE NEROZŠÍRENÉ o Štandard/Štandard + (#110 pokrýva LEN sieťku NA
 *  posuve; `sietkaSamostatnaVypocet` v `compute.ts` má vlastný, jednoduchší
 *  rámový/nosový mechanizmus, ktorý by na Štandarde dal nesprávny výsledok —
 *  Štandardova krajová aj nos zdieľajú predponu „Rámový profil"). Rozšírenie
 *  samostatnej sieťky o Štandard je samostatná, nezadaná úloha. */
export const SIETKA_SAMOSTATNA_SYSTEMY = ['Robust', 'Slide'];

/** Systémy, kde si obsluha NAVYŠE vyberá SYSTÉM sieťky nezávisle od systému
 *  posuvu (#110, Patrik #1616278) — len dvojica Štandard / Štandard +. Robust
 *  a Slide majú jediný sieťkový systém (ten istý ako posuv), žiadny výber. */
export function maSietkaSystemVyber(system: string): boolean {
	return system === 'Štandard' || system === 'Štandard +';
}

/** „Ten druhý" systém z dvojice Štandard / Štandard + — default hodnota pre
 *  výber sieťkového systému (predvolené = rovnaký ako posuv, viď `maSietkaSystemVyber`). */
export const SIETKA_SYSTEM_ALT: Record<string, string> = {
	Štandard: 'Štandard +',
	'Štandard +': 'Štandard'
};

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
 *  pre výpočet aj pre UI upozornenie (jeden zdroj pravdy). Gate je na ZÁKLADNOM štýle
 *  (`zakladnyStyl`), nie na prísnej rovnosti — na Štandarde/Štandard + môže niesť
 *  príponu „ IZO" podľa zvoleného skla (`sysStylPre`), a 2K IZO potrebuje presne tú
 *  istú 3K výmenu ako obyčajné 2K (#91 nález 1). */
export function potrebuje3KKolajnicu(styl: string): boolean {
	return zakladnyStyl(styl) === '2K';
}

/** Systémy zo `SIETKA_SYSTEMY`, kde koľajnica na 2K je DELENÁ (samostatná horná +
 *  spodná, dva ROZDIELNE Money kódy — `rolaKolajnice` v `compute.ts`) namiesto
 *  JEDNEJ obvodovej koľajnice v dvoch kusoch (Robust/Slide). #91: `potrebuje3KKolajnicu`
 *  sama o sebe hovorí len KEDY sa niečo mení, nie ČO presne — UI hláška predtým
 *  tvrdila „(2 ks + 2 ks)" aj pre Štandard/Štandard +, kde je to nepravda (1 ks horná
 *  + 1 ks spodná, dva odlišné kódy). Tento zoznam MUSÍ zostať v zhode s `rolaKolajnice`
 *  — test `sietka-3k-warn-sync.test.ts` to overuje priamo proti živému `cfg_seed.json`,
 *  takže budúci systém s delenou koľajnicou padne na teste namiesto tichej klamúcej
 *  hlášky, presne to, čo sa stalo v #91. */
export const SIETKA_SYSTEMY_DELENA_KOLAJNICA = ['Štandard', 'Štandard +'];

/** Presný text „čo appka odpíše namiesto 2K" pre UI upozornenie (3 miesta:
 *  +page.svelte primárny aj multi posuv, SietkaPolia.svelte) — jeden zdroj pravdy,
 *  aby žiadne z nich nemohlo klamať o počte kusov (#91). */
export function popis3KKolajnicaVymena(system: string): string {
	return SIETKA_SYSTEMY_DELENA_KOLAJNICA.includes(system)
		? '3K koľajnicu (hornú aj spodnú, po 1 ks) namiesto 2K'
		: '3K koľajnicu (2 ks + 2 ks) namiesto 2K';
}

/** #123 (ROZHODNUTÉ — Patrik, Odoo 207 #1646652, 2026-08-09), rozšírené #456:
 *  Checkbox „Prídavná koľajnica" (`railUpsize` v compute) dvíha koľajnicu o 1 veľkosť.
 *  Keď je naraz zapnutá aj sieťka na 2K, sieťka sama vynúti CELÚ 3K sadu
 *  (`sietkaKolajnicaSwap`, beží AŽ PO `railUpsize` a jeho výsledok prepíše) —
 *  koľajnica, ktorú by inak pridala „prídavná koľajnica", je v tej 3K sade UŽ zahrnutá.
 *  Platí pre VŠETKY systémy s `plusRailEligible` (#456), nie len Štandard +. */
export function pridavnaJeVSietke(system: string, styl: string, sietkaOn: boolean): boolean {
	return plusRailEligible(system, styl) && sietkaOn && potrebuje3KKolajnicu(styl);
}

/** Presný text hlášky pre UI, keď `pridavnaJeVSietke` platí (jeden zdroj pravdy —
 *  pozri `pridavnaJeVSietke` prečo; rovnaký vzor ako `popis3KKolajnicaVymena`).
 *  `null`, keď hláška nemá zmysel. Text sa prispôsobuje topológii koľajníc:
 *  horná+spodná (Štandard+/Deluxe) vs obvodová (Slide/Robust). */
export function pridavnaKolajnicaHint(
	system: string,
	styl: string,
	sietkaOn: boolean,
	pridavna: boolean
): string | null {
	if (!pridavnaJeVSietke(system, styl, sietkaOn)) return null;
	const zaklad = SYSTEMY_OBVODOVA.has(system)
		? '„Prídavná koľajnica" tu už nič navyše nezmení — sieťka na 2K sama zdvihla ' +
			'koľajnicu na 3K, a tú, ktorú by inak pridala táto voľba, ' +
			'tá 3K sada už obsahuje.'
		: '„Prídavná koľajnica" tu už nič navyše nezmení — sieťka na 2K sama zdvihla ' +
			'obidve koľajnice (hornú aj spodnú) na 3K, a spodnú, ktorú by inak pridala ' +
			'táto voľba, tá 3K sada už obsahuje.';
	return pridavna
		? `${zaklad} Nechaj ju zaškrtnutú: keď sieťku vypneš, prídavná koľajnica bude opäť platiť bez ďalšieho zásahu.`
		: `${zaklad} Netreba ju kvôli tomu zapínať.`;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');

/** jednoriadkový popis sieťky do plánu / detailu histórie (rovnaký vzor ako klinPopis).
 *  `rozmer` = `rozmerSietoviny(skloS, skloV)` toho posuvu — appka ho vždy vie (je
 *  odvodený zo skla), preto tu nie je nepovinný ako predtým. */
export function sietkaPopis(s: Sietka, rozmer: { sirka: number; vyska: number }): string {
	return `sieťka — ${fmt(rozmer.sirka)} × ${fmt(rozmer.vyska)} mm, úchyt: ${uchytLabel(s.uchyt)}`;
}
