---
paths:
  - 'src/lib/server/konfigurator-cena.ts'
  - 'src/lib/server/cennik-pergola.json'
  - 'tests/konfigurator-cena.test.ts'
  - 'scripts/konfigurator-cennik-fetch.mjs'
  - 'scripts/konfigurator-cennik-drift.mjs'
---

# Interim cenotvorba pergoly (#279) — matica montalu.sk + cenový modul

Interim cenník je REPLIKÁCIA diskrétnej matice zo živého `montalu.sk/konfigurator`
(owner rozhodnutie 2026-08-24). Modul je server-only, Money-neutrálny, **mimo verejnej
route** (zobrazenie cien = Fáza C, samostatný krok — #279 leak-guard `konfigurator.md`
ostáva). Plný reverzný rozbor: `~/.claude/work-products/konfigurator-cenotvorba/montalu-sk-pricing.md`.

## Endpoint montalu.sk — ako sa vyťaží cena (autoritatívny zdroj)

`POST https://montalu.sk/konfigurator/update-pergolas` (multipart/form-data). Read-only —
volá sa len tento cenový endpoint (ten, čo wizard volá pri prezeraní); NIKDY `submit`/`zoznam`.

- **Kontext:** GET `/konfigurator/pergoly` → `_token` (`name="_token" value="…"`), `valid_from`
  (šifrovaný, HTML-decode `&amp;`), a **session cookie** — v Netscape jare je to riadok
  `#HttpOnly_montalu.sk … montalusk_session …`. **PASCA:** naivné filtrovanie `#`-riadkov ho
  zahodí → 419 „CSRF token mismatch". Cookie parse musí `s.replace(/^#HttpOnly_/, '')` PRED
  filtrom komentárov (`scripts/konfigurator-cennik-fetch.mjs`).
- **Cenotvorný vstup je FORM pole `roofing`** (slug, napr. `dutinkovy-polykarbonat-16-mm`),
  NIE `variants` kód — ten server prepočíta z `length`+`width`+`roofing` a v odpovedi vráti
  rozlíšený variant. Posielaj `roofing`; `variants` daj ľubovoľný validný (napr. `PRLPC00040`).
- **`calculate[]`** = pole `{"model":"PRL00000"}` (LIGHT/ROBUST/MASSIVE). Odpoveď `calculate[]`
  vracia MO (`price`) + VO (`priceB2B`) **net per model PRE ZVOLENÝ roofing**. `0` = nedostupná
  kombinácia model×roofing×rozmer. Top-level `price`/`variants` skáče na prvý dostupný / flat
  variant — spoľahlivý per-model signál je `calculate[]`, nie top-level.
- Hlavičky: `X-Requested-With: XMLHttpRequest`, `X-CSRF-TOKEN: <token>`, `Cookie: <session+xsrf>`.

## Dostupnosť (pitched rodina PRL/PRR/PRM)

- polykarbonát-16 + bezpečnostné-441: LIGHT/ROBUST/MASSIVE (LIGHT len do hĺbky 4,0 m).
- izolačné-24 + panel-izo-24: len ROBUST/MASSIVE (LIGHT NIE).
- bezpečnostné-442: pre pitched **vôbec neponúkané** (skočí na flat PLPC) → v seede chýba.
- Mriežka: hĺbka 2–6 m /0,5, šírka 4–7,5 m /0,25. Zaokrúhľuje sa **NAHOR**; pod-min ⇒ min;
  nad katalóg ⇒ 0 (u nás → individuálna ponuka, NIKDY neextrapoluj).

## DPH = 23 %, half-up, EXAKTNE V CENTOCH

`sDph = round(net × 1,23, 2)` **half-up** (montalu = PHP `round()`). **PASCA:** `net*(1+0.23)`
a `net*1.23` sú v JS ROZDIELNE double (1 ULP), takže na .xx5 hraniciach FP driftne o 1 cent.
Počítaj v celých centoch: `Math.round(round(net*100) * 123 / 100) / 100`. Overené proti reálnym
montalu reťazcom vrátane hraníc: `3917,50 → 4818,53` (4818,525 NAHOR), `4095,50 → 5037,47`.

## Seed + parity

- Seed `src/lib/server/cennik-pergola.json` = **dátový JSON** (mimo 1000-r. stropu `src/**`,
  mimo coverage `include: src/lib/**/*.ts`). Musí byť **prettier-clean** (`prettier --check .`
  ho kontroluje — nie je v `.prettierignore`); po regenerácii sprav `npm run format`.
- Regenerácia: `node scripts/konfigurator-cennik-fetch.mjs` (sonda dostupnosti roofingu na
  ref. bunkách → enumeruj celú mriežku; ~550 volaní, 250 ms delay).
- **Live > research doc pri konkrétnej bunke:** research §9.3 „2×4 = 2014" bola ZASTARANÁ,
  živý endpoint dáva 2123,48. Seed odráža LIVE (to je „mirror montalu.sk"). Nezávislé kotvy
  v parity teste ber z live re-overenia, nie slepo z research §9.
- Drift-check: `node scripts/konfigurator-cennik-drift.mjs` (seed vs živý montalu, **mimo CI**,
  externá sieť). Oba `.mjs` sú eslint+prettier kontrolované (`fetch`/`FormData` sú v `globals.node`).

## Money-neutralita

Seed nesie montalu.sk **cenové kľúče** (PRL/PRR/PRM, roofing slugy) — NIE naše Money ERP kódy
(moneyKod / TS*/ZASP*/BPP*/PRP*). Modul v `$lib/server/` nie je klientsky dosiahnuteľný ani
importovaný verejnou route (guard `konfigurator-money-safety.test.ts` ostáva zelený).
