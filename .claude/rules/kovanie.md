---
paths:
  - 'src/lib/server/komponenty-cfg.ts'
  - 'src/lib/server/kovanie.ts'
  - 'src/lib/komponenty.ts'
  - 'tests/kovanie*.test.ts'
  - 'tests/komponenty.test.ts'
---

# Kovanie do Money odpisu — rodina systému, zaradenie, zapnutie (#604)

Hlbšie kovanie pasce (RAL varianty 2k, neúplné kovanie 2l, E2E farba 2m, dve RAL dvojice 2n,
`*_PRIPRAVENY` flip 2o) sú v skille `money-odpis` — načítaj ho pred zmenou počtov/kódov.

## Kovanie sa priraďuje podľa RODINY systému, nie presného reťazca

Odoo úloha 1261 (Patrik 30.9.2026: „štandard neobsahuje kefy, zamykáč a kladku"): `komponentyPre`
porovnával `system === 'Štandard'`, takže **Štandard +** (ten istý RS STANDARD, iné len profily)
dostal `null` a `kovanieDoOdpisu` ho ticho `continue`-ol — 65 ostrých posuvov od 1.9. odišlo do
Money bez kladiek, zámkov a kefy. Nikto si to nevšimol, lebo „bez kovania" bol legálny stav.

- **Zdroj pravdy = `RODINA_KOVANIA`** (`komponenty-cfg.ts`, systém → rodina = tabuľka). Rodinou sa
  kľúčuje VŠETKO o kovaní: `komponentyPre`, `KOD_UZAVERU` (kovanie.ts, kotva protikusu/podložiek),
  `KOVANIE_NEUPLNE` (honest-null hláška), `PREDVOLENA_FARBA`, `POPIS_FARBY`. Nový variant
  existujúceho systému = JEDEN riadok v mape.
- **Výnimka: `konstPreStyl` kľúčuje PLNÝ `sysStyl`** (`Štandard +|5K IZO`) — `ZAMKY_STANDARD` sa
  preto generuje per systém rodiny (`systemyRodiny('Štandard')`) z `ZAMKY_NA_STYL_STANDARD`
  („1 ks na koncové okno": jednoduchý 2, opona 2x… 3). Štýl mimo tabuľky (napr. budúci 7K) =
  HLASNÁ chyba „nie je nakonfigurovaný počet". Robust/Slide majú vlastné ručné mapy.
- **„Bez kovania" musí byť VÝSLOVNÉ:** `SYSTEMY_BEZ_KOVANIA` s dôvodom (dnes len Štandard Drevo).
  Nezaradený systém → `kovanieDoOdpisu` vráti `err` + `log.error` a zastaví CELÝ odpis; drift
  guard `tests/kovanie-rodina.test.ts` padne nad každým systémom z `cfg_seed` bez zaradenia.
  Lookup cez `Object.hasOwn` (kľúč `toString` nesmie dať rodinu).

## Zapnutie kovania pre ďalší systém — čo sa rozbije (#604, rovnaké ako #357)

- RAL select sa ukáže SÁM (`+page.server.ts` `systemyFarba`/`ralPreSystem` z `komponentyPre`) a je
  `required` → každý E2E toho systému, čo klikne „Spočítať" bez `vyberFarbuKovania(page)`, padne
  (#604: `system-nazvy.spec.ts`). Každý unit fixture bez `farbaKovania` padne na „nie je zvolená
  farba kovania" (#604: `zasklenia-vlastna-skladba.test.ts`) — `grep -rn "system: '<Systém>'" tests/`.
- Golden snapshot `zasklenia-posuvspec-golden` sa ZÁMERNE zmení: over, že delta = LEN nové riadky
  kovania + hláška + `planHash`/filename hash. Zdieľaný kód (ZASK00007 kefa Deluxe ↔ Štandard)
  sa v multi SČÍTA (8,418 + 18,416 = 26,834), to nie je chyba.
- **Golden „pred opravou" test:** zachyť PRED zmenou úplný výstup `kovanieDoOdpisu` ostatných
  systémov a drž ho `toEqual` (vzor `tests/kovanie-standard-plus.test.ts` „ostatné systémy bez
  zmeny") — dôkaz, že sa nič iné nepohlo ani o riadok.
- **Zmiešaná zákazka × VŠETKY tri farby** (money-odpis 2n) pre nový systém s každým farebným
  susedom — vzor `kovanie-standard-plus.test.ts` „zmiešaná zákazka … všetky tri farby".
- Test helper `kov(specs, fab, farba = 'R9005')` — explicitné `undefined` spustí DEFAULT, nie
  „bez farby". Test chýbajúcej farby volaj `kovanieDoOdpisu(cfg, specs, false, undefined)` priamo.
- Opravené kovanie platí len pre NOVÉ odpisy — historické odpisy v Money ostávajú bez kovania;
  ich doplnenie je rozhodnutie ownera (zapíš na tiket), nie kód.
