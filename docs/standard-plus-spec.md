# ŠTANDARD PLUS — build spec (system "Štandard +")

New glazing system for the montalu app. **Additive** — must not change Robust/Slide/Deluxe.
Derived + numerically verified from the Money nárezák Excels; all profile codes verified live
in Money (read-only). Source analysis: 2026-07-14.

## Architecture (data-driven — almost no code)

Adding a system = DATA rows in `src/lib/server/cfg_seed.json` (`sys[]` + `rez[]`) + a DB
migration v8→v9 in `src/lib/server/db.ts` (copy the v6/Deluxe block) + a `STANDARD_GLASS` const
+ test vectors. Compute engine (`compute.ts`) is generic:

```
val(row,S,V,N) = koef*DIM + offset − (useKerf ? kerf : 0);   DIM = dim==='S' ? S : V
if (delitN) val /= N
```

Because each `sysStyl` row has a **fixed N**, every N-dependent term is folded into a **constant
`offset` and constant `pocetKs` per style**. `sikmyRez(nazov)` in `cut.ts` = `!/nos[oó]v|opon/i`
(nosový/oponový = 90°, else 45°) — affects only the rozpis drawing, NOT the Money odpis.

`rez` row schema: `{sysStyl, poradie, typ:'profil'|'sklo', kod, nazov, dim:'S'|'V', koef, offset,
delitN:0|1, kerf, pocetKs, sklozavisle:0|1, dlzkaTyce?(default 7500), skloHrubka?(0=always)}`.
`sys` row: `{sysStyl:"Štandard +|<styl>", N, skloOffset}`.

## Inputs / conventions

`S` = šírka balkóna, `V` = výška balkóna, `N` = počet krídel (= style number). `+2 mm` cutting
allowance is folded into offsets. Styles: basic `2K 3K 4K 5K 6K`; opona `2x2K 2x3K 2x4K` (the
`2x` prefix is load-bearing → forces `otvaranie='Opona'`); IZO `2K IZO … 6K IZO` (proposed label).

Per-style constants: `X(N)=27N+76` (2K130/3K157/4K184/5K211/6K238); `d(N)` dorazovka deduction
(2K 7, 3K 9, 4K/5K/6K 11); `gap` = 21.5 (basic/IZO) / 10.5 (opona). Derived: prírez base per
wing `G=(W−gap−X)/N` where `W=S` basic/IZO, `W=S/2` opona; wing height `E=V−33`; dorazovka `C=V−d`.

## BASIC variant (single glazing 4/6/10 mm)

| Profil | kod | length (mm) | pocetKs | dlzkaTyce | dim/enc |
|---|---|---|---|---|---|
| Koľajnica horná | per-style ↓ | `S` | 1 | 7500 | dim S, koef1 off0 |
| Koľajnica spodná | per-style ↓ | `S` | 1 | 7500 | dim S, koef1 off0 |
| Kladkový prírez | ZASP202415 | `(S − 21.5 − X)/N + 2` | `2N` | 3600 | dim S, koef1, delitN1, off per-style ↓ |
| Krajová (koncový PLUS) | ZASP20244 | `V − 33` | 2 | 7500 | dim V, koef1 off −33 |
| Nos (rámový stredový) | ZASP00024 | `V − 33` | `2(N−1)` | 7500 | dim V, koef1 off −33 |
| Dorazová lišta zámok | ZASP202419 | `V − d(N)` | 2 | 7500 | dim V, koef1 off −d |
| Sklo šírka | — | `G + 14` | 0 | — | typ sklo, dim S |
| Sklo výška | — | `V − 115` | 0 | — | typ sklo, dim V |

Sklo počet = `N`. **Prírez per-style offset** (= `−(21.5+X)+2N`, verified `(3000+off)/N`):
2K −147.5 · 3K −172.5 · 4K −197.5 · 5K −222.5 · 6K −247.5.

Rail codes (horná / spodná): 2K `ZASP00107`/`ZASP00104` · 3K `ZASP00027`/`ZASP00030` ·
4K `ZASP00036`/`ZASP00033` · 5K `ZASP202433`/`ZASP202432` · **6K `ZASP202438`/`ZASP202437`**
(NOT ZASP00150 — stale, 0 stock).

## IZO variant (insulated 4.8.4) = basic + učko U-frame, smaller glass, bottom rail up one size

Adds vs basic:
- **Rozširujúci "U" profil `ZASP202439`** (bar 3600): top horizontal `G−2` ×`2N`; vertical
  `V−161` ×`2N`. (Odpis writes ZASP202439 = combined bars of both.)
- **Spodná koľajnica one size up** (horná unchanged): 2K→`ZASP00030`, 3K→`ZASP00033`,
  4K→`ZASP202432`, 5K→`ZASP202437`, 6K→`ZASP202437`.
- **Glass smaller by 23×20 mm:** šírka `G−9`, výška `V−135`; type IZO 4.8.4.
- Everything else identical to basic (prírez, krajová, nos, dorazovka, X, d, gap 21.5).

**OPEN (Dominik, non-blocking):** bottom-U piece (calc code `11016`, `G−1` ×N on 4K/5K/6K) is
CUT but NOT in the odpis file → app matches the odpis (does not write it off). Confirm whether
the workshop needs it on the app cut plan + its real code.

## OPONA variant (2x2K/2x3K/2x4K) — two half-systems, W=S/2, gap=10.5

