// Zdieľané typy + formátovač pre zasklenia formulár a jeho výsledkové karty.
// Vyčlenené z `routes/zasklenia/+page.svelte` (#250) — čistý, bez reaktivity:
// `+page.svelte` ostáva jedinou autoritou `$state`/`$effect`/serializácie, tento
// modul len drží TYPY a čistý formátovač, ktoré potrebujú AJ deti (`ZasklieniaForm`
// pre loop-binding typ `PosuvRow`, `PlanKarty`/`PlanKartyMulti` pre `fmtM` a `PlanVstup`).

import type { Klin, KlinVstup } from '$lib/klin';
import type { Sietka, SietkaUchyt } from '$lib/sietka';
import type { Farba } from '$lib/komponenty';

// mm → čitateľné (max 3 desatinné, čiarka). Presunuté z +page (#250); display-only.
export const fmtM = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

// Riadok ĎALŠIEHO posuvu (zimná záhrada) — ploché polia rovnakého tvaru ako primárny
// posuv; do JSON-u idú tak, ako ich parsuje server. `kliny` (#472) je JEDINÉ pole,
// ktoré nie je ploché — je to už samotné pole `Klin[]` (KlinPolia ho spravuje priamo).
export type PosuvRow = {
	system: string;
	styl: string;
	s: number | string;
	v: number | string;
	sklo: string;
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
