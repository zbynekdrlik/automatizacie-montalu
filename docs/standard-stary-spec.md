# ŠTANDARD (bez „+") — build spec (systém `Štandard`)

Starší posuvný systém, ktorý dielňa stále vyrába — Patrik 2026-07-27: *„a ešte máme štandard
bez +"*. **Aditívny** — Robust / Slide / Deluxe / Štandard + sa nesmú zmeniť.

Zdroj: firemný fileserver `Obchod/Nárezové plány/ŠTANDARD/štandardná koľajnica/V2 + 2mm/
Štandard starý/` — majstrovské zošity `Nárezový plán 2016.xlsx`, `… IZO.xlsx`,
`… – opona.xlsx`, `…  IZO– opona.xlsx` + ich priečinky `odpis - …` (tie určujú, čo ide do
Money). Všetky Money kódy overené naživo read-only v ostrom Money (2026-07-27).

## Architektúra

Rovnako data-driven ako Štandard +: riadky v `src/lib/server/cfg_seed.json` (`sys[]` + `rez[]`)
+ idempotentná migrácia **v17 → v18** v `db.ts`. Engine sa nemenil.

`val(row,S,V,N) = koef*DIM + offset − (kerf)`, `DIM = dim==='S' ? S : V`, `delitN` → `/N`.

## Vstupy a konštanty

`S` = šírka balkóna, `V` = výška, `n` = počet krídel jednej strany. Opona = dva polsystémy,
takže `N = 2n` (rovnaký trik ako Štandard +) a šírka sa počíta z `S/2`.

```
G (šírka prírezu) = (W − 13 − X)/n ,  W = S (basic/IZO) | S/2 (opona/IZO opona)
výška prírezu     = V − 33            (29 mm koľajnice + 4 mm)
dorazová lišta    = V − d ,  d = 7 (2K) / 9 (3K) / 11 (4K)
sklo basic+opona  = (G+14) × (V−115) ,  IZO = (G−9) × (V−135)
```

`X` per variant a počet krídel (presne ako v zošitoch — **nie je to jeden vzorec**):

| variant | 2K | 3K | 4K |
|---|---|---|---|
| basic | 103 | 130 | 157 |
| IZO | 103 | 130 | 157 |
| opona | 100 | 124 | 151 |
| IZO opona | 103 | 130 | 151 |

⚠️ Rozdiely `opona` vs ostatné (100/124 namiesto 103/130 a IZO opona 151 namiesto 157) sú
v zošitoch dielne naozaj takto — appka reprodukuje ICH súbor 1:1. Hodí sa to niekedy overiť
s Dominikom/Patrikom, či to je zámer alebo starý preklep; zmena by menila odpis.

## Profily (12 štýlov)

| profil | kód | dĺžka | ks basic/IZO | ks opona | tyč |
|---|---|---|---|---|---|
| Koľajnica horná | 2K `ZASP00107` · 3K `ZASP00027` · 4K `ZASP00036` | `S` | 1 | 1 | 7500 |
| Koľajnica spodná | 2K `ZASP00104` · 3K `ZASP00030` · 4K `ZASP00033` | `S` | 1 | 1 | 7500 |
| Kladkový prírez | `ZASP202415` | `G` | `2n` | `4n` | 3600 |
| Rámový (krajový) | `ZASP00018` | `V−33` | 2 | 4 | 7500 |
| Rámový stredový (nos) | `ZASP00024` | `V−33` | `2(n−1)` | `4(n−1)` | 7500 |
| Dorazový | `ZASP00021` | `V−d` | 2 | 2 | 7500 |
| Rozširujúci „U" (len IZO) | `ZASP202439` | šírka `G−4`, výška `V−161` | `2n` + `2n` | `4n` + `4n` | 3600 |

**IZO posúva SPODNÚ koľajnicu o veľkosť vyššie** (horná ostáva): 2K→`ZASP00030`,
3K→`ZASP00033`, 4K→`ZASP202432`.

**Rozdiel oproti Štandard +:** rám `ZASP00018` a dorazový `ZASP00021` (Štandard + má
`ZASP20244` / `ZASP202419`), medzera pri dovieraní 13 mm a **bez +2 mm reznej rezervy**
v príreze. Koľajnice, kladkový, stredový rám a „U" profil sú tie isté kódy — pooling naprieč
systémami rieši compute.

## Čo sa do Money NEZAPISUJE

Odpisové hárky dielne obsahujú len `ZASP*` kódy. Režú sa, ale v odpise nie sú (a appka ich
teda tiež nezapisuje — rovnako to má Štandard +):

- **`11016` „šírka U spodok"** (`G−3`, ×`n`, resp. ×`2n` pri opone) — kalkulačkový kód, nie ZASP
- **`K-M08039` stredová dorazová lišta** (opona) — nie je v odpisovom hárku

## Známy rozdiel: zdieľaná tyč „U" profilu

Zošit dielne počíta tyče **po riadkoch** (`ROUNDUP` využitia zvlášť za šírkové a zvlášť za
výškové kusy, potom sčíta), appka reže **skutočným FFD balením** (zmieša kusy jedného kódu na
tyč). Pri 3K IZO to dá 6 tyčí (21,6 m) namiesto 8 (28,8 m), lebo 948 mm kus sa reálne zmestí
k 2239 mm kusu na 3600 mm tyč. Rovnako sa správa aj Štandard + (rovnaký engine od v0.6.0) —
appka teda odpisuje presne toľko materiálu, koľko sa naozaj poreže. **Netreba to meniť, ale
oplatí sa to Dominikovi/Patrikovi povedať**, lebo Excel v týchto prípadoch ukáže viac tyčí.

## Mimo rozsahu (zatiaľ)

- **Varianty „s priečkou"** (`ZASP00113`) — v zošitoch existujú ku každému štýlu, ale menia
  vstup (jedno krídlo má DVE sklá inej výšky) aj model skla (engine má na štýl presne 2 riadky
  typu sklo). Treba k tomu zadanie od Patrika: ako sa priečka zadáva (výška delenia?).
- **`+ sieťka` varianty** a `1K` (jednokrídlový) — v zošitoch sú, do rozsahu nepatria.
- **B2B limity** pre `Štandard` sú dočasne skopírované zo Štandard + (800–1000 mm panel,
  2500 mm výška) — potvrdiť reálne výrobné limity.
- **Presah krídel v náhľade** (`OVERLAP_MM`) = 40 mm ako Štandard +; len kresba, Money nemení.
