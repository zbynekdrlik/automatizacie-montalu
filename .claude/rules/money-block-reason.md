---
paths:
  - "src/lib/server/money.ts"
  - "src/lib/components/OdpisBlok.svelte"
  - "tests/money-override-ledger.test.ts"
---

# Pridanie nového `status:'blocked'` dôvodu do `writeOdpis` (audited-override vzor)

`writeOdpis` (money.ts) blokuje live odpis viacerými dôvodmi so ZDIEĽANOU audited-override
sémantikou: `ledger-duplicate` (#294), `unknown-kod` (#295), `prehodene-polia` (#307). Keď pridávaš
ĎALŠÍ dôvod, NEVYMÝŠĽAJ paralelnú mašinériu — skopíruj presne #295/#307 vzor a dotkni sa VŠETKÝCH
6 miest (jedno zabudnuté = tichý únik alebo type/test chyba):

1. **`OdpisOutcome.reason` union** — pridaj `'<novy-dovod>'` (+ doc riadok).
2. **`writeOdpis` opts** — pridaj `override<Dovod>?: boolean`. Blok vetva (LEN pre `live===1`, inak
   WARN-only, aby sa E2E/test toky nerozbili): keď `opts.override<Dovod> !== true` → `return {
   status:'blocked', reason:'<novy-dovod>', live:true, target, filename }` PRED akýmkoľvek DB/file
   zápisom; inak nastav `overriding<Dovod> = true` a pokračuj.
3. **`audit Override<Dovod>(job)`** — píše `cfg_audit`, volaná AŽ v `db.transaction` (`if
   (overriding<Dovod>) auditOverride<Dovod>(job)`), rovnako ako `auditOverrideKody`. Prečo v
   transakcii: inak by vznikol falošný audit „odoslaný napriek varovaniu" aj keď to následne
   zablokoval ledger a REÁLNE sa nič neodoslalo (#300 review 🟡).
4. **`blok<Dovod>Hlaska(...)` + dispatch v `blokHlaska`** — jedno miesto pravdy pre hlášku bloku
   naprieč modulmi.
5. **`overrideOpts(form)`** — pridaj `override<Dovod>: o.includes('<novy-dovod>')` (číta `getAll`,
   takže viac blokov naraz sa prekoná v jednom re-submite, bez ping-pongu). **PASCA:** v
   `tests/money-override-ledger.test.ts` je 4× exact-shape `expect(overrideOpts(...)).toEqual({...})`
   — každá padne na nový kľúč (`+ overridePrehodene: false`). MUSÍŠ ich zosúladiť (pridať nový kľúč
   do každého `toEqual`), to NIE JE oslabenie testu — je to rozšírený kontrakt. Chytí to len FULL
   suite, nie tvoj nový test súbor, takže to nezmeškaj.
6. **`OdpisBlok.svelte`** — rozšír `blokReason` union o `'<novy-dovod>'` + pridaj `potvrd` vetvu
   (confirm text). Modulové `+page.server.ts` akcie posielajú `outcome.reason!` → `blokReason`
   GENERICKY, takže widening unionu je jediná potrebná wiring zmena (svelte-check ju vynúti).

Blok DÔVODOV poradie: kde je operátor má chybu opraviť pri ZDROJI (napr. prehodené polia — zadať
správne OP), daj blok PRED #295 kódovú validáciu.
