---
paths:
  - 'src/lib/server/cfg_seed.json'
  - 'src/lib/styl.ts'
  - 'src/lib/server/migracie-seed.ts'
  - 'src/lib/server/compute-model.ts'
  - 'src/lib/server/compute-odpis.ts'
  - 'src/lib/server/migracie-opona-izo-sklo.ts'
  - 'tests/opona-izo-sklo-610.test.ts'
  - 'src/lib/server/sklo-sleduje-profil.ts'
  - 'e2e/opona-izo.spec.ts'
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
- **Šírka skla Štandard + opona IZO = kladkový − 10 mm (#610, Odoo úloha 1416, Patrik 17.10.)**
  — NAHRÁDZA pôvodné odvodenie `prírez_off − 9N` vyššie (sklo vychádzalo o 7–10 mm širšie).
  Pravidlo výroby: kladkový = sklo + 10, rozširujúci = sklo + 6 (na krídlo); „meniť šírku skla,
  nie profilov". Offset skla = kladkový offset (PROD) − 10·N: 2×2K −313, 2×3K −380, 2×4K −460
  (migrácia v58 + seed). Starý „Štandard" opona IZO (−268/−340/−400) sa NEZMENIL. Pravidlo stráži
  `tests/opona-izo-sklo-610.test.ts`; vektor z úlohy 2×3K 6500×2070 → 1020×1935 (E2E LEN v seede).
  `opona-izo.spec.ts` (`overRozmerSkla`): bez BASE_URL presný seed vektor (568×1965 / 1020×1935),
  proti PROD relácie — šírka skla sa na PROD hýbe s kladkovým (väzba nižšie) a korekcia skla
  (trieda 16 / systémové zmenšenie, editovateľné) posúva šírku AJ výšku o to isté k, takže
  k = (V − 135) − výška a `rez kladkového − sklo = 10 + k`. Pevný literál by po ďalšej úprave výroby
  padol na deployi (#555).
  **Pri ďalšej zmene kladkového opona IZO v editore sa sklo šírka POSUNIE SAMO** (#610 doplnok,
  väzba `rozhodniSkloZapisy` v `cfg-editor-sklo.ts`, mapa `src/lib/server/sklo-sleduje-profil.ts`,
  detail `cfg-editor.md` PASCA #3): keď sklo pravidlo sledovalo, zapíše sa `kladkový_nový − 10·N` +
  audit záznam; editor pri kladkovom ukáže „↳ sklo sa posunie automaticky (o 10 mm užšie)" (inak
  „↳ sklo sa neposunie — šírka skla je nastavená samostatne …"). Rozširujúci sklo NEposúva.
  Novú dátovú migráciu skla (vzor v58) treba LEN keď sklo pravidlo nesleduje (ručná výnimka, iný
  štýl mimo mapy) alebo sa mení samotné pravidlo (iné mm, iný profil).
- **Seed profily opona IZO ≠ PROD** (výroba 14.9. editorom: kladkový S PROD −273/−320/−380 vs seed
  −235/−285/−335, rozširujúci −290/−342/−410 vs −251/−309/−367). Seed sa so živou cfg zámerne
  nezosúlaďuje (`testing.md`), Money vektory profilov ostávajú zo seedu. Test pravidla „sklo vs
  profil" preto prekrýva seed cfg PROD profilovými offsetmi (`PROD_PROFILY` v teste #610) — nad čistým
  seedom je kladkový − sklo 19,5 / 15,8 / 15,6 mm a pravidlo by sa „nesplnilo".
- `sklaDoPonuky`/`sysStylPre` (`styl.ts`) sa NEMENÍ — akonáhle pribudne `Štandard +|2x*K IZO`
  do cfg, `existuje(...)` sa preklopí a IZO sa v ponuke pri opone objaví bez zmeny kódu.

## Odvodené (neoverené) nárezáky = čestný banner, nie ticho

Money odpis, ktorý je ODVODENÝ (nie 1:1 overený proti reálnemu Excelu), MUSÍ appka
označiť: `SYSSTYL_ODVODENE` mapa + `odvodenyOdpisWarn(sysStyl)` v `styl.ts`, vlož do
existujúceho `form.warn` kanála (`zasklenia/+page.server.ts` nahlad + nahladMulti,
`data-testid="plan-warn"`). Keď príde reálny Excel pre odvodený štýl → dolaď 1:1 a záznam
zo `SYSSTYL_ODVODENE` zmaž.
