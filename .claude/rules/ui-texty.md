---
paths:
  - 'src/**/*.svelte'
  - 'src/lib/**/*.ts'
  - 'src/routes/**/*.ts'
  - 'tests/ui-texty-bez-mien.test.ts'
---

# Texty pre používateľa — bez mien ľudí a interných odkazov (#616, Odoo úloha 1450)

Klient videl na /sietka „(Patrik: „90% si kúpi posuv…")" a pomenoval to „glupociny … texty".
Vývojárske zdôvodnenie z tiketu sa písalo priamo do textu pre dielňu namiesto do komentára.

- **Žiadny text, ktorý appka ukáže alebo vytlačí** (markup, `title`/`placeholder`/`aria-label`,
  hlášky a varovania vrátené do UI, PDF/tlač, audit editora, poznámky zapisované do Odoo, dôvody v
  DB, ktoré sa môžu zobraziť) **nemenuje ľudí** (Patrik, Dominik, Špetta, Marek, Zbyněk, Pavol …)
  **ani interné odkazy** (Odoo msg id, `#N` tiketu, číslo migrácie, Odoo úlohy, názov súboru).
- **Vecný obsah ostáva, neutrálne:** „čaká na vzorec / tabuľky od výroby", „čaká na overenie
  výrobou", „keď sa v Money založia karty", citát → obyčajná veta („Sieťka sa často objednáva až
  po montáži posuvu."). Kto/kedy/msg id patrí do KOMENTÁRA pri kóde (vzor
  `nastavenia-poznamky.ts`: `// Zdroj: Patrik, Odoo msg …` nad kľúčom) a do testov.
- **Stráž = `tests/ui-texty-bez-mien.test.ts`** (AST: TS literály cez `typescript`
  `createSourceFile`, `.svelte` cez `svelte/compiler` `parse` — komentáre nie sú uzly, takže ich
  nikdy nekontroluje). Padne so `súbor:riadok`. Nové meno → pridaj do `MENA` (kmene, chytia
  skloňovanie; prezývky ako „Palo" len celým slovom — kmeň „Pal" by chytil „Paleta"). Vzory:
  Odoo msg / „správa 1691126", `att`/`ir.attachment` id, „kanál 207", „PR 399", `#N` (aj 5+
  číslic, aj v úvodzovkách a `#137/#144`), „tiket: N", migrácia `vNN`, Odoo úloha, názov `.ts`/
  `.svelte`. Preskakuje import špecifikátory, argumenty `log.*` / `logger(…).*` / `console.*`
  (server log je pre vývoj), úsek, ktorý je len hex farba (`'#555'`, `fill="#000"`), a base64
  bloby (PNG/fonty — náhodné „PR156"). Nový vzor = nový self-test v tom istom súbore.
  `HISTORICKE_VYNIMKY` = len zbehnutá migrácia (audit text sa neprepisuje); nová výnimka musí mať
  dôvod a guard overuje, že nie je mŕtva. Dôsledok: história editora na PROD ukazuje staré
  audit riadky s „(#610)" / „Odoo úloha 1416" ďalej — to nie je regresia.
- **Pasca — text v tele PDF sa nedá prečítať** (custom font): vety, ktoré tlačí PDF, daj do
  exportovanej čistej funkcie a otestuj ju presnou rovnosťou (vzor `honestNullUpozornenie` v
  `expedicia-pdf.ts`). Inak StringLiteral mutant na zmenenom riadku prežije mutation-diff.
- **Pasca — zmena textu = zmena testov v tom istom commite:** golden snapshot
  `zasklenia-posuvspec-golden` nesie SLIDE warn text (delta len text, `planHash` sa nemení),
  `POLE_SKLO` v `cfg-editor-sklo-kladkovy-610` (unit + e2e) nesie text auditu väzby skla.
- **Viacriadkové reťazce:** pri `'…' + '…'` pozor, meno býva na ďalšom riadku; krátke „prečo"
  texty drž v JEDNOM literáli — `""` mutant celého textu potom zabije content test.
