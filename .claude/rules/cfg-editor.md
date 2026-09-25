---
paths:
  - "src/lib/server/cfg-editor.ts"
  - "src/routes/zasklenia/nastavenia/**"
  - "tests/auth-editor.test.ts"
  - "tests/cfg-editor-*.test.ts"
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
  žiadny rámový S → sklo S sa nezrkadlí vôbec.
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

## Audit invariant

Každý DB zápis v `saveCfgChanges` (offset, sklo mirror, skloOffset, glass redukcia/korekcia,
trieda, sieťka Štandard K/R/H #569) MUSÍ mať zodpovedajúci `zmeny` záznam — `cfg_audit` je jediná stopa „kto/kedy/čo" a
Money-kritické zmeny nesmú byť tiché. Nový typ zápisu = nový `zmeny.push` v diff fáze.

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