- Rails span full `S`, count 1 each, codes = per-side NK single-glass (2x2K `ZASP00107/00104`,
  2x3K `ZASP00027/00030`, 2x4K `ZASP00036/00033`; NO upsizing).
- Prírez ZASP202415 `G+2` ×`4N`; krajová ZASP20244 `V−33` ×4; nos ZASP00024 `V−33` ×`4(N−1)`;
  dorazovka ZASP202419 `V−d` ×2. (`G=(S/2 − 10.5 − X)/N + 2`.)
- Centre pieces (NOT in odpis, workshop-only): stredová dorazová lišta `K-M08039` `V−33` ×1;
  jokel 40×10 steel (no ZASP) `V−33` ×1.
- Sklo: šírka `G+14`, výška `V−115`, počet `2N`; type Float 4.

## OPONA IZO variant (2x2K/2x3K/2x4K IZO) — opona + učko U-frame (#504 round 3)

Doplnené 2026-09-11 (Patrik, úloha 854, msg 1823604 „Nárezový plán 2016 IZO + 2mm.xlsx",
hárok „4K s U PLUS opona"). Opona + IZO SA vyrába; pôvodne (#504 round 2) filtrovaná,
lebo nárezák neexistoval. `sysStyl`: `Štandard +|2x*K IZO`, `N = 2·k` (2x2K→4/2x3K→6/2x4K→8).

- **2×4K opona IZO = 1:1 z reálneho Money Excelu** (overené proti PRIAMEMU vyhodnoteniu
  formúl na S=5000/V=2100 aj S=6300/V=2400). Opona geometria (`W=S/2`) + IZO učko:
  prírez ZASP202415 `off −335 ×16`; U ZASP202439 (šírka `off −367 ×16` + výška `V−161 ×16`);
  krajová ZASP20244 `V−33 ×4`; nos ZASP00024 `V−33 ×12`; **dorazová ZASP202419 `V−d ×3`**
  (opona IZO má 3, basic/ne-opona 2!); sklo šírka `off −407`, výška `V−135`, počet `2N`.
- **Odpočet prírezu je REDUKOVANÝ** oproti opona-basic: `ded_izo(k)=27k+67.5` (= opona-basic
  `10.5+X(k)` − 19 = `18.5+X(k−1)`). NIE je to copy-paste chyba — starý systém „Štandard"
  má opona-IZO tiež s redukovaným X (`standard-stary` X 103/130/151 opona IZO vs 103/130/157
  basic), takže redukcia je reálna vlastnosť opona-IZO geometrie.
- **Spodná koľajnica:** v seede BASIC (2x2K ZASP00104 / 2x3K ZASP00030 / 2x4K ZASP00033),
  upsize o 1 (→ ZASP00030/00033/**ZASP202432**) rieši existujúci `railUpsize` + checkbox
  „prídavná koľajnica" (default zaškrtnutý pri Štandard+ IZO, #132) — presne ako pri ne-opona
  IZO. Excel má spod=ZASP202432 = 2×4K basic (ZASP00033) + 1. Horná koľajnica sa NEmení.
- **2×2K / 2×3K sú ODVODENÉ** z 2×4K vzoru (rovnaký odpočet-posun, dorazová ×3) — čakajú na
  overenie výrobou. V pláne označené „odvodené" bannerom (`odvodenyOdpisWarn` v `styl.ts`,
  `SYSSTYL_ODVODENE`). Keď Patrik dodá reálne Excely pre 2×2K/2×3K, doladia sa 1:1 a označenie
  sa zruší. **11016** (U spodok) NIE je v odpise (v Exceli prázdny riadok — ako ne-opona IZO).
- Nové profilové kódy: ŽIADNE (všetkých 12 už používajú existujúce Štandard+ štýly). Migrácia
  v47 (`migrateOponaIzo`, vzor v9 seed). IZO 4/8/4 aj 4/16/4 sklá už v katalógu (v43).

## Money codes — all 20 verified live (read-only), all exist

ZASP00107/104/027/030/036/033, ZASP202433/202432/202438/**202437**, ZASP202415, ZASP00018,
ZASP00024, ZASP20244, ZASP00021, ZASP202419, **ZASP202439**, ZASP00113, ZASP20242. Stock OK.
`ZASP00150` = stale (0 stock) → NOT used.

## Build checklist (additive, one PR)

0. Version bump on `dev` above main (→ 0.6.0, new system).
1. `cfg_seed.json`: append `sys[]` + `rez[]` for all Štandard + styles (generate from formulas).
2. `db.ts`: `STANDARD_GLASS` const + v9 migration (idempotent, copy v6 pattern), seed sys/rez/glass,
   `user_version=9`. Extend `glassTypesForSystem` if Štandard + shows only its own glasses.
3. `cut.ts`/`compute.ts`: only if cut angle differs from the name rule (determine nos angle).
4. `+page.svelte`: `sklaForSystem` if own-glasses; otherwise data-driven auto-pickup.
5. Tests: `compute.test.ts` vectors (metre/sklo verified vs Excel), `migration-v9.test.ts`
   (additive proof — Robust/Slide/Deluxe untouched), `e2e/app.spec.ts` read-only náhľad.
6. Money-safe: NEVER write test data to live Money; verify compute-only.

Source-Excel copy bugs (glass-count summary cells, kladka/kefa counts on 5K/6K) do NOT affect
the Money odpis (only ZASP profiles are odpisané) — use N/2N structural counts. `1K Plus` sheet
= different K-M profile family, NOT part of this system. `+sieťka` variants = future follow-up.
