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

## Rozsah — #372 OSTÁVA OTVORENÝ (len 4 drobné položky)

`dostupneVarianty` = izo [1,2,3,4] + klasika [1,2,3,4] (od 3.9.2026, Patrik msg
1789480 potvrdil, že B2/B3 klasika používa TIE ISTÉ ZASP kódy ako B0/B1 — pozri
`clip.ts` hlavička). VYLÚČENÉ (čaká na Dominikovu odpoveď — Patrik „zajtra
prezistim u dominika", 3.9.2026):

- **4 drobné položky** (vnút./vonk. tesnenie, spojovník priečky, kolík 6x12) — kódy
  `K120518`/`K120540`/`K12518`/`K80376015` v Money NEEXISTUJÚ → v katalógu `kod:null`
  (zobrazené s množstvom + „neodpisuje sa", do odpisu NEVSTUPUJÚ — honest-null).

**Len CLIP (žiadna druhá zábradlie varianta v appke):** Patrik potvrdil (msg 1789480),
že appka má riešiť LEN CLIP — druhý fyzický typ zábradlia je dopredaj starých zásob
bez matríc a appka ho nikdy neimplementovala. `/fix` (Fixy) je ODLIŠNÝ produkt (pevné
zasklenie, Cortizo) — žiadna prekrývajúca sa voľba, nič sa nemení.

## Rozšírenie 4 drobných položiek = ZMENA DÁT, nie prerábka kódu

Keď Dominik odpovie: vyplniť `kod` v `drobne` (`clip.ts`, null → skutočný kód) + Money
overenie → začnú vstupovať do odpisu automaticky (množstvá už sú: tesnenie bm,
spojovník 2N+2, kolík 4N). ZERO zmien v compute/route.

## T16 pasca (šablónová chyba) — appka ju NIKDY nezdedila, dnes overená pinom

Šablóna „FIX - klasika.xlsx" mala v B2/B3 hárkoch `T16` (počet ks pre delenie
priečkovej tyče) napevno `=1` namiesto `=F16` (počet priečok = N-1, ako v IZO) —
Patrik potvrdil „Bude chyba" (msg 1789480). appka NIKDY neimplementovala šablónu
bunka-po-bunke: `computeClip` je JEDEN parametrický vzorec zdieľaný pre všetky
typy×varianty, priečka vždy dostáva skutočný `pocetKs = N - 1` — takže T16 pascu
appka nikdy nezdedila, ani keď bola klasika B2/B3 vylúčená whitelistom. Anti-
regresný pin: `klasika B3 (N=4) 3000×2600` v `tests/clip.test.ts` (priečka rozmer
2552 mm → `zaokruhlene=2`; BROKEN T16=1 by dal `ROUNDUP(1/2)=1 tyč`, SPRÁVNE
T16=F16=3 dáva `ROUNDUP(3/2)=2 tyče`) — nikdy nezníž bez re-overenia proti tejto
matematike.

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

## Multi režim (#468 fáza 2) — batch výroba viacerých CLIP kusov

`computeClipMulti(vstupy)` počíta každý kus NEZÁVISLE cez `computeClip` (per-riadkový
ROUNDUP, 1:1 parita s Excelom) a výsledné tyče per Money kód SČÍTA naprieč kusmi.
ŽIADNY bin-packing — 2× identický kus = presne 2× tyče (kontraktné testy v
`tests/clip-multi.test.ts`). Server akcie `spocitatMulti`/`odoslatMulti`/`upravitMulti`
v `+page.server.ts`; parser `parseClipMultiVstup` v `vstup.ts` (JSON pole kusov z
hidden inputu `clipKusy`, max 12 kusov). `jobForMulti` produkuje jeden OdpisJob so
spoločnou zak/op hlavičkou; dedup `UNIQUE(zak,op,live)` NEDOTKNUTÝ.

UI vzor: toggle checkbox „Viac kusov naraz" na formulári; spoločné zak/op/zakaznik/caka
+ per-kus typ/variant/sirka/vyska/ral. Kontrolná obrazovka: per-kus nárezová tabuľka +
spoločná odpisová tabuľka s editovateľnými množstvami. Úspešná obrazovka: `finalOut`
(po užívateľových úpravách), NIE originálne polozky (review nález #468).

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
