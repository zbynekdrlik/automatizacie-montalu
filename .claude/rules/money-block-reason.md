---
paths:
  - "src/lib/server/money.ts"
  - "src/lib/server/money-override-audit.ts"
  - "src/lib/server/money-historia.ts"
  - "src/lib/server/money-dedup.ts"
  - "src/lib/components/OdpisBlok.svelte"
  - "tests/money-override-ledger.test.ts"
  - "tests/money-dorobenie*.test.ts"
  - "tests/money-potvrdenie-replay-608.test.ts"
---

# Pridanie nového `status:'blocked'` dôvodu do `writeOdpis` (audited-override vzor)

`writeOdpis` (money.ts) blokuje live odpis viacerými dôvodmi so ZDIEĽANOU audited-override
sémantikou: `ledger-duplicate` (#294), `unknown-kod` (#295), `prehodene-polia` (#307), `uz-odpisane`
(#608 dorobenie — nižšie). Keď pridávaš
ĎALŠÍ dôvod, NEVYMÝŠĽAJ paralelnú mašinériu — skopíruj presne #295/#307 vzor a dotkni sa VŠETKÝCH
6 miest (jedno zabudnuté = tichý únik alebo type/test chyba):

1. **`OdpisOutcome.reason` union** — pridaj `'<novy-dovod>'` (+ doc riadok).
2. **`writeOdpis` opts (`OdpisOverride`)** — pridaj `override<Dovod>?: boolean`. Blok vetva (LEN pre
   `live===1`, inak WARN-only, aby sa E2E/test toky nerozbili): keď `opts.override<Dovod> !== true` →
   `return { status:'blocked', reason:'<novy-dovod>', live:true, target, filename }` PRED akýmkoľvek
   DB/file zápisom; inak nastav `overriding<Dovod> = true` a pokračuj.
3. **`auditOverride<Dovod>(job)`** — žije v `money-override-audit.ts` (#608 large-file-split, money.ts
   je na strope), píše `cfg_audit`, volaná AŽ v `db.transaction` (`if (overriding<Dovod>)
   auditOverride<Dovod>(job)`). Prečo v transakcii: inak by vznikol falošný audit „odoslaný napriek
   varovaniu" aj keď to následne zablokoval ledger a REÁLNE sa nič neodoslalo (#300 review 🟡).
4. **`blok<Dovod>Hlaska(...)` + dispatch v `blokHlaska`** — jedno miesto pravdy pre hlášku bloku
   naprieč modulmi.
5. **`overrideOpts(form)`** — pridaj `override<Dovod>: o.includes('<novy-dovod>')` (číta `getAll`,
   takže viac blokov naraz sa prekoná v jednom re-submite, bez ping-pongu). **PASCA:** v
   `tests/money-override-ledger.test.ts` je 4× exact-shape `expect(overrideOpts(...)).toEqual({...})`
   — každá padne na nový kľúč (`+ overridePrehodene: false`). MUSÍŠ ich zosúladiť (pridať nový kľúč
   do každého `toEqual`), to NIE JE oslabenie testu — je to rozšírený kontrakt. Chytí to len FULL
   suite, nie tvoj nový test súbor, takže to nezmeškaj. (`undefined` kľúč `toEqual` ignoruje.)
6. **`OdpisBlok.svelte`** — rozšír `blokReason` union o `'<novy-dovod>'` + pridaj `potvrd` vetvu
   (confirm text). Modulové `+page.server.ts` akcie posielajú `outcome.reason!` → `blokReason`
   GENERICKY, takže widening unionu je jediná potrebná wiring zmena (svelte-check ju vynúti).
   Re-submit polia stavia `rawFormEntries(form, outcome)` — `outcome` je POVINNÝ (#608), takže blok,
   ktorý potrebuje doplniť vlastné skryté pole (token), ho doplní tam a žiadny modul ho nezabudne.

Blok DÔVODOV poradie: kde je operátor má chybu opraviť pri ZDROJI (napr. prehodené polia — zadať
správne OP), daj blok PRED #295 kódovú validáciu.

## `uz-odpisane` — DOROBENIE (#608, Odoo úloha 1380): výnimky zo vzoru vyššie

Druhý/ďalší odpis tej istej zákazky/OP v TOM ISTOM module (zlé zameranie, posuv sa vyrába znova).
Celé rozhodnutie (cross-modul, rezervácia, `uz-odpisane`, token) žije SYNCHRÓNNE v
`money-dedup.ts` (`rozhodniDedup`, `potvrdenieTokenPre`, `ledgerCounts` — re-export z money.ts).
Odlišnosti, ktoré NIE sú chyba:

- **Platí pre live AJ test** (nie „LEN live=1"): dedup blokoval vždy oba režimy, E2E beží v TEST
  (`e2e/odpis-dorobenie-608.spec.ts`). Ochrana sa nemení: bez potvrdenia sa NIČ nezapíše.
- **Potvrdenie = flag + TOKEN STAVU LEDGERU.** `override=uz-odpisane` sám nestačí — `overrideOpts`
  číta aj `potvrdenie_token` (celé číslo ≥ 0) a `writeOdpis` ho prijme LEN keď sa rovná
  `potvrdenieTokenPre` = `MAX(id)` append-only `odpis_imported` pre (modul, live, zákazka/OP — norm ∪
  legacy RAW). Token pridá `rawFormEntries(form, outcome)` z `outcome.potvrdenieToken` (starý nahradí).
  **PASCA (review 🔴, opravené):** prvá verzia mala token `MAX(poradie)` — stavová hodnota, ktorú
  „Uvoľniť" VRÁTI späť (uvoľnenie dorobenia → max znova 1) → replay starého formulára po Uvoľniť
  (refresh/späť na výsledku) zapísal identický doklad ešte raz. Token musí byť MONOTÓNNY a mimo dosahu
  „Uvoľniť" → ledger (každý reálny zápis pridá `import`, Uvoľniť ho nemaže). Rovnaký token stráži aj
  #300 `ledger-duplicate` „Odoslať aj tak" (mal tú istú replay dieru). Test cestou formulára:
  `tests/money-potvrdenie-replay-608.test.ts`.
- **Súbeh:** precheck→INSERT je synchrónny (žiadny `await` medzi) — dva súbežné POSTy s tým istým
  tokenom: druhý už vidí posunutý ledger → blok.
- **Množina existujúcich = normalizovaný kľúč ∪ RAW kľúč** (`zak = ? AND op = ?` = presne kľúč DB
  UNIQUE): legacy riadky spred v27 majú `op_norm` RAW kópiu ('01' vs `normOp` 'OP01') — bez RAW
  vetvy by skončili na UNIQUE poistke ako dead-end `duplicate` bez ponuky dorobenia. UNIQUE catch je
  teraz len posledná poistka DB (v jednom procese nedosiahnuteľná).
- **Ledger prekoná TO ISTÉ potvrdenie** (identický obsah = typické dorobenie): `overridingLedger =
  wouldBlock && (overrideLedger+token || overridingDorobenie)`, override riadok s dôvodom „dorobenie
  č. N", JEDEN audit (`auditOverrideDorobenie`, spomenie prekonaný ledger). Blok to vopred prizná
  (`outcome.identickyObsah` → veta „ROVNAKÝ obsah už Money raz naimportoval"). Pri ZLYHANÍ zápisu
  súboru kompenzácia zmaže aj override + `cfg_audit` riadok DOROBENIA (token sa vráti na stav bloku → retry s TÝM ISTÝM potvrdením prejde; #300 override ostáva).
- **Tvrdý `duplicate` ostáva (žiadne dorobenie):** cross-modul identický obsah (#380) — kontroluje sa
  PRED `uz-odpisane`, aby sa operátorovi neponúklo zbytočné dorobenie; a pergola rezervácia ⇄ odpis
  (#221 — existujúci riadok s `detail.rezervacia` cez `json_valid`+`json_extract`, alebo nový job s
  `rezervacia:true`).
- **Poradie > 1 = vlastný súbor** `ZAK - zákazník dorobenie-N [hash].xlsx` (`filenameFor(job,
  poradie)`) — identický obsah by inak prepísal prvý, ešte nespracovaný doklad (alebo parkovaný v NA
  ODPIS). Prvý odpis názov nemení. Tmp súbor ostáva `.tmp-<hex>` (nikdy `*.xlsx`).
- Nadväznosti: `odpis_odpad` (`saveOdpisOdpad` berie najnovší riadok zak/op → dorobenie má vlastné
  riadky), `zakazkaPrehlad.dorobeni` + Odoo note/PDF veta „Súčet zahŕňa dorobenie", `DorobenieBadge`
  (/odpisy, detail, zákazka), Uvoľniť/Povoliť rovnaký per riadok s „(dorobenie N)" v audite, kiosk
  doc_id `-d<N>` (`plan-rezov-kiosk.md`; dve dorobenia č. N rôznych modulov tej istej OP zdieľajú
  doc_id ZÁMERNE — `lines`/PDF sú kombinácia celej OP, novší stav vyhrá), readback páruje dva doklady
  exkluzívne bez zmeny kódu.
