---
paths:
  - 'src/lib/clip.ts'
  - 'src/routes/clip/**'
  - 'tests/clip.test.ts'
  - 'tests/clip-odpis.test.ts'
  - 'e2e/clip.spec.ts'
  - 'src/lib/server/clip-sklo.ts'
  - 'src/lib/components/clip/ClipForm.svelte'
  - 'tests/clip-sklo-593.test.ts'
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

UI vzor (od #554 zjednotený so zaskleniami — pozri nižšie): žiadny prepínač; prvé
zábradlie = základ, tlačidlo „➕ Pridať zábradlie" pridá ďalšie. Spoločné
zak/op/zakaznik/caka + per-kus typ/variant/sirka/vyska/ral. Kontrolná obrazovka: per-kus
nárezová tabuľka + SVG náhľad + spoločná odpisová tabuľka s editovateľnými množstvami +
spoločný rozpis rezov. Úspešná obrazovka: `finalOut` (po užívateľových úpravách), NIE
originálne polozky (review nález #468).

## #554 — CLIP ako zasklenia (UX + SVG náhľad + rozpis rezov na tyče), Patrik úloha 1009

Tri veci, VŠETKO okolo `computeClip*` (Money odpis) sa NEDOTKLO — odpis ostáva
per-riadkový ROUNDUP (1:1 Excel, kontrakt vyššie). Guard: `tests/clip-narez.test.ts`
(odpis polozky byte-identické pred/po adaptéri + žiadny Money/odpis modul neimportuje
`clip-narez`).

1. **Zjednotený formulár = `src/lib/components/clip/ClipForm.svelte`** (vzor
   `ZasklieniaForm`): prepínač „Viac kusov naraz" ZRUŠENÝ, „➕ Pridať zábradlie" je vždy
   viditeľné. Prvé zábradlie (index 0) nesie `name="typ/variant/sirka/vyska/ral"` +
   testidy `typ`/`variant`/`#sirka`/`#vyska`/`#ral` (single tok `?/spocitat` +
   pôvodné E2E ostávajú platné). Ďalšie zábradlia idú LEN cez hidden `clipKusy` JSON
   (`z{i}-*` id/testid, bez `name`). Submit prepína `formaction={jeMulti ? '?/spocitatMulti'
   : '?/spocitat'}` (`jeMulti = kusy.length > 1`). `clipKusy` = VŠETKY kusy (základ +
   ďalšie), takže `parseClipMultiVstup` (číta `clipKusy`) aj `parseClipVstup` (číta
   top-level `name=`) ostali NEDOTKNUTÉ — od #593 8 akcií (+ `pridatSkla`/`pridatSklaMulti`,
   guard `clip-odpis.test.ts`). Od #593 select výplne NEMÁ `name` (sekcia #593 nižšie).
   Stav sa inicializuje zo servera cez `seed()` funkciu (nie `$state(prop)` priamo — inak
   `state_referenced_locally` warning) a re-synchronizuje `$effect`-om pri POST round-tripe
   (echo `vstup`/`multiVstup`).

2. **SVG náhľad = `src/lib/components/ClipNahlad.svelte`** + čistá geometria
   `src/lib/clip-nahlad.ts` (`clipNahladGeom`, client-safe, unit `clip-nahlad.test.ts`).
   1 výplň = 1 obdĺžnik (0 priečok); N výplní = N polí + N−1 priečok na
   `computeClip(...).poziciePriecok` (mm od kraja, popisky ako Excel 37649 „priečka č.1
   1003,0"). Testidy `clip-nahlad`/`clip-pole`/`clip-priecka`/`clip-priecka-pozicie`.
   CLIP kreslí ROVNO (obdĺžnik), preto rez v pláne je `sikmyRez: false`.

3. **Rozpis rezov na tyče = adaptér `src/lib/server/clip-narez.ts`** `clipMaterialRows(kusy:
   ClipVypocet[]) → MaterialRow[]` cez `ffdPack` (rovnaká 7500 mm tyč `CLIP_DLZKA_TYCE` +
   kotúč `KOTUC` ako compute), vykreslený existujúcim `RozpisRezov.svelte` (pásy tyčí,
   odpad). Server (`+page.server.ts`) ho počíta a vracia ako `narez` na
   kontrola/kontrolaMulti/hotovo/hotovoMulti; stránka kreslí sekciu „Rozpis rezov na tyče —
   pre pílu". MULTI = ZDIEĽANÉ tyče naprieč zábradliami (`clipMaterialRows(multi.kusy)`,
   jeden spoločný plán — ako zasklenia multi). **Adaptér je server-only** (leží v
   `$lib/server/`, lebo `ffdPack` je server modul) — do `src/lib/clip-narez.ts` (mimo
   `server/`) NEPATRÍ (importuje `$lib/server/compute` → poison klient bundle).

   **DISPLAY-ONLY (pozor):** počet tyčí v pláne (bin-packing `ffdPack`) sa môže LÍŠIŤ od
   počtu v odpise (per-riadkový ROUNDUP) — to je zámer. Poznámka pod plánom to hovorí
   („počet tyčí v odpise = ROUNDUP podľa Excelu; pílový plán = optimalizované rozloženie").
   Excel 37649 má stĺpec „reálny počet" PRÁZDNY = OTVORENÉ: či má optimalizovaný počet
   NAHRADIŤ odpis do Money, treba spýtať Patrika (verifikačná otázka, NIE v tomto lane —
   zmena by menila Money kontrakt, #372 čaká na plné šablóny). Fixtúra pre adaptér vektory:
   izo 3000×1200 (3 výplne) → ZASP00116 2 tyče, ZASP00125 1, ZASP00119 2 (zhodné s odpisom
   pri TEJTO fixtúre; pri iných rozmeroch sa môžu líšiť).

## Money-bezpečnosť + validácia

- `parseClipVstup` (`vstup.ts`) ODMIETNE neplatný `typ` chybou — NIKDY ticho neprepadne na
  'izo' (izo vs klasika menia zasklievací kód → zlý odpis). `chybaClipVstupu` (client-safe
  v `clip.ts`) stráži rozsahy + whitelist + odvodenú šírku výplne >= CLIP_MIN_VYPLNE
  (skriptovaný POST obíde HTML5 min/max). Validácia je VARIANT-AWARE by design: plošný
  `CLIP_MIN_SIRKA` je absolútna spodná hranica, odvodená kontrola šírky výplne z N
  automaticky odmietne malé šírky pri veľkom N (#467: min. šírka 200→80, min. výplne
  50→20 — Patrik B0/N=1 od 80 mm).
- `/clip` je v `B2B_FORBIDDEN_PREFIXES` — `handle` hook presmeruje b2b PRED akciou (ako
  /bazen), takže akcia nepotrebuje vlastný `isB2B` guard. Drift guard:
  `tests/b2b-route-coverage.test.ts`.
- Dedup `UNIQUE(zak,op,live)` nedotknutý; mimo `MONEY_LIVE=1` nič do živého importu;
  `clip.ts` je client-safe (žiadny import zo `$lib/server/*`).

## #593 — výplň = Odoo sklo 6/16 mm, „Pridať sklá do objednávky", RAL z prvého zábradlia (úlohy 1214/1216/1217)

Money-NEUTRÁLNE: `typ` (šablóna izo/klasika) ostáva JEDINÝ vstup odpisu (zasklievací profil);
kontraktné vektory `tests/clip*.test.ts` nezmenené.

- **Výplň z Odoo** = mechanizmus nárezáka zasklení (#579/#594, `glass-catalog.md`): systém `CLIP`
  v `cfg_sklo_hrubka` (migrácia v55: 6 jednoduché, 16 izolačné) → `src/lib/server/clip-sklo.ts`
  `ponukaSkielClip` volá `ponukaSkielPre('CLIP', <reprezentatívna lokálna ponuka>, …)` a výsledné
  výpočtové sklo PREMAPUJE na šablónu (`Izolačné sklo 4/8/4 číre` → `izo`, `Float sklo 6 mm` →
  `klasika`). `VolbaSkla.vypocet` je pri CLIP ŠABLÓNA — klient `volbaSkla`/`rozlozVolbu` s ňou pracuje
  bez zmeny. Predvolená voľba (`naprotivok`): izo = presný náprotivok 4/8/4 číre (matcher), klasika =
  číre VSG bez povlaku (`jeKlasikaVsg` — matcher „3.3.1" na Odoo „VSG 33.1" NEsadne, zloženie „3+3 /
  PVB"). Odoo nedostupné / CLIP bez hrúbok → záloha `izo`/`klasika` (`CLIP_VYPLN_POPIS`). CLIP NIE JE
  v editore hrúbok (`/zasklenia/nastavenia` ponúka len systémy nárezáka) — zmena hrúbok CLIP = migrácia.
- **Formulár:** select výplne nemá `name`; single tok nesie hidden `typ` + `skloOdoo` (efektívny Odoo
  typ = `rozlozVolbu(volbaSkla(...))`), multi `clipKusy[].skloOdoo`. Server `parseClipVstupSOdoo` /
  `parseClipMultiVstupSOdoo` (spocitat/odoslat/pridatSkla + multi) overí typ voči ponuke A šablóne
  (izolačný typ + klasika = chyba) a doplní `skloOdooNazov` (badge „Sklo: …"); pri nedostupnom Odoo
  prijme bez overenia. `skloOdoo` je v `ClipVstup`/detaile LEN keď je zvolený (starý detail
  byte-identický); `upravit`/`upravitMulti` echo ostáva na holom parse.
- **Objednávka skla:** `sklaClip` → na zábradlie JEDEN riadok „Zábradlie i", `pocet` = N výplní,
  rozmer = `rozmerSklaClip` (výplň JE sklo; `Math.round` zo SUROVÉHO B10/C10 cez zdieľaný
  `vyplnSurova`, nie z R1 zobrazenia), `typSkla = skloOdoo || lokalnySkloClip(typ)` (`Izolačné sklo
  4/8/4 číre` / `3.3.1`, potom `priradOdooTypy`; „3.3.1" Odoo nespáruje → podklad badge
  „nepriradené"). Idempotentne, bez presmerovania (vráti `kontrola`/`kontrolaMulti` + banner
  `skla-pridane`/`skla-pridane-cudzie`); tlačidlo `pridat-skla` na kontrole aj hotovo (single/multi).
- **RAL:** `ralZabradlia(kusy, i)` (client-safe `clip.ts`) — ďalšie zábradlie ukazuje/posiela farbu
  PRVÉHO, kým ho obsluha ručne nezmení (`KusRow.ralVlastna`; pri echu zo servera = farba ≠ prvé).
  Farba ďalších žije LEN odvodene (stav má `ral: ''`) → odstránenie PRVÉHO musí ísť cez
  `bezZabradlia` (zafixuje efektívne farby; review nález #593), nikdy holý `splice(0, 1)`.
- **Šablóna bez Odoo skla** (katalóg nemá 6 mm / 16 mm): `ponukaSkielClip` jej doplní lokálnu voľbu
  (`izo`/`klasika`, warn raz) — inak by select pri `typ` tej šablóny ukázal prázdno.
- **E2E:** výber výplne VŽDY `vyberSklo(page.getByTestId('typ'), 'izo'|'klasika')` / `expectSklo`
  (na PROD sú voľby `odoo:…`), nikdy `selectOption('izo')` (aj `caka-checkbox`, `odpis-blok-override`).
  Lokálne overené aj Odoo vetvou (vite dev + mock JSON-2 s `ODOO_KATALOG_579`).
