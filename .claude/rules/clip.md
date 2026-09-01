---
paths:
  - 'src/lib/clip.ts'
  - 'src/routes/clip/**'
  - 'tests/clip.test.ts'
  - 'tests/clip-odpis.test.ts'
  - 'e2e/clip.spec.ts'
---

# CLIP zábradlie (nárez + Money odpis) — #372

Modul počíta nárez CLIP zábradlia z rozmerov + počtu výplní a odpíše profily do
Money. Vzor: `bazen-komponenty.ts` (katalóg + honest-null) + FIX (formulár) +
bazén (odpisový tok). Zdroj: Patrikove šablóny „FIX - klasika / FIX - IZO",
kanál 207; extrahované vzorce `~/.claude/work-products/ch207-att-2026-09-01/clip-vektory.md`.

## Rozsah je zámerne ČIASTOČNÝ — #372 OSTÁVA OTVORENÝ

Implementovaná je len **ČISTÁ ČASŤ**: `dostupneVarianty` = izo [1,2,3,4] + klasika
[1,2]. VYLÚČENÉ (čakajú na Patrikove odpovede — draft otázok na tickete #372):

- **klasika B2/B3** — šablóna má `KM12 Z516`/`KM12Z518`/`K-M12Z517`, ktoré v Money
  NEEXISTUJÚ (copy-paste zo staršej šablóny).
- **4 drobné položky** (vnút./vonk. tesnenie, spojovník priečky, kolík 6x12) — kódy
  `K120518`/`K120540`/`K12518`/`K80376015` v Money NEEXISTUJÚ → v katalógu `kod:null`
  (zobrazené s množstvom + „neodpisuje sa", do odpisu NEVSTUPUJÚ — honest-null).

## Rozšírenie = ZMENA DÁT, nie prerábka kódu (design je na to postavený)

Keď Patrik odpovie:

- **klasika B2/B3:** doplniť potvrdené kódy do katalógu (`KOD_*` v `clip.ts`) + rozšíriť
  `dostupneVarianty('klasika')` na [1,2,3,4] + pridať 2 kontraktné vektory do
  `tests/clip.test.ts` + ŽIVO overiť kódy v Money. ZERO zmien v compute/route. Vtedy sa
  rieši aj **T16 pasca** (šablónová chyba: v `klasika` B2/B3 sa delenie tyče priečky
  nescaluje s N — `T16=1` napevno namiesto `F16`; v IZO je opravené). Dnes ju vylúčenie
  variantov úplne obchádza (T16==F16 pre všetky implementované hárky).
- **4 drobné položky:** vyplniť `kod` v `drobne` (null → skutočný kód) + Money overenie →
  začnú vstupovať do odpisu automaticky (množstvá už sú: tesnenie bm, spojovník 2N+2,
  kolík 4N).

## Jednotný parametrický vzorec (8 hárkov = 1 rodina, nie 8 nezávislých)

`šírka výplne (B10) = (B6 − (19+29·N))/N − 8`, `výška výplne (C10) = C6 − 56`, N = počet
výplní. Počet tyčí per riadok = `ROUNDUP(ks / ROUNDDOWN(7500/rozmer))` (`Math.ceil` /
`Math.floor`) — PRESNE ako šablóna (per-riadkový ROUNDUP, NIE bin-packing; kontrakt je
1:1 parita s Patrikovým Excelom). Odpis = súčet tyčí per Money kód (`mj:'ks'` — Money
artikle sú 7500 mm tyče).

- **ROUNDDOWN/ROUNDUP počítaj zo SUROVÉHO (nezaokrúhleného) rozmeru** — `R1(rozmer)` je len
  na zobrazenie, nikdy nevstupuje do `Math.floor(7500/rozmer)`.
- **Invariant `CLIP_MAX_SIRKA < CLIP_DLZKA_TYCE`** (test v `clip.test.ts`): najväčší rozmer
  je šírka; ak by presiahla 7500, `ROUNDDOWN(7500/rozmer)=0` → šablónový IFERROR = 0 tyčí =
  tichý podhodnotený odpis. Pri rozširovaní rozsahu tento pin NEporušiť.
- **NIKDY nečítaj variant z popisku `G2`** (v šablóne chybne skopírovaný — B0/B1/B2 hárky
  hlásia „Varianta B2"). Počet výplní je `N` (z formulára / mena hárku).

## Money kódy — ŽIVO overené (STEP 0), Model_UserData je kľúčový

ZASP00116 (rám) / ZASP00125 (priečka) / ZASP202413 (klasika zasklievací) / ZASP00119
(izo zasklievací): Deleted=false, skladová karta, `Model_UserData='Pevné zasklenie Clip'`.
Overenie cez `money-ro-thirdparty` bridge z **dev2** (`~/devel/montalu/n8n/`, tunel +
`pymssql`, DB `S4_Agenda_MONT_ALUSro`) — `Model_UserData` check je to, čo odlíši správny
CLIP profil od rovnomenného profilu iného systému (money-odpis skill §1). Bridge NEbeží z
dev1 (kľúč je len na dev2).

## Money-bezpečnosť + validácia

- `parseClipVstup` (`vstup.ts`) ODMIETNE neplatný `typ` chybou — NIKDY ticho neprepadne na
  'izo' (izo vs klasika menia zasklievací kód → zlý odpis). `chybaClipVstupu` (client-safe
  v `clip.ts`) stráži rozsahy + whitelist + odvodenú šírku výplne > 0 (skriptovaný POST
  obíde HTML5 min/max).
- `/clip` je v `B2B_FORBIDDEN_PREFIXES` — `handle` hook presmeruje b2b PRED akciou (ako
  /bazen), takže akcia nepotrebuje vlastný `isB2B` guard. Drift guard:
  `tests/b2b-route-coverage.test.ts`.
- Dedup `UNIQUE(zak,op,live)` nedotknutý; mimo `MONEY_LIVE=1` nič do živého importu;
  `clip.ts` je client-safe (žiadny import zo `$lib/server/*`).
