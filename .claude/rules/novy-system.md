---
paths:
  - "src/lib/server/cfg_seed.json"
  - "src/lib/server/migracie-seed.ts"
  - "src/lib/server/migracie.ts"
---

# Pridanie nového systému — periférny checklist (#445)

`money-odpis` skill §3 pokrýva cfg_seed.json + migráciu. Tento checklist pokrýva
VŠETKY ďalšie miesta, ktoré sa musia dotknúť — vynechanie hociktorého spôsobí buď
drift-guard pád v CI, alebo tichý bug (ako Yellow 1 z #445: klientský glass filter
nealiasoval "Štandard Drevo" → formulár ponúkal zlé sklá a každý submit zlyhal).

## Checklist (po cfg_seed.json + migrácii)

1. **`src/lib/server/db.ts` — `GLASS_SYSTEM_ALIAS`**: ak nový systém zdieľa sklo
   katalóg s existujúcim (Štandard Drevo → Štandard +), pridaj alias. Inak seeduj
   vlastný glass_types v migrácii.
2. **`src/routes/zasklenia/+page.svelte` — `sklaForSystem` klientský filter**: MUSÍ
   aliasovať TEN ISTÝ systém na TOŽ ISTÝ `g.system` ako server (`GLASS_SYSTEM_ALIAS`).
   Tieto dva aliasy DRIFTUJÚ — server db.ts vs klient +page.svelte — a drift je tichý
   bug (ponúkne zlé sklá, submit padne). Pri každom novom aliase v db.ts over aj
   +page.svelte:98+.
3. **`src/lib/cut.ts` — `systemRovnyRez`**: Štandard rodina reže všetko na 90°.
4. **`src/lib/cut.ts` — `OVERLAP_MM`**: presah krídel (len náhľad, nie Money). Drift
   guard: `tests/compute.test.ts` "OVERLAP_MM má hodnotu pre každý systém v cfg".
5. **`src/lib/b2b-limits.ts` — `B2B_LIMITS`**: min/max panel + maxHeight. Drift guard:
   `tests/b2b-limits.test.ts`.
6. **`src/lib/system-nazvy.ts` — display name**: voliteľné (neznámy systém sa vráti
   nezmenený), ale dielna vidí display name.
7. **`src/lib/profil-obrazky.ts` + `static/profil/`**: NOVÉ kódy potrebujú rez obrázok.
   Buď `scripts/sync-profil-obrazky.sh` (Money dual-hop), alebo placeholder + finding.
   Drift guard: `tests/profil-obrazky.test.ts`.
8. **user_version head-bump**: `grep -rl "toBe(<old>)" tests/ | sed "/user_version/
   s/toBe(<old>)/toBe(<new>)/"` — aktuálne ~30 súborov.
9. **`tests/kolajnica-rucna.test.ts`**: ak systém má oddelenú hornú + spodnú koľajnicu,
   drift guard vyžaduje pridanie do expected zoznamu.

## koef != 1 v rez riadkoch

Engine `val()` akceptuje koef != 1 (napr. 0.5 pre centered priečku = V/2 ± offset).
Overené #445: `val(row, S, V, N, useKerf)` = `koef * DIM + offset` (potom `/N` ak
`delitN`). `profilCuts` aj `ffdPack` s tým pracujú bez zmien. Užitočné pre systémy
s priečkou alebo iným proporčným delením rozmeru.
