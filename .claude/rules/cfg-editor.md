---
paths:
  - "src/lib/server/cfg-editor.ts"
  - "src/lib/server/sklo-sleduje-profil.ts"
  - "src/routes/zasklenia/nastavenia/**"
  - "tests/auth-editor.test.ts"
  - "tests/cfg-editor-*.test.ts"
  - "e2e/cfg-editor-*.spec.ts"
  - "tests/sklo-*editor*.test.ts"
  - "tests/nastavenia-*.test.ts"
---

# Editor vzorcov (`cfg-editor.ts` `saveCfgChanges`) — skryté zrkadlenia a audit

Editor `/zasklenia/nastavenia` ukladá offsety cez `saveCfgChanges`. Dve „skryté" zrkadlenia
prepisujú riadky, ktoré formulár NEUKAZUJE — obe sú historické pasce; každý dotyk tejto
funkcie ich musí rešpektovať.

## PASCA #1 — rámový→sklo mirror NIE JE bezpodmienečný (prod korupcia #504, 14.9.2026)

`typ='sklo'` riadky (Sklo šírka/výška) NIE SÚ v editore editovateľné — dostávajú offset
ZRKADLENÍM z profilu s názvom `/rámový/i` tej istej dimenzie. Pôvodný kód (e8e0424, 2.7.)
zrkadlil BEZPODMIENEČNE pri každom uložení, lebo vtedy sklo NÁHODNE rovnalo rámový pre všetky
štýly. **To je NEPRAVDA pre väčšinu štýlov:** audit seedu (`cfg_seed.json`, dim V) = **29 z 39**
štýlov má sklo V ≠ rámový V (Štandard/Štandard+ basic −115, IZO −135, Drevo −88.5; rámový −33);
len 10 rovných (Robust*/Slide*). Formulár posiela VŠETKY `offset_<id>` (aj nezmenené), takže
uloženie ktoréhokoľvek z 29 štýlov (aj so zmenou len Kladkového/Rozširujúceho) ticho prepísalo
sklo výšku na rámový −33 → sklo do Money o ~102 mm privysoké. Zachytila to `e2e/opona-izo.spec.ts`
(1965 → 2067).

**Kontrakt platný od #504** (`saveCfgChanges`, blok `skloMirror`): zrkadli rámový→sklo LEN keď
- rámový offset sa SKUTOČNE zmenil (`nova !== r.offset`), A
- sklo ho práve SLEDOVALO (`skloByDim.get(dim) === starý rámový.offset`) — inak je sklo
  SAMOSTATNÝ rozmer a ostáva nedotknuté (opona IZO sklo výška −135 navždy nezávislá),

a zrkadlenie sa MUSÍ zapísať do `zmeny` (→ `cfg_audit`), inak je zmena Money-kritického
rozmeru neviditeľná. Dedup per dim = `skloMirror.has(dim)` (prvý zmenený rámový vyhráva) →
jeden audit záznam presne zodpovedá tomu, čo `updSkloRez` zapíše.

