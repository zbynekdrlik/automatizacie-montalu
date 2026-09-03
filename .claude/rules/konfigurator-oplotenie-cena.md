---
paths:
  - 'src/lib/server/konfigurator-oplotenie-cena.ts'
  - 'src/lib/server/konfigurator-oplotenie-vstup.ts'
  - 'src/lib/server/cennik-oplotenie.json'
  - 'tests/konfigurator-oplotenie-cena.test.ts'
  - 'scripts/konfigurator-oplotenie-cennik-fetch.mjs'
  - 'scripts/konfigurator-oplotenie-cennik-drift.mjs'
---

# Interim cenotvorba oplotenia (#410) — matica montalu.sk `update-fencings` + kompozitný systemKod

Zrkadlo bazénovej interim cenotvorby (`konfigurator-bazen-cena.md`), parametrizované na oplotenie osi.
Server-only, Money-neutrálne. #410 ODBLOKOVAL orientačnú cenu oplotenia (`cenovyZdroj:true`).

## Endpoint montalu.sk — oplotenie signatúra má NAJVIAC osí

`POST https://montalu.sk/konfigurator/update-fencings` (multipart). Konfigurátor:
`GET /konfigurator/oplotenia` (NEOČAKÁVANÝ slug — `-oplotenia`, nie `-oplotenie` /404/). Read-only,
len cenový endpoint. Kontext (token/valid_from/session cookie) rovnako ako pergola/bazén.

- **Cenotvorný vstup:** `type[0]` (typ prvku slug) + `count[0]` + `height[0]`/`width[0]` (v METROCH) +
  `calculate[]` = `{"model":<kod>}`. `configurator_id=fencings`.
- **Typy (montalu slug):** `plotovy-diel` (diel), `brana|dvojkridlova` (kridlova), `brana|posuvna`
  (posuvna), `brana|samonosna` (samonosna), `branka` (branka). POZOR: brána slugy obsahujú `|`.
- **Modely (calculate kód):** ARIEL/BIANCA/LUNA/NARVI/**PLBP00001=PANDORA**/REA. PANDORA má v montalu
  form kóde `PLBP00001` (ostatné = ich display názov); mapa je v seede `modely`.
- **Odpoveď:** `calculate.model_<kod> = {value, price (MO net), priceB2B (VO net)}`; `0`/absent =
  mimo katalógovej obálky. Cena NEZÁVISÍ od farby ani warranty (**warranty = plochý príplatok LEN na
  top-level `price`, nie v `calculate[]`** — orientačnú cenu berieme z `calculate[]`, teda BEZ warranty);
  počet je LINEÁRNY (enumerujeme count=1, násobí modul). Cena = f(typ, model, výška, šírka) × počet.
- **Reverzné odvodenie = Playwright network capture, NIE WebFetch** (§12 pasca): request tvar (`type[N]`/
  `count[N]`/`height[N]`/`width[N]` + `calculate[]`) sa nedá vyčítať zo statického HTML (JS-driven form).

## Mriežka + envelope + kompozitný cfg kľúč

- Naša mriežka: výška 0,6–2,2 m /0,1, šírka 1,0–6,0 m /0,5 (`OPLOTENIE_RANGES`; RozmerStepper výška krok
  100 mm, šírka 500 mm) → seed enumerujeme PRESNE v týchto bodoch → lookup EXAKTNÝ pre on-grid vstupy.
- **Obálka je PER-TYP** (mimo obálky bunka v seede CHÝBA → individuálna ponuka): plotový diel výška
  ≤2,0 m / šírka ≤3,5 m; brány šírka do 6,0 m; **bránka šírka len do 1,5 m** (peší vstup); všetky typy
  výška ≤2,0 m (nad → individuálna, hoci mriežka ide do 2,2). ATYP model = na mieru → vždy individuálna.
