// Zákaznícky 3D náhľad (#170) — VŠETKY vizuálne mm konštanty na jednom mieste.
// Každá je označená "vizuál, nie katalóg" — žiadna z nich nesmie vstúpiť do
// žiadnej kóty, žiadneho odpisu, žiadneho Money výstupu. Zdroj pravdy pre
// SKUTOČNÉ rozmery (s, v, n…) je vždy vstup appky, nikdy hodnota odtiaľto.

/** hrúbka rámu krídla v kresbe [mm] — vizuál, nie katalóg. ZDIEĽANÁ hodnota s
 *  `ZaskleniaNavrhVykres.svelte`'s `RAM_VIZ_MM` — 2D a 3D náhľad sa nesmú
 *  rozísť v tom, ako "hrubý" rám vyzerá (obe sú nezávislé konštanty v
 *  oddelených súboroch, túto zhodu treba udržiavať ručne pri zmene ktorejkoľvek). */
export const RAM_VIZ_MM = 70;

/** hĺbka rámového profilu v smere Z [mm] — vizuál, nie katalóg. */
export const ZASK_RAM_HLBKA_MM = 45;

/** rozteč (odstup) dráh v hĺbke — o toľko sa každá ďalšia dráha posúva v Z
 *  [mm] — vizuál, nie katalóg. */
export const ZASK_DRAHA_ROZTEC_MM = 34;

/** celková hĺbka konštrukcie (počet dráh × rozteč + rezerva na rám) [mm] —
 *  vizuál, nie katalóg. */
export function ZASK_HLBKA_MM(n: number): number {
	return ZASK_DRAHA_ROZTEC_MM * n + 20;
}

/** výška spodnej koľajnice [mm] — vizuál, nie katalóg. */
export const KOLAJNICA_SPODNA_H_MM = 22;

/** výška hornej koľajnice [mm] — vizuál, nie katalóg. */
export const KOLAJNICA_HORNA_H_MM = 40;

/** rozmery kľučky (šírka × výška × hĺbka) [mm] — vizuál, nie katalóg. */
export const KLUCKA_MM = { w: 130, h: 22, d: 26 };

/** výška stredu kľučky nad zemou [mm] — vizuál, nie katalóg. */
export const KLUCKA_Y_MM = 1050;

/** rozteč pletiva sieťky (pre procedurálnu textúru, nie geometriu) [mm] —
 *  vizuál, nie katalóg. */
export const SIETKA_ROZTEC_MM = 1.6;

/** hrúbka sieťkového panelu [mm] — vizuál, nie katalóg (rovnaká hrúbka ako
 *  predvolené sklo, sieťka nemá vlastný katalógový rozmer v appke). */
export const SIETKA_HRUBKA_MM = 8;

/** predvolená hrúbka skla, keď `skloPresne` nie je zadané [mm] — vizuál,
 *  nie katalóg (appka dnes hrúbku skla pre zasklenia-navrh nezbiera). */
export const SKLO_HRUBKA_DEFAULT_MM = 8;

/** zapustenie tabule od vonkajšej hrany rámu krídla, zo všetkých strán
 *  [mm] — vizuál, nie katalóg. */
export const SKLO_ZAPUSTENIE_MM = 70;

/** o akú časť šírky krídla sa vodiace krídlo posunie pri "Otvoriť" (0..1) —
 *  vizuál, nie katalóg. Šírky krídel sa NIKDY nemenia, mení sa iba poloha po
 *  koľajnici (pravdivé zobrazenie, viď §2.5 špecifikácie). */
export const OTVORENE_NA_DEFAULT = 0.35;

// Priečka (MULLION_VIZ_MM v 2D výkrese) sa v 3D NEKRESLÍ ako samostatný diel.
// V posuve sa na vnútornej hranici stretávajú dva stojíny dvoch krídel na
// RÔZNYCH dráhach — v 3/4 pohľade sú oba viditeľné vedľa seba a to je fyzicky
// správne (na rozdiel od 2D pôdorysu, kde by dvojitá čiara pôsobila rušivo,
// preto tam existuje jedna zjednotená MULLION_VIZ_MM). Táto odchýlka od 2D
// konštanty je zámerná, nie nedopatrenie.

/** Ak dielňa potrebuje OPAČNÉ poradie krídel v hĺbke (najbližšie/najďalšie
 *  vpredu), prepne sa TÁTO jediná konštanta — `geo/zasklenia.ts` číta iba ju,
 *  nikde inde sa poradie nehardcoduje. Konvenciu (default `false`) drží
 *  snapshot test v `tests/vizual-zasklenia.test.ts`. Vizuál, nie katalóg —
 *  nemení žiadnu kótu ani odpis, len smer, ktorým krídla v 3D scéne
 *  "kaskádujú". */
export const ZASK_PORADIE_OBRATENE = false;