**Dôsledky pri práci:**
- Nový štýl, kde sklo ≠ rámový (opona IZO, Drevo, každý basic/IZO Štandard+): bezpečný BEZ
  ďalšej práce — mirror sa naň nikdy nechytí. `Štandard +|2x4K IZO` má rámový len V (−33),
  žiadny rámový S → sklo S sa z rámového nezrkadlí vôbec (od #610 ju posúva väzba na
  kladkový — PASCA #3 nižšie).
- NEROB mirror bezpodmienečným ani „delta" (sklo += Δrámový) — to mení Money čísla opona IZO
  neoverene voči Excelu (ZAMIETNUTÉ v #504 designe).
- Prod data repair po takejto korupcii je supervisor akcia (owner-schválený `UPDATE cfg_rez`),
  NIE self-healing migrácia — plošný reset zo seedu by prepísal legitímne zrkadlené hodnoty
  10 rovných štýlov (viď `migrations.md`: data repair ≠ migrácia).

## PASCA #2 — Deluxe 6/10 mm dvojča (existujúce, nepokaz ho)

Hrúbko-závislý profil (kladka/klzný) má DVA `cfg_rez` riadky (6mm + 10mm) s identickou
geometriou; editor ukazuje len kanonický 6mm a pri uložení zrkadlí offset na 10mm dvojča
(`allProfil`/`baseRole`), inak by 6/10 písali do Money iné množstvo. Na konci transakcie to
stráži invariant (rovnaký offset per `baseRole`) — nemeň ho.

## PASCA #3 — väzba sklo šírka → kladkový − 10 mm (Štandard + opona IZO, #610)

Pravidlo výroby (Odoo úloha 1416): pri `Štandard +|2x2K/2x3K/2x4K IZO` je sklo na krídlo o 10 mm
užšie než kladkový (`off_sklo = off_kladkový − 10·N`). Výroba ladí kladkový editorom, sklo šírku
editor neukazuje → bez väzby by úprava kladkového ticho rozbila pravidlo.

- **Jedno miesto pravdy = `src/lib/server/sklo-sleduje-profil.ts`** (`SKLO_SLEDUJE_PROFIL`:
  sysStyl → `profilKod` ZASP202415, `mmNaKridlo` 10). Čítajú ju `saveCfgChanges` (zápis + audit) aj
  editor `load` (`skloSledujeInfo` → `data.skloSleduje` → poznámka „↳ sklo sa posunie automaticky
  (o 10 mm užšie)" pod poľom kladkového). Nový štýl s pravidlom = riadok mapy + test, žiadne
  `system === …` v kóde.
- **Kontrakt = #504 vzor:** posuň LEN keď sa offset profilu SKUTOČNE zmenil A sklo pravidlo
  sledovalo (`skloSleduje`, tolerancia 1e-6 — offsety sú REAL, editor `step="any"`; nový offset
  `skloOffsetZProfilu` bez float šumu). Ručná výnimka (sklo nesledovalo) ostáva. Zápis ide do
  `skloMirror` (dim S) → `updSkloRez`; rámový mirror má prednosť (`skloMirror.has`). Audit pole
  „Sklo šírka (S) offset — sleduje kladkový − 10 mm (#610)". Rozširujúci (+6) sklo NEposúva.
- Nejednoznačný stav (2× Sklo šírka / chýba profil) → väzba sa neuplatní + `log.warn`, nikdy hádanie.
  Odvodené sklo mimo ±500 → `inBounds` poistka vráti celé uloženie.
- Poznámka v editore sa ukáže LEN keď sklo práve sleduje (inak by klamala).
- **SEED vs PROD:** seed nesie staršie profily (kladkový −235/−285/−335) → v čerstvej/test DB sklo
  pravidlo NEsleduje a väzba sa nechytí. Testy si PROD stav (kladkový −273/−320/−380, sklo
  −313/−380/−460) nastavia priamo v DB (`tests/cfg-editor-sklo-kladkovy-610.test.ts`
  `nastavStav`). E2E (`e2e/cfg-editor-sklo-kladkovy-610.spec.ts`) to isté cez `e2e.db` a upratuje
  OBA riadky v `finally` — raz sledujúce sklo editor ťahá s kladkovým, takže pôvodný seed stav
  (nesledujúci) sa editorom obnoviť NEDÁ (návrat kladkového by posunul aj sklo).

## Audit invariant

Každý DB zápis v `saveCfgChanges` (offset, sklo mirror, väzba sklo→kladkový #610, skloOffset, glass redukcia/korekcia,
trieda, sieťka Štandard K/R/H #569) MUSÍ mať zodpovedajúci `zmeny` záznam — `cfg_audit` je jediná stopa „kto/kedy/čo" a
Money-kritické zmeny nesmú byť tiché. Nový typ zápisu = nový `zmeny.push` v diff fáze.

**Povolené hrúbky Odoo skiel (#579 časť 2)** NIE sú súčasť `saveCfgChanges` — majú vlastné akcie
`pridatHrubku` / `odobratHrubku` (`sklo-hrubky.ts`), ale ten istý invariant: zápis do
`cfg_sklo_hrubka` + `cfg_audit` riadok (sys_styl = SYSTÉM, nie sysStyl) v JEDNEJ transakcii. Akcie
nesú `?sysStyl=…&/<akcia>` v URL (inak by load po POST-e skočil na prvý štýl) a formuláre majú
`use:enhance` — `fail(400)` bez enhance vráti 400 DOKUMENT = console error v E2E.

## Testovanie

- `saveCfgChanges` testy importujú `db` z `../src/lib/server/db` a čítajú `cfg_rez` priamo
  (sklo riadky nie sú v `getEditableRows`). Fresh test DB je automaticky migrovaná+seednutá
  (viď `testing.md` #261) → `Štandard +|2x4K IZO` aj `Robust|4K` tam existujú.
- Zmena správania mirroru → aktualizuj `tests/auth-editor.test.ts` očakávanie počtu `zmeny`
  (audit záznam mirroru sa počíta) a nezabudni, že RRED test mení NErámové pole (zmena
  rámového by mirror spustila legitímne).

## Sieťka Štandard K/R/H (#569) — GLOBÁLNE parametre z editora štýlu

`input.sietkaStandard` (Partial K/R/H) zapisuje do `cfg_sietka_standard` (jedna tabuľka pre
Štandard AJ Štandard +), hoci sa edituje z konkrétneho štýlu — audit ide pod ten `sysStyl`.
Odmietne sa mimo Štandard-rodiny a mimo `SIETKA_STANDARD_BOUNDS` (NaN z prázdneho poľa tiež).
Form pole `sietka_<k>` je `required` a action ho číta len pri `form.has` (ako trieda_6/16).