- **Cenotvorný kľúč = NEUTRÁLNE pole `systemKod = "${typKod}|${model}|${vyskaMm}|${pocet}"`** (šírka
  ostáva v `cfg.sirka`). Rendered riadky ostávajú `[Systém, Šírka, Farba konštrukcie, Popis]` (výška/
  počet v „Popis" texte) — ZERO zmien v zdieľanom `ponuka.ts` (na rozdiel od bazénového `dlzka`+
  `systemKod`, oplotenie potrebovalo LEN kompozitný systemKod). typKod (`diel`/`posuvna`/…) ani model
  neobsahujú `|`, takže delimiter je bezpečný; `systemKod` prežije `sanitizePonukaConfig` (cap 120).

## DPH 23 % half-up v centoch + HRANIČNÁ parity kotva

`sDphEur` = `Math.round(round(net*100)*123/100)/100` (identické s pergolou/bazénom; PHP `round()`).
**`verifikaciaDph` MUSÍ obsahovať .xx5 hranicu** — fetch skript ju AUTO-nájde skenovaním celej matice
(bunka, kde naivné `net*1.23` driftne od celocentového half-up) a doplní do vzoriek. Kotva #410:
posuvná/BIANCA 1,5×4,5 m — MO net 4009,5 → montalu „4 931,69" (naivné FP dá 4931,68). Parity test
navyše asertuje, že aspoň jedna hranica v seede EXISTUJE (inak by test half-up nerozlíšil).

## Produkt-aware cenová dispatch (aditívne rameno)

- `dopyt-cena-stamp.cenaZCfgProdukt(cfg, 'oplotenie', hladina)` → JEDNO rameno `cenaOplotenieZCfg(cfg)`
  (parsuje `systemKod` + číta `cfg.sirka`; bez `systemKod` — starý neopečiatkovaný riadok — vráti null,
  honest-degrade). `cennikVerziaProdukt` má vlastné oplotenie rameno. Dispatch je PRODUKT-IZOLOVANÝ:
  pergolotvarová cfg (bez oplotenie `systemKod`) pod „oplotenie" NEDOSTANE pergolovú cenu.
