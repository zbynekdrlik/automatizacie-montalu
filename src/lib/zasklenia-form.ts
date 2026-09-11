// Zdieľané typy + formátovač pre zasklenia formulár a jeho výsledkové karty.
// Vyčlenené z `routes/zasklenia/+page.svelte` (#250) — čistý, bez reaktivity:
// `+page.svelte` ostáva jedinou autoritou `$state`/`$effect`/serializácie, tento
// modul len drží TYPY a čistý formátovač, ktoré potrebujú AJ deti (`ZasklieniaForm`
// pre loop-binding typ `PosuvRow`, `PlanKarty`/`PlanKartyMulti` pre `fmtM` a `PlanVstup`).

import type { Klin, KlinVstup } from '$lib/klin';
import type { Sietka, SietkaUchyt } from '$lib/sietka';
import type { Farba } from '$lib/komponenty';
import { SKLO_INE, ineHrubka, jeSkloTrieda } from '$lib/sklo';

// mm → čitateľné (max 3 desatinné, čiarka). Presunuté z +page (#250); display-only.
export const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

// RAL možnosť selectu, ako ju posiela server (config-derived z `komponentyPre`).
// `hrubkaSkla` je NEPRÍTOMNÁ pre hrúbko-neutrálne farby (kľučka/zámok kovania) a
// PRÍTOMNÁ pre krytky, ktoré majú Money kód per hrúbka×farba (Deluxe, #431 kolo 2).
export type RalPar = { farba: Farba; hrubkaSkla?: 6 | 10 };

// Fyzická hrúbka (mm) zvoleného skla — vyberá, ktoré krytky (a teda ktoré RAL
// varianty) sú platné (#431 kolo 2). Katalógové sklo ju nesie v `data.skla.hrubka`;
// vlastná skladba (SKLO_INE) ju odvodí z triedy cez `ineHrubka` (jeden zdroj pravdy,
// nie parsovanie mena). `null` = sklo nezvolené / nenájdené → volajúci neaplikuje
// hrúbkový filter (ponúkne všetky farby; server ostáva autoritatívny cez fail-loud).
export function hrubkaPreSklo(
	system: string,
	sklo: string,
	skloTrieda: number | '' | null,
	skla: { nazov: string; system: string; hrubka: number }[]
): number | null {
	if (!sklo) return null;
	if (sklo === SKLO_INE) return jeSkloTrieda(skloTrieda) ? ineHrubka(system, skloTrieda) : null;
	return skla.find((g) => g.system === system && g.nazov === sklo)?.hrubka ?? null;
}

// Farby do RAL selectu — únia naprieč posuvmi v hre. Farba sa ponúkne, keď je
// hrúbko-neutrálna (`hrubkaSkla===undefined`) ALEBO jej hrúbka sedí s hrúbkou skla
// TOHO posuvu; pri neznámej hrúbke posuvu (sklo ešte nezvolené) sa jeho hrúbko-
// špecifické farby ponúknu všetky (UX fallback — server je aj tak autoritatívny).
// Poradie = poradie prvého výskytu; bez duplicít.
export function ralOptionsPre(
	posuvy: { system: string; hrubka: number | null }[],
	ralPreSystem: Record<string, RalPar[]>
): Farba[] {
	const out: Farba[] = [];
	for (const p of posuvy)
		for (const par of ralPreSystem[p.system] ?? [])
			if (
				(par.hrubkaSkla === undefined || p.hrubka === null || par.hrubkaSkla === p.hrubka) &&
				!out.includes(par.farba)
			)
				out.push(par.farba);
	return out;
}

// Riadok ĎALŠIEHO posuvu (zimná záhrada) — ploché polia rovnakého tvaru ako primárny
// posuv; do JSON-u idú tak, ako ich parsuje server. `kliny` (#472) je JEDINÉ pole,
// ktoré nie je ploché — je to už samotné pole `Klin[]` (KlinPolia ho spravuje priamo).
export type PosuvRow = {
	system: string;
	styl: string;
	s: number | string;
	v: number | string;
	sklo: string;
	// vlastná (nekatalógová) skladba TOHOTO posuvu (#235 slice 2) — text + hrúbková
	// trieda; platné len pri `sklo===SKLO_INE`, inak `''`/prázdne
	skloPresne: string;
	skloTrieda: number | '';
	otvaranie: string;
	kovanieL: string;
	kovanieP: string;
	kovanieStred: string;
	kovanieStredOkno: 'L' | 'P';
	// klíny TOHOTO posuvu (#472 viac RÔZNYCH naraz) — editovateľné riadky (hodnoty
	// smú byť prázdny reťazec), prázdne pole = žiadny
	kliny: KlinVstup[];
	// ručné dĺžky koľajníc TOHOTO posuvu — prázdne = počítaj zo šírky (mení odpis)
	kolajnicaHorna: number | string;
	kolajnicaSpodna: number | string;
	// sieťka TOHOTO posuvu (#86–#90, KOREKCIA 2026-08-02) — rozmer sa už nezadáva
	sietka: boolean;
	sietkaUchyt: SietkaUchyt;
	// systém sieťky (#110) — prázdny reťazec = rovnaký ako posuv tohto riadku
	sietkaSystem: string;
};

// Tvar predvyplneného display-vstupu (`$derived.by` v +page). Jedno- aj viac-posuvový
// vstup zdieľa zak/op/zákazník/poznámku/čaká; ostatné polia nesie primárny posuv.
export type PlanVstup = {
	zak: string;
	op: string;
	zakaznik: string;
	system: string;
	styl: string;
	s: number;
	v: number;
	sklo: string;
	skloPresne: string;
	/** vlastná skladba (#235 slice 2) — hrúbková trieda pri `sklo===SKLO_INE`, inak null */
	skloTrieda: number | null;
	otvaranie: string;
	kovanieL: string;
	kovanieP: string;
	kovanieStred: string;
	kovanieStredOkno: 'L' | 'P';
	vrtanieZamku: number;
	poznamka: string;
	ral: string;
	caka: boolean;
	pridavnaKolajnica: boolean;
	jednostrannaFab: boolean;
	farbaKovania: Farba | null;
	kliny: Klin[];
	kolajnica: { horna?: number; spodna?: number } | null;
	sietka: Sietka | null;
};
