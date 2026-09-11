---
paths:
  - 'src/lib/server/cfg_seed.json'
  - 'src/lib/styl.ts'
  - 'src/lib/server/migracie-seed.ts'
  - 'src/lib/server/compute-model.ts'
  - 'src/lib/server/compute-odpis.ts'
---

# Odvodenie nárezáku z Excelu + opona IZO (#504)

## „1:1 z Excelu" = REZY + POČTY, nie METRE — tyče vždy FFD

Keď odvodíš `cfg_rez` riadky z reálneho Money nárezáku (Excel), overuj REZOVÉ ROZMERY a
POČTY KUSOV proti PRIAMEMU vyhodnoteniu formúl (openpyxl BEZ `data_only` — `data_only`
vráti 0, lebo vstupy sú prázdne). Ale POČET TYČÍ (a teda `metre = tyče·barLen/1000`)
používa FFD balenie appky (`ffdPack`, `compute-model.ts`) — to je **nižšie** než Excel-ov
naivný „počet tyčí" H-stĺpec (`H = ROUNDUP(rozmer/dĺžka_tyče)` per riadok, bez miešania
dĺžok). Príklad #504: 2×4K opona IZO ZASP202439 → appka 16 tyčí = 57,6 m, Excel-H = 19.
**NIKDY nepíš „odpis 57,6 m je 1:1 z Excelu"** — Excel-ova bunka tam má 68,4 m. Správne:
„rezy/počty 1:1, tyče = FFD (Excel naivný stĺpec vyšší)". FFD je zámerná politika VŠETKÝCH
systémov (viď kotva Robust 2×4K v `compute.test.ts`), nie chyba.

Overovací postup (scratchpad python): (1) `val`+`ffdPack` replika nad navrhnutými riadkami,
(2) PRIAME vyhodnotenie Excel formúl → tie isté cut-lengths → tá istá FFD → porovnaj.
Evaluátor najprv zvaliduj proti PINNED vektorom v `compute.test.ts` (musí ich reprodukovať
bit-presne vrátane FFD a rozmerov skla), až potom mu dôveruj pri nových riadkoch.

## Opona IZO geometria (2× štýly, N=2k)

- Opona: `W=S/2`, prírez/U/sklo delené `N` (sys.N = 2·k). Základné riadky ako opona-basic
  (`W=S/2`, prírez ×4k, krajová ×4, nos ×4(k−1), dorazová ×2) + IZO učko: pridaj U-profil
  `ZASP202439` (šírka `off = prírez_off − 4N`, výška konštanta `V−161`, oba ×`prírez pcs`,
  tyč 3600) a sklo zmenši (šírka `off = prírez_off − 9N`, výška `V−135` namiesto `V−115`).
- **Opona IZO má REDUKOVANÝ X** oproti opona-basic (`ded_izo(k) = 10.5+X(k) − 19 =
  18.5+X(k−1)`). NIE je to copy-paste chyba — starý systém „Štandard" ju má tiež
  (`standard-stary.test.ts`: opona IZO X 103/130/151 vs basic 103/130/157). Redukčný VZOR
  sa medzi systémami LÍŠI → derivované štýly (2×2K/2×3K bez vlastného Excelu) OZNAČ ako
  odvodené a vypýtaj overenie.
- **Dorazová ZASP202419 = 3 pri opona IZO** (basic/ne-opona = 2). Jediný dátový bod (2×4K);
  pre odvodené 2×2K/2×3K to je najneistejšia hodnota — flag.
- **Spodná koľajnica: v seede ulož BASIC** (2×2K ZASP00104 / 2×3K ZASP00030 / 2×4K
  ZASP00033), rovnako ako ne-opona IZO. Excel-ov upsized 5K rail (ZASP202432) vyrobí za behu
  existujúci `railUpsize` (`compute-profily.ts` `RAIL_UPSIZE`) + checkbox „prídavná
  koľajnica" (default zap. pri Štandard+ IZO cez `pridavnaKolajnicaDefault`, `styl.ts`).
  NEUKLADAJ upsized kód do seedu.
- `sklaDoPonuky`/`sysStylPre` (`styl.ts`) sa NEMENÍ — akonáhle pribudne `Štandard +|2x*K IZO`
  do cfg, `existuje(...)` sa preklopí a IZO sa v ponuke pri opone objaví bez zmeny kódu.

## Odvodené (neoverené) nárezáky = čestný banner, nie ticho

Money odpis, ktorý je ODVODENÝ (nie 1:1 overený proti reálnemu Excelu), MUSÍ appka
označiť: `SYSSTYL_ODVODENE` mapa + `odvodenyOdpisWarn(sysStyl)` v `styl.ts`, vlož do
existujúceho `form.warn` kanála (`zasklenia/+page.server.ts` nahlad + nahladMulti,
`data-testid="plan-warn"`). Keď príde reálny Excel pre odvodený štýl → dolaď 1:1 a záznam
zo `SYSSTYL_ODVODENE` zmaž.