- **PASCA:** akýkoľvek NOVÝ volateľ `generatePonukaPdf` MUSÍ zaniesť `produkt` (inak by cfg dostala
  nesprávnu cenu). `regeneratePonukaPdf` (#309) už `produkt` nesie → re-download reprodukuje cenu.

## Zapojenie na stránke + guardy

- Oplotenie podstránka: `vypocet` akcia (server cena) + on-page orientačná cena cez `use:enhance` (klik
  „Zobraziť orientačnú cenu"; `cenaAktualna` gating — pri zmene typu/modelu/rozmeru/počtu cena zmizne,
  „Prepočítať", NIKDY cena pre iný vstup). `use:enhance` MÁ `result.type==='error'` vetvu. Cena je INLINE
  (`opl-cena-*`), jednostĺpec bez 3D (vedomá voľba, tier B).
- b2b-route-coverage: oplotenie action-set `['dopyt','vypocet']`. Money-safety (C): oplotenie `load` NENESIE
  cenu (cena je až vo `vypocet` akcii, MO — nie VO/matica). Static guard v `konfigurator-oplotenie-cena.test.ts`
  (seed+modul bez moneyKod/BPK*; **v komentároch píš „Money kód", NIE literál `moneyKod`** — inak guard
  false-flagne vlastný modul, #387 pasca).
- Seed `cennik-oplotenie.json` = dátový JSON (~112 KB / 4750 riadkov, 3690 buniek — najväčší z cenníkov), musí byť
  **prettier-clean** (`npm run format` po regen). Model kód `PLBP00001` je montalu CENOVÝ kľúč, NIE Money
  ERP — nematchuje `\bBP[KP]\d{5}\b` (word-boundary pred „BP" v „PLBP" nie je).

## Review pasce (reusable pre ĎALŠÍ produktový cenový modul)

- **Whitelist-mapping drift guard (`nazov → montalu slug`) čo LEN `toContain(mapovanaHodnota)` je
  VÁKUOVÝ (#429 review 🔵).** Vzor `roofingPreZasklenie`/`glazingPreSystemStien`: preklep v `nazov`
  (alebo kolízia dvoch mien na jeden slug) sa TICHO degraduje na bázový slug — a bázový slug je VŽDY
  prítomný v seede, takže `expect(Object.keys(seed), nazov).toContain(mapovanaHodnota)` prejde AJ
  keby whitelist mapoval DVE rôzne mená na TEN ISTÝ slug (drift by nič nechytilo). Skutočný drift
  guard musí dokázať RÔZNOSŤ, nie len prítomnosť: `expect(new Set(katalog.map(nazov =>
  mapujFn(nazov))).size).toBe(katalog.length)` — kolízia zmenší veľkosť množiny a test padne.
  Aplikuj pri KAŽDOM novom whitelist-mapping teste (zasklenie→roofing, systém stien→glazing, typ→slug…).
- **Fetch skript, ktorý zbiera .xx5 DPH-hraničné kotvy s CELKOVÝM stropom, ich pri viac-osovej matici
  môže poslať VŠETKY z jednej hodnoty vonkajšej osi (#429 review 🔵).** Keď je nová os (napr. `glazing`
  #429) VONKAJŠIA slučka a kotva-hľadanie má len jeden globálny counter (`verifikaciaDph.length < N`),
  prvých N nájdených .xx5 buniek príde z PRVEJ hodnoty tej osi (živý dôkaz: 6/6 kotiev bolo len z
  `delux|kalene-sklo-10-mm`) — DPH aritmetika je síce osovo-nezávislá (matematicky to nevadí), ale
  parity test tak nikdy neoverí .xx5 hranicu pre ostatné hodnoty tej osi. Pridaj PER-HODNOTA cap
  (`kotievPreOs = verifikaciaDph.filter(v => v.os === hodnota).length; ... && kotievPreOs < 1`) vedľa
  celkového stropu, aby kotvy pri regenerácii pokryli KAŽDÚ hodnotu novej osi.
- **Ohranič KAŽDÝ forgeovateľný cenotvorný násobiteľ v `systemKod`, nielen rozmery (#410 review 🟡).**
  Rozmery idú cez `zaokruhliNaMriezku` → null nad max, ale POČET je čistý násobiteľ — klient ho vie
  sfalšovať v POST `konfiguracia` (`sanitizePonukaConfig` cap 120 nekontroluje HODNOTU). Neohraničený
  `pocet` → `100000000` opečiatkuje absurdnú cenu do DB/PDF. `cenaOplotenieZCfg` AJ `vypocitajCenu*`
  MUSIA striktne validovať počet do rozmedzia → null / individuálna (NIKDY ticho klampovať na 1).
- **Metrový stepper píše na 100 mm mriežku, ale cenová mriežka je 0,5 m (šírka) → off-grid vstup je
  LEGITÍMNY (nie forged), zaokrúhľuje sa na najbližší bod (môže pod/nadhodnotiť).** Preto stránka aj
  PDF čestne doplnia „katalógový rozmer …" keď sa zaokrúhlená šírka líši (on-page `opl-cena-grid`
  note + `cenaRiadky` v `ponuka-pdf`). VÝŠKA je vždy on-grid (stepper krok 100 mm = mriežka 0,1 m).
- **DPH pri počte > 1 = VAT z CELKOVÉHO netto** (montalu: `sDphEur(net×pocet)`, nie sčítanie per-kus
  VAT — líšia sa o 1 cent). Parity kotva: posuvna/REA 1,6×4,0 × 3 ks → „11 222,32" (nie 11 222,31).
- **Runtime Money-safety (C) test PRE AKCIU `vypocet`, nielen `load()`** (parita s bazénom): anonym →
  MO prítomné + VO všetkých modelov ABSENT + žiadna `hladina`; b2b `locals.user` → VO + `"hladina":"VO"`.

## Vzťah k #279 a scope

Toto je INTERIM orientačná cena (zrkadlo montalu.sk), NIE finálny cenník od šéfa (#279 = marže/práca/
montáž, samostatné). Owner otázky #279/#356/#369/#372/#378/#398 sú PENDING (finálne cenotvorné pravidlá)
— sem NEZASAHUJÚ (interim). Per-typ rozmerové obálky na stránke = DONE (#427, HYBRID nie clamp): obálka
sa vystaví ako „cenníkový rozsah" + čestná mimo-hláška, generózne steppery ostávajú → `.claude/rules/konfigurator-obalky.md`.
