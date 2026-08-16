# Autopilot log

Terse per-ticket log of autopilot/autonomous-worker runs: issue #, commits, tests, decisions, PR.

## 2026-08-13 — 3D náhľad zasklení: vizuálna iterácia — sklo, kamera, kontrast, tieň (#174)

- **Issue:** #174 — iteračná fáza po #170: live screenshoty ukázali sklo ako
  mliečny plast, jednotku vznášajúcu sa nad dlažbou, kameru orezávajúcu vrch
  konštrukcie, a vymytú scénu bez kontrastu. Čisto vizuálny ticket,
  architektúra sa nemenila.
- **STEP 0 validácia** (issuecomment-5273187508 / -5273227524): repro
  lokálne na v0.16.4 vo OBOCH tieroch (`?viz=low` aj default mid-tier) —
  všetky 4 nálezy potvrdené aktuálne.
- **Design comment** (pred prvým commitom, issuecomment-5273194958 /
  -5273228772): root cause + prístup + zamietnutá alternatíva per nález —
  sklo: tint tónovo splýval so stenou + `attenuationDistance:6` dávala
  Beer-Lambert útlm ~0.13% (neviditeľný); tieň: slabá opacity + veľký posun
  v smere svetla; kamera: len 15% rezerva marže + príliš vysoké elevácie;
  scéna: nedostatočný farebný kontrast pri ACES tonemappingu.
- **Commits (dev):** `5e1c33e` verzia 0.16.5-dev.1 → `cd8d152` feat: sklo
  (sýty modrozelený attenuationColor + clearcoat), tieň (silnejšia
  opacity + menší posun/veľkosť), kamera (rezerva 1.15→1.35, elevácie
  16°/8°→7°/6°), scéna (sýtejšia stena, kontrastnejšia obloha/dlažba) →
  `5d8f132` self-review doc fix → `3214dfb` fix: adversariálny review
  nálezy (nesprávne ilustračné čísla v komentári — sRGB vs. lineárny
  farebný priestor, 3 tautologické test assertions sprísnené) →
  `bc2f158`/`16079f4` verzia 0.16.5→0.16.6 (viď nižšie, sort -V gotcha).
- **Testy:** 6 nových (`tests/vizual-materialy.test.ts` — tier-based sklo,
  SKUTOČNÁ Beer-Lambert formula priamo z `mat.attenuationColor[k]`) + 21
  nových (`vizual-kamera-kvalita.test.ts` — celý bbox v kamerovom frustume
  cez skutočnú 3D projekciu pri 4 veľkostiach × 2 presetoch, výška oka v
  pásme 1,5–1,9m). Existujúca sada 1141/1141 + e2e (vizual3d 10/10,
  zasklenia-zakaznicky 3/3, zasklenia-navrh 9/9) zelené, zero console errors.
- **Deep review** (fresh-context `general-purpose` subagent, ~500s,
  issuecomment-5273628838): 0🔴 2🟡 2🔵 — oba 🟡 opravené v tejto vetve
  (nesprávne ilustračné čísla, tautologické testy), 1🔵 filed ako **#177**
  (chýbajúce testy pre textury.ts/scena.ts, pre-existing), 1🔵 objasnené
  komentárom.
- **PR #178** (dev→main), zlúčené `a471c07`. **Gotcha nájdená post-deploy:**
  PR sa zlúčil s `-dev.1` verziou stále na dev (missed the "clean bump
  before merge" krok) — `/health` ukázal `"0.16.5-dev.1 (a471c07)"`.
  Follow-up **PR #179**: bump na čistú `0.16.5` PADOL na version-check —
  tento projekt's `sort -V` porovnanie ZÁMERNE radí `X-dev.N` VYŠŠIE než
  holé `X` (aby prvý post-merge `-dev.1` bump vždy porazil práve zlúčený
  main) — predpoklad, ktorý platí LEN keď sa čistý bump stane PRED
  merge, nie po ňom. Rovnaké patch číslo preto porovnáva main > dev.
  Oprava: bump na `0.16.6` (skutočný patch increment) obišiel gotchu,
  overené priamo proti `sort -V` pred pushom. Zlúčené `b2643e2`, nasadené,
  `/health` → `"0.16.6 (b2643e2)"`, čisté.
- **Post-deploy overenie:** Playwright naživo (`app.montalu.cloud`, marek
  účet), desktop 1440×900 aj phone 390×844, 4 presety (3/4, čelný,
  zvnútra, otvorené) — identické s lokálnou verifikáciou, verzia
  potvrdená z DOM footera.
- **Playbook:** `.claude/rules/vizual3d.md` — pridaná sekcia o tejto
  gotche (Beer-Lambert je PO KANÁLI mocnina farby, nie exponenciála
  vzdialenosti; `THREE.Color`'s `.r/.g/.b` sú LINEÁRNE, nie sRGB) a o
  version-bump-po-merge gotche (`sort -V` `X-dev.N` > `X` predpoklad).

## 2026-08-12 — Surový vstup odpisu do odpis_log.detail, krok 0 pre #155 (#156)

- **Issue:** #156 — appka zahadzovala surový submitnutý vstup odpisu po prepočte
  (len 2/39 reálnych pergol malo zachovaný CAD text); pre plánované budúce generovanie
  nárezu z rozmerov je každá ďalšia odoslaná zákazka bez toho stratený tréningový pár.
- **Design comment** (pred prvým commitom):
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/156#issuecomment-5266769720
- **Commits (dev):** `0234dad` verzia 0.14.34-dev.1 → `45360bd` feat: pergola `cad`+
  `komboVolby`, zasklenia (jednoposuv+multi) aj bazén `vstupRaw` do `detail` → `97ce423`
  verzia 0.14.34 → `b03d6fa` fix review nálezy (CAD_DETAIL_MAX=20000 cap +
  klin/kolajnica/sietka v round-trip testoch).
- **Review:** fresh-context subagent nad celým diffom `origin/main..dev` — 0 🔴 0 🟡
  **2 🔵 nálezy** (detail.cad bez stropu; round-trip testy nechávali nested objekty
  null), oba opravené v `b03d6fa`. Komentár:
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/156#issuecomment-5266939221
- **Testy:** `tests/odpis-detail-vstup-raw.test.ts` (6 nových — 1:1 zhoda
  detail.cad/komboVolby/vstupRaw s parseVstup/parseMultiVstup/parseBazenVstup, vrátane
  nested klin/kolajnica/sietka a CAD length-cap). `npm test` 950/950, `npm run lint`
  čisté, `npm run check` 0/0/0.
- **Gotcha zachytená v teste:** `FormData`/`Request` round-trip v tomto testovom
  prostredí normalizuje textové polia `\n` → `\r\n` presne ako reálny `<textarea>`
  multipart POST — fixture pre veľký CAD paste musela použiť `\r\n`, inak sa slice
  porovnanie rozišlo o 1 znak na riadok. `parseCad()` si `\r` pri parsovaní strihá sám,
  takže na samotný prepočet to nemá vplyv — len na testové fixture porovnanie.
- **PR #159** (dev→main), merge `42592d4`. Main CI (test+deploy) zelené.
- **Post-deploy overenie naživo:** `/health` `{"ok":true,"version":"0.14.34 (42592d4)"}`;
  Playwright DOM read na `/zasklenia` potvrdil `v0.14.34` viditeľné na stránke; `/odpisy`
  história načítaná bez console errorov. Money-critical app — živý zápis do Money
  (MONEY_LIVE=1) sa neskúšal zámerne (dispatch inštrukcia); write-cesta je overená
  CI e2e v MONEY_LIVE=0 režime.
- Discord run-card odoslaná pre #156 (`notify --run-card`).
- Playbook: `.claude/rules/odpis-detail.md` — nové pravidlo (bound VŠETKO čo ide do
  `odpis_log.detail`, FormData round-trip `\r\n` gotcha pre viacriadkové textové polia
  v testoch — pozri playbook-review nižšie).

## 2026-07-31 — Sieťky, display-only polovica (#86 #87 #88 #89 #90)

- **Issues:** #86 (checkbox „so sieťkou" — Robust), #87 (2K→3K upozornenie), #88 (úchyt
  namiesto kľučky), #89 (samostatná stránka `/sietka` — dodatočná sieťka bez posuvu),
  #90 (Slide — základ). Všetkých 5 ostáva OPEN (`needs-answer`) — Money polovica čaká na
  Patrikove čísla/kódy.
- **Design comment:** issue #86 comment (posted before first code commit) —
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/86#issuecomment-5147463199
- **Commits (dev):** `b089f89` verzia 0.11.0-dev.1 → `f09c130` sieťka na posuve (checkbox,
  úchyt, 2K upozornenie, náhľad, plán) → `efcd6ed` samostatná stránka `/sietka` →
  `2b9c455` verzia 0.11.0
- **Tests:** `tests/vstup-sietka.test.ts` (24, vrátane MONEY-NEUTRALITA cez `computeMulti`
  odpis+material rovnosť so/bez sieťky), `tests/sietka-samostatna.test.ts` (8),
  `e2e/sietka.spec.ts` (8 Playwright — checkbox gate, úchyt namiesto kľučky, 2K
  upozornenie, round-trip „Späť a upraviť", multi-posuv, /sietka compute, b2b prístup).
  Existujúca sada 601→633 unit + 99→107 e2e, 0 regresií.
- **Money-safety:** `Sietka`/`uchyt` idú len cez `PosuvSpec.sietka`/`PosuvInfo.sietka`
  (echo pre náhľad, presne ako `klin`), nikdy do `computeFlat`/`profilCuts`/
  `kovanieDoOdpisu`.
- **PR:** #104 (dev→main, merge `85de174`), main CI zelené vrátane deploy jobu.
- **Nasadené a naživo overené:** `v0.11.0 (85de174)` na `app.montalu.cloud`, checkbox
  „so sieťkou" aj `/sietka` stránka overené v Playwright naživo, 0 console errors.

## #90 (Slide sieťka — Money-neutralita guard) — 2026-07-31/08-01

- **Kontext:** #90 (Slide sieťka, Money-kritická časť BLOKOVANÁ do potvrdenia parametrov
  Patrikom) zostáva OTVORENÉ. Toto je len test-hardening: MONEY-NEUTRALITA test v
  `tests/vstup-sietka.test.ts` (PR #104) overoval ekvivalenciu odpisu/materiálu so/bez
  sieťky len pre Robust; Slide bol krytý len argumentom, že `computeMulti` prepúšťa
  `sietka` bez systémového vetvenia (bez testu).
- **Design komentár (pred prvým commitom):**
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/90#issuecomment-5147832676
- **Commits (dev):** `2c4ed93` verzia 0.11.2-dev.1 → `650054b` test(sietka):
  parametrizovať MONEY-NEUTRALITA guard aj pre Slide (`it.each` naprieč
  `SIETKA_SYSTEMY`) → `eb43f2f` verzia 0.11.2.
- **Sabotážou overené:** dočasná lokálna úprava `compute.ts` (fiktívny riadok do
  odpisu pri Slide+sieťke) → oba nové Slide testy RED, Robust ostal GREEN → sabotáž
  vrátená (nie je v diffe).
- **Tests:** `tests/vstup-sietka.test.ts` 24→26 (Robust aj Slide vektor v oboch
  MONEY-NEUTRALITA testoch). Celá sada 635 unit + 107 e2e, 0 regresií.
- **PR:** #106 (dev→main, merge `d9c4960`), main CI zelené vrátane deploy jobu.
- **Nasadené a naživo overené:** `v0.11.2 (d9c4960)` na `app.montalu.cloud`.
- **#90 zostáva OTVORENÉ** — Slide Money odpis (redukcia pre sieťku) stále čaká na
  potvrdené kódy/dĺžku od Patrika.
- **Discord karta:** `notify --run-card` vrátil `dedup` (repo#90 už má kartu z
  predošlej dávky #86–#90 / PR #104) — legitímny dedup, nie chyba.

## 2026-08-02 — Sieťky, Money korekcia: ďalšie krídlo posuvu (#86 #87 #88 #89, časť #90)

- **Issues:** #86, #87, #89 CLOSED (rám+nos+koľajnica delta implementovaná,
  presne podľa Patrikovej opravy modelu); #88 CLOSED (úchyt zostáva display-only,
  Patrikova explicitná odpoveď); #90 OSTÁVA OPEN (Slide sieťkový profil,
  Patrik sám žiada overenie kódu/dĺžky).
- **Zdroj zadania:** Odoo kanál 207 (Vyroba automatizacia), správy
  #1614821/#1614823/#1614827 (2026-08-02) — korekcia pôvodného modelu
  (sieťka = ďalšie krídlo posuvu, nie samostatný objekt s ručným rozmerom).
  Mesh-dimension vzorec (+2mm šírka/+1mm výška) potvrdený Patrikovým fotom
  vlastného nárezáka (msg #1614828, stiahnuté read-only cez JSON-RPC
  `mail.message.attachment_ids`→`ir.attachment.read`).
- **Design komentár (pred prvým commitom):**
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/86#issuecomment-5158777808
- **Commits (dev):** `878b834` verzia 0.12.0-dev.1 → `458fa8a` test [red] presná
  delta → `84ecb7d` implementácia [green] (`sietkaExtraPocetKs`/
  `jeSietkaMoneyRelevant`/`sietkaKolajnicaSwap`/`sietkaSamostatnaVypocet`) →
  `1bf6121` fix: wire sietka do single-posuv `compute()` (E2E odhalil) →
  `107c06e` verzia 0.12.0 + playbook §5b → `7300ca7` fix: opona gate na
  `/sietka` (self-review nález) → `b785e78` test: forged-POST b2b pokrytie
  pre `/sietka odoslat` → `5a39d91` fix: unikátne SVG pattern id →
  `2de1a96` fix: nezávislý reviewer nálezy (duplicitné odoslanie = prázdna
  stránka, zastaraný komentár, tautologický test).
- **RED→GREEN dokázané:** `git stash` baseline pred implementáciou → testy
  padli presne na Money delte (18 testov RED) → implementácia → GREEN.
- **Review:** self-review (2× 🟡 fixed pred dispatchom) + nezávislý
  `general-purpose` reviewer subagent (diff `c5a58ce..5a39d91`, žiadny session
  kontext) — 3× 🟡 (opravené, RED→GREEN pre duplicate-submit bug) + 1× 🔵
  (architektonický dlh, vyfiltrovaný ako #109).
- **Tests:** `npx vitest run` 642/642, `npm run check` 0 chýb, `npm run lint`
  čisté, `npx playwright test` (celá lokálna sada) 108/108, 0 regresií.
- **PR:** #108 (dev→main, merge `fe3dec5`), main CI zelené vrátane deploy jobu.
- **Nasadené a naživo overené:** `v0.12.0 (fe3dec5)` na `app.montalu.cloud` —
  Robust 3K + sieťka: odpis Rámový profil 30→37,5 m (presne ako testovaný
  vektor), náhľad kreslí „3 polí + sieťka"; `/sietka` Robust 2K: rám 2ks+2ks,
  nos 1ks, koľajnica 3K 2ks+2ks (15 m), rozmer sieťoviny 1131×1726 mm, opona
  štýly správne CHÝBAJÚ v ponuke. Nikdy nekliknuté „Odoslať odpis do Money"
  naživo (MONEY_LIVE=1) — len Spočítať/výsledok, per Money-safe pravidlo.
- **Follow-up:** #109 (zjednotiť PosuvSpec builder, `needs-user-decision`).
- **Discord karty:** #86/#87/#88/#89 vrátili `dedup` (exit 0) — kartu už
  dostali pri predošlej dávke #86–#90/PR #104; táto Money korekcia je
  pokračovanie tej istej ticket-karty, nie nová.

## #110 + #90 — Sieťka: Štandard/Štandard+ výber systému + Slide redukcia (2026-08-03)

- **Zdroj:** Patrik, Odoo kanál 207, msg #1614895 (#90 kód) + #1616278–#1616285
  (#110) + dva jeho nárezáky (fotky, stiahnuté read-only cez Odoo JSON-RPC).
- **Design komentáre:** posted BEFORE code na oboch issues (#110, #90) —
  root cause (regex-na-predponu koliduje na Štandarde), zvolený prístup
  (dátová rolová tabuľka + `mergeExtraCuts` na cross-systémovú deltu),
  zamietnutá alternatíva (rozšíriť existujúci regex).
- **Commits:** `5cacfd5` verzia bump, `567e115` implementácia (#110+#90),
  `ad98000` verzia release + playbook, `25cc9d1` self-review fix (oversize
  guard pre cross-systémovú deltu, chýbajúci pred fixom — Money-kritická
  medzera, ktorú `oversizeCut` sám nevidel).
- **RED→GREEN + sabotáž dôkaz:** implementácia + testy v jednej dávke
  (feature, nie bug — flexibilné poradie per `tdd-workflow.md`), OBA delta
  mechanizmy sabotáž-overené (dočasne rozbité priamo v kóde → testy padli na
  presné Money čísla → obnovené).
- **Nové testy:** `tests/sietka-standard.test.ts` (19), `tests/sietka-slide-
  redukcia.test.ts` (6), round-trip pridané do `tests/vstup-multi-
  roundtrip.test.ts` (4), 3 existujúce testy vo `tests/vstup-sietka.test.ts`
  aktualizované so stated justification (Štandard+/Slide teraz podporujú
  sieťku inak ako predtým). `e2e/sietka-standard.spec.ts` (5, Playwright).
- **Review:** self-review 2 kolá — 1. nález (oversize guard chýbajúci pre
  ±16,5mm cross-systémovú deltu) opravený + nový hraničný test (S=7308,
  Štandard +|2K); 2 drobné nálezy (zjednodušená podmienka, UI text) opravené.
- **Tests:** `npx vitest run` 674/674, `npm run check` 0 chýb, `npm run lint`
  čisté, relevantné e2e (sietka, sietka-standard, klin, kolajnica-rucna,
  standard-narezak, standard-stary, znova) 36/36 lokálne, 0 regresií.
- **PR:** #111 (dev→main, merge `02398a77`), main CI zelené vrátane deploy jobu.
- **Nasadené a naživo overené:** `v0.13.0 (02398a7)` na `app.montalu.cloud` —
  Štandard + 3K + sieťka „Štandard" (cross-systém, tá presná otvorená otázka
  z issue): odpis obsahuje `ZASP00018`/`ZASP00021` (starý koncový/doraz),
  rozmer sieťoviny 960×1738 mm, náhľad kreslí 4. krídlo, 0 chýb konzoly.
- **Otvorené (Patrikovi treba potvrdiť pred reálnou objednávkou):** smer
  „plus sieťka na starom posuve" (−16,5mm, symetrický, nepotvrdený); presný
  počet kusov/dĺžka Slide sieťkovej redukcie (odvodené, nie doslovné číslo).
- **Discord karty:** #110 `sent`, #90 `dedup` (exit 0, kartu už dostal pri
  predošlej dávke #86–#90/PR #104).

## #85 — FIX: rozpočítanie polí podľa posuvu (Robust/Slide/Štandard) (2026-08-03)

- **Zdroj:** Patrik, Odoo kanál 207, msg #1614896 + výkres msg #1614897 (odpoveď
  na blokujúcu časť #85 — "variant 2, podľa posuvu"). Read-only stiahnutý cez
  Odoo JSON-RPC, pixel-grid analýza ukázala že výkres NIE JE v mierke (rovnaké
  pixelové rozostupy pre 3 rôzne systémy) — číselné kóty sú ground truth, nie
  pixely.
- **Design komentár:** posted BEFORE code na #85 — root cause (appka vie len
  rovnomerne), zvolený prístup (hranica poľa = STRED priečky, `KRAJNY`
  konštanta per systém, `PRIECKA` len informatívna), zamietnutá alternatíva
  (odpočítanie priečky ako mŕtvej šírky — porušilo by invariant súčtu polí=S).
- **Commits:** `0a5e2bd` verzia bump, `7a45340` implementácia
  (`rozpocitajPodlaPosuvu` + UI + round-trip + FIX_MIN 100→59), `429deda`
  deep-review fix (client-side hláška pre príliš úzku šírku), release bump.
- **RED→GREEN + sabotáž dôkaz:** implementácia + testy v jednej dávke
  (feature). `rozpocitajPodlaPosuvu` sabotáž-overené (dočasne rozbité →
  6 testov RED → opravené → GREEN).
- **Nové testy:** `tests/fix-podla-posuvu.test.ts` (15 — KRAJNY/PRIECKA,
  reprodukcia výkresu pre 3 systémy, n=1..8 invariant), round-trip pridaný do
  `tests/fix-vstup.test.ts` (3), `tests/fix-money-safety.test.ts` (2 — byte-
  identický zasklenia odpis canary + statická kontrola žiadneho importu z
  compute.ts). `e2e/fix-podla-posuvu.spec.ts` (4, Playwright).
- **Review:** `/review` (0 🔴 0 🟡 0 🔵 blokujúcich) + `superpowers:requesting-
  code-review` deep pass — 1 Important nález (príliš úzka šírka pre zvolený
  systém nemala konkrétnu hlášku), opravený v `429deda` + nový e2e test.
- **Tests:** `npx vitest run --coverage` 700/700, `npm run check` 0 chýb,
  `npm run lint` čisté, `npx playwright test` 120/120 lokálne (fix-podla-
  posuvu + celá existujúca sada), 0 regresií, 0 chýb konzoly.
- **PR:** #112 (dev→main).
- **Otvorené (Patrikovi treba potvrdiť, needs-answer na #85):** n=2 (jediná
  priečka) berie krajný odskok len od ľavého kraja; n≥4 rozkladá ďalšie
  priečky rovnomerne medzi krajné — výkres pokrýva len n=3, zvyšok je
  najpravdepodobnejšie čítanie, nie potvrdené.

## #85 follow-up — n=2 oprava, n≥4 potvrdené (2026-08-03)

- **Zdroj:** Patrik, Odoo kanál 207, msg #1618564 — odpoveď na oba otvorené
  predpoklady z PR #112.
- **n=2 bolo ZLE:** "Ak sú dve polia sklo ide priamo na stred je jedno čí tam
  posuv je nie je" — presné 50/50, systém sa ignoruje. Predpoklad z PR #112
  (`[KRAJNY, S-KRAJNY]` od ľavého kraja) bol nesprávny.
- **n≥4 OVERENÉ, kód sa nemenil:** "by som to delil rovnako ako pri 3 oknách
  ... 21 a 21 obsadenie, priečku beriem na stred" — matematicky zhodné so
  súčasnou implementáciou (numericky dokázané: Štandard S=3000 n=6 →
  `[59, 720.5, 720.5, 720.5, 720.5, 59]`).
- **Design komentár:** posted BEFORE code na #85 — root cause (n=2 vetva
  bola nepotvrdený predpoklad), zvolený prístup (presný stred, ignoruj
  systém), zamietnutá alternatíva (ponechať asymetrický rez).
- **Commits:** `722673c` verzia bump, `83bd370` RED test (n=2 dôkaz zlého
  predpokladu + nový n=6 numerický test), `44e7a8d` GREEN fix + UI hlášky +
  e2e testy + playbook (`.claude/rules/fix-module.md`).
- **Testy:** `tests/fix-podla-posuvu.test.ts` (opravený n=2 test, pridaný
  n=6), `e2e/fix-podla-posuvu.spec.ts` (upravený existujúci n=3 test, 2 nové
  — n=2 happy path 50/50 + n=2 hláška bez system/KRAJNY zmienky). Plná sada:
  `npx vitest run` 695/695, `npm run check` 0 chýb, `npm run lint` čisté,
  `npx playwright test` 119/119 lokálne, 0 regresií, 0 chýb konzoly.
- **PR:** #113 (dev→main), closes #85.

## #114 — dátum vytvorenia v tlačenej hlavičke nárezáku (2026-08-05)

- **Zdroj:** Patrik, pripomienka z výroby — dielňa nevedela zoradiť vytlačené
  plány podľa dátumu vzniku.
- **Design komentár:** posted BEFORE code na #114 — root cause (žiadne
  časové pole v action-výsledku), zvolený prístup (server-side
  `Date.now()` per action, explicitná `Europe/Bratislava` zóna cez Intl —
  Docker image nemá TZ nastavené, bez toho by appka ukazovala UTC), zamietnutá
  alternatíva (čítať `odpis_log.created_at` — nekonzistentné medzi
  nahlad/odoslat).
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/114#issuecomment-5193748749
- **Commits:** `f21f74d` verzia 0.14.2-dev.1 → `b09b9d5` RED test
  (`formatDatumCasSk`) → `2e656f4` GREEN implementácia (server `vytvorene`
  vo všetkých 4 akciách + `$lib/datum.ts` + 4 miesta v hlavičke) →
  `d9cc8fb` opravy z `/requesting-code-review` (e2e test na „iný dátum"
  nikdy neoveroval nerovnosť → prepísaný na silnejšiu non-flaky kontrolu
  „zodpovedá aktuálnemu serverovému času"; unit „nie je locale-dependent"
  nikdy nemenil TZ → nahradený testom čerstvého node procesu s `TZ=UTC`;
  pridaný test na jednociferné hodiny; zjednotené `form?.vytvorene`).
- **Testy:** `tests/datum.test.ts` (7, vrátane sabotage-verified TZ ochrany),
  `e2e/datum-vytvorenia.spec.ts` (3, sabotage-verified proti zamrznutej
  hodnote). Plná sada: `npx vitest run` 702/702, `npm run check` 0 chýb,
  `npm run lint` čisté, `npx playwright test` 122/122 lokálne, 0 regresií,
  0 chýb konzoly.
- **Money:** nulový dopad — `vytvorene` nikdy nejde do `job.polozky`/xlsx;
  canary testy (`money.test.ts`, `fix-money-safety.test.ts`,
  `b2b-money-reject.test.ts`) prešli bez zmeny.
- **PR:** #115 (dev→main), merge `7b1c720`, closes #114 (auto-closed
  mergom). Post-deploy overené naživo (marek@app.montalu.cloud): DOM
  verzia `v0.14.2 (7b1c720)`, testovací nárezák ukázal `🕓 5.8.2026 17:57`
  v hlavičke, 0 chýb konzoly, Money odpis sa NEODOSLAL.

## 2026-08-07 — CI zombie run + workflow_dispatch (#118)

- **Issue:** #118 (CI: deploy sa nedá zopakovať, keď na main neprejde — chýba
  `workflow_dispatch`). Root cause: `ci.yml` mal jediný spúšťač `push`; keď
  GitHub nepridelil runner deploy jobu na `main` po merge PR #117 (0.14.4),
  run zamrzol (`status: queued`, `conclusion: null`, joby `completed`) a
  `gh run cancel`/`gh run rerun` obe zlyhali — bez umelého commitu neexistoval
  spôsob, ako CI zopakovať. Live appka zostala na 0.14.3.
- **PR #119** (dev→main, `7735eac`→merge `7d2f6d7`): `workflow_dispatch:`
  pridaný do `on:` bloku `ci.yml` (1 riadok), verzia 0.14.4→0.14.5. Gate
  podmienky nezmenené. `/review` + `/requesting-code-review` obe 0🔴0🟡0🔵.
  Nasledujúci `main` beh prebehol prirodzene zelený (žiadny zombie tentokrát),
  appka naživo `0.14.5 (7d2f6d7)`.
- **PR #120** (playbook, docs-only, spustený PO merge #119 — chyba v poradí
  krokov, napravená rovnakým vzorom ako `2708dc2`): `.claude/rules/ci.md`
  (nový, `paths: .github/workflows/*.yml`) — zombie-run rozpoznanie,
  `workflow_dispatch` retry postup, pripomienka že CI zelené ≠ nasadené.
  Verzia 0.14.6, merge `551c6d7`, appka naživo `0.14.6 (551c6d7)`.
- **Post-deploy overenie:** Playwright na `https://app.montalu.cloud/zasklenia`
  — testovací nárezák (Robust 2K, 1500×2000mm) spočítaný, plán + kovanie +
  tesnenia + rozpis rezov vykreslené, DOM verzia `v0.14.6 (551c6d7)`, 0 chýb
  konzoly. Money odpis NEODOSLANÝ.
- **Issue #118** auto-closed mergom PR #119 (`Closes #118` v tele). Evidencia
  doplnená komentárom po merge #120.

## 2026-08-07 — #91 dokončené: adversariálna revízia nálezy 1/3/5 (PR #122)

- **Issue:** #91 (Sieťky Štandard 2K: 3K koľajnica sa reálne nezamieňa, hoci UI to
  tvrdí). Adversariálna revízia už-otvoreného PR #122 potvrdila mechanizmus, ale
  našla 3 zostávajúce nálezy (1 HIGH, 3 MEDIUM, 5 LOW) + 1 mimo scope (2, → #123).
- **Nález 1 (HIGH):** `sietkaKolajnicaSwap`/`potrebuje3KKolajnicu` gejtovali
  `styl === '2K'` — na Štandarde/Štandard + o IZO/basic rozhoduje ZVOLENÉ SKLO
  (`sysStylPre`), takže výpočet dostal `styl='2K IZO'` a swap sa vzdal. Fix: gate
  na `zakladnyStyl(styl)==='2K'` + náprotivok `styl.replace(/^2K/,'3K')`.
  RED `ac490ac` → GREEN `d1aae92`.
- **Nález 3 (MEDIUM):** `sietka-3k-warn-sync.test.ts` predtým nikdy nevolal
  `sietkaKolajnicaSwap` — nahradené reálnym invariantom riadeným živým
  `cfg_seed.json` (`91bdbb7`), sabotage-verified obojsmerne.
- **Nález 5 (LOW):** nový fail-loud guard `sietkaKolajnicaVzorecChyba` (Money
  formula mismatch medzi 2K a 3K riadkom), zapojený do `sietkaChyba`
  (`d1aae92` + testy `e329012`).
- **Nález 2:** vecné rozhodnutie, presunuté do #123 (OTVORENÝ, čaká na výrobu),
  pinning test overil, že fix nálezu 1 túto kombináciu nemení (`84d1579`).
- **e2e:** nový Playwright test cez reálny formulár s IZO sklom (`5ca7689`),
  sabotage-verified.
- **PR #122** (dev→main, verzia 0.14.8→0.14.9), merge `37b6765`. CI + deploy
  main zelené. Deep-review pass (`requesting-code-review`) 0 Critical/Important,
  2 Minor (1 kozmetický, 1 filed ako #124 — chýbajúca 3K skupina, mimo scope).
- **Post-deploy overenie naživo:** `/health` `0.14.9 (37b6765)`; reálny formulár
  (Štandard plus | 2K | Izolačné sklo 4.8.4 | S=3000 V=1850 | sieťka ON) —
  nárezák-hint aj hláška sedia, **Odpis (do Money) skutočne obsahuje
  ZASP00027/ZASP00030 (3K)**, žiadny 2K kód. 0 chýb konzoly. Money odpis
  NEODOSLANÝ (len Spočítať + Späť).
- Issue #91 auto-closed mergom, evidencia doplnená komentárom. Filed #124
  (follow-up, chýbajúca 3K skupina — mimo scope tohto PR).

## #124 — sietkaKolajnicaVzorecChyba fail-loud pre chýbajúcu 3K skupinu/riadok (2026-08-07)

- Deep-review follow-up po #91/PR #122: `sietkaKolajnicaVzorecChyba` mala
  `if (!g2k || !g3k) return null;` — chýbajúca CELÁ `3K(-variant)` skupina
  bola ticho `null`, `sietkaKolajnicaSwap` ticho ponechal 2K kód (rovnaká
  trieda chyby ako #91, iná príčina). Nedosiahnuteľné cez dnešný formulár
  (obrana proti budúcej dátovej zmene).
- STEP 0 evidencia (komentár na #124): mutovaný `cfg` bez `Robust|3K` →
  potvrdené ticho zlé správanie DNES.
- Design komentár PRED kódom: rozhodnutie, že aj pôvodné `if (!r3) continue;`
  (riadok existuje v skupine, ale rola+dim sa nenájde) MUSÍ byť tiež chyba,
  nie skip — `sietkaKolajnicaSwap` páruje LEN podľa `rola` (bez `dim`), takže
  by mohol ticho použiť riadok s iným (možno nekompatibilným) vzorcom.
- `[red]` test `a2f5054` (`tests/sietka-kolajnica-chybajuca-3k.test.ts`, 6
  testov: chýbajúca skupina × 2 systémy + safeCompute + sabotage-verify
  dnešného správania, chýbajúci riadok × 2 systémy) → `[green]` fix `de777b4`.
- Rozšírený invariant `643f76a` (`tests/sietka-3k-warn-sync.test.ts`) —
  mechanizmová kontrola naprieč KAŽDOU `SIETKA_SYSTEMY` skupinou s hláškou
  (nie len ručne vybrané prípady).
- Sabotage-verify: revert `[green]` → 5/6 nových testov padá presne ako pred
  opravou.
- Na živom `cfg_seed.json` je to no-op — plný test suite 756/756, golden
  snapshot (`zasklenia-posuvspec-golden`) nedotknutý.
- **PR #127** (dev→main, verzia 0.14.11→0.14.12), merge `e65116c`. CI +
  deploy main zelené. Issue #124 auto-closed mergom, evidencia doplnená
  komentárom.
- **Playbook update** (sekcia 5e money-odpis skill — guard-vs-akcia
  asymetrické párovanie) ako samostatný docs **PR #128**, verzia
  0.14.12→0.14.13, merge `21ecc18`.
- **Post-deploy overenie naživo:** `/health` `0.14.13 (21ecc18)`; reálny
  formulár (Štandard plus | 2K | Float 4mm | S=3000 V=1850 | sieťka ON) —
  **Odpis (do Money) obsahuje ZASP00027/ZASP00030 (3K)** rovnako ako pred
  touto opravou (fix nemenil fungujúcu cestu). 0 chýb konzoly. Money odpis
  NEODOSLANÝ (len Spočítať + Späť).

## 2026-08-09 — Prídavná koľajnica × sieťka na 2K: UI hláška namiesto klamúceho sľubu (#123)

- **Issue:** #123 — checkbox „Prídavná koľajnica" (Štandard +, `railUpsize`) pri
  súčasne zapnutej sieťke na 2K (`sietkaKolajnicaSwap`, obe pridané
  nezávisle) sľuboval zmenu, ktorú sieťkina 3K sada už obsahuje.
- STEP 0 evidencia (komentár na #123): živý `computeFlat` pre všetky 4
  kombinácie prídavná×sieťka na `Štandard +|2K` aj `Štandard +|2K IZO` —
  presne Patrikova tabuľka, Money odpis od začiatku správny.
- **ROZHODNUTIE** (Patrik, Odoo kanál 207, msg 1646652, 2026-08-09): prídavná
  = len spodná, sieťka na 2K si vyžiada aj vrchnú — pri obidvoch naraz sa
  nesčítavajú (žiadne 4K), sieťka sama vynúti celú 3K sadu, ktorá spodnú
  (jediné, čo prídavná pridáva) už obsahuje.
- Design komentár PRED kódom (#123): jeden zdroj pravdy v `sietka.ts`
  (`pridavnaJeVSietke`/`pridavnaKolajnicaHint`), checkbox sa NEschováva/
  nedisabluje — len text vedľa sieťky hovorí pravdu.
- `dc667a6` (test): pôvodný PINNING test v `tests/compute.test.ts`
  („čaká na rozhodnutie") prepísaný na potvrdený, rozšírený na všetky 4
  riadky × horná/spodná × basic/IZO + guard že 3K+ sieťka nemení
  (sabotage-verified — dočasné rozšírenie gate → guard test spadol, po
  revertnutí zelený). Nové unit testy `tests/pridavna-v-sietke.test.ts`.
- `e7fb566` (feat): `SietkaPolia.svelte` (`pridavna` prop) + preview/tlačové
  karty v `+page.svelte` (jeden aj viac-posuvový plán) dostanú hlášku z
  jedného zdroja pravdy. Nový e2e `e2e/pridavna-v-sietke.spec.ts` (4 testy:
  primárny posuv ON/OFF, mimo 2K gate, extra posuv v zimnej záhrade).
- `cb96abd` (refactor, self-review nález): `pridavnaKolajnicaHint` sa volalo
  dvakrát na miesto — opravené na `{@const}` (rovnaký vzor ako existujúci
  `{@const rozmer = ...}`), na všetkých troch miestach.
- Nezávislý deep-review subagent (diff `6b787dc..cb96abd`): potvrdil, že
  `compute.ts` aj golden snapshot majú PRÁZDNY diff, `pridavnaJeVSietke`
  presne zrkadlí prienik oboch reálnych gate podmienok, IZO/opona/3K+/
  samostatná stránka `/sietka` správne pokryté. 0 Critical, 0 Important,
  1 Minor (poznámka bez akcie). Ready to merge.
- Plný test suite 767/767, `npm run check`/`npm run lint` čisté, golden
  snapshot nedotknutý.
- **PR #130** (dev→main, verzia 0.14.14→0.14.15), merge `c8bbfab`. CI + main
  deploy zelené.
- **Post-deploy overenie naživo (Playwright MCP, live session ako `marek`):**
  footer `v0.14.15 (c8bbfab)`; reálny formulár (Štandard plus | 2K | Float
  4mm | S=3000 V=1850 | sieťka ON) — hláška pri sieťke správne mení znenie
  podľa stavu checkboxu prídavnej (nezaškrtnutá → „Netreba ju kvôli tomu
  zapínať."; zaškrtnutá → „Nechaj ju zaškrtnutú…"), **Odpis (do Money)
  obsahuje presne ZASP00027/ZASP00030 (3K), žiadne 2K ani 4K kódy**. 0 chýb
  konzoly. Money odpis NEODOSLANÝ (len Spočítať + Späť).
- Playbook: `.claude/skills/money-odpis/SKILL.md` §5f (dve nezávisle
  navrhnuté funkcie meniace ten istý fyzický kus — over prienik živým
  výpočtom, oprav len UI keď je Money už správny, checkbox sa nikdy
  nedisabluje kvôli prekrytiu, `{@const}` namiesto dvojitého volania).

## #132 — Prídavná koľajnica pri Štandard + IZO: predvyplnenie (2026-08-09)

- Rozhodnutie: Patrik (Odoo 207, msg #1646652) — „my vždy dávame pri
  štandardoch IZO spodnú koľaj navyše ale iba spodnú" → checkbox „Prídavná
  koľajnica" (Štandard +, mimo 6K) sa predvypĺňa zaškrtnutý, keď je zvolené
  izolačné sklo; obsluha ho môže odškrtnúť.
- Verzia 0.14.16 → 0.14.17 (`e49fad2`).
- RED→GREEN: `tests/pridavna-kolajnica-default.test.ts` (`7105d5a` → `647d6d2`)
  — nová čistá funkcia `pridavnaKolajnicaDefault` v `src/lib/styl.ts`.
- `src/routes/zasklenia/+page.svelte` (`0326120`) — HRANOVO spúšťaný `$effect`:
  checkbox sa prepíše len keď sa odporúčaná hodnota SKUTOČNE zmení (glass IZO
  stav zapnutý/vypnutý), takže ručný klik obsluhy prežije akúkoľvek
  nesúvisiacu zmenu poľa; „Použiť znova" sa nikdy neprepíše (tracker sa
  zasieva priamo z obnovených dát v reštart-efekte).
- e2e (`7972e90`, `aca8d5b`) — 9 nových testov: default ON/OFF, ručné
  odškrtnutie prežije nesúvisiacu zmenu, prepnutie skla PREČ z IZO odškrtne,
  6K nemá checkbox, zmiešaný multi-posuv prípad (order-level default z
  primárneho posuvu upsizne AJ extra posuv s NE-IZO sklom), „Použiť znova"
  sa neprepíše. `e2e/app.spec.ts` aktualizovaný na nový default (mechanizmus
  `railUpsize` nezmenený).
- Deep-review (dispatchovaný Senior Code Reviewer): 0 Critical, 2 Important
  (chýbajúci systém-round-trip test → doplnený `404f988`; trojnásobne
  duplikovaný gate „Štandard + mimo 6K" → filed **#134**, `cross-cutting`,
  zámerne mimo tejto PR), 2 Minor (STANDARD_PLUS import, JSDoc krížový
  odkaz → obidva opravené `404f988`).
- Golden snapshot (`zasklenia-posuvspec-golden.test.ts.snap`) — nezmenený
  (čisto klientská UI logika).
- **PR #133** (dev→main), merge `6d9b199`. Main CI (test+deploy) zelené.
- **Post-deploy overenie naživo** (Playwright MCP, `marek` účet):
  footer `v0.14.17 (6d9b199)`; Štandard plus | 2K | Izolačné sklo 4.8.4 →
  checkbox automaticky zaškrtnutý; „Spočítať" (READ-ONLY) ukázal
  `ZASP00030` (spodná 3K) namiesto `ZASP00104` — presne zámerná zmena
  Money odpisu. 0 chýb konzoly. Odoslat sa nepoužilo (len Spočítať+Späť).
- #132 auto-zavretý mergom PR #133 (`Closes #132`); evidenčný komentár
  pridaný samostatne.

## #134 — Zjednotenie trojnásobne duplikovaného „Štandard + mimo 6K" gate (2026-08-09)

- Nález z hĺbkového review PR #133/#132 (filed ako #134, `cross-cutting`,
  zámerne mimo tej PR — `compute.ts` je Money-kritický, refaktor „popri tom"
  by riskoval regresiu).
- Design comment (pred prvým code commitom):
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/134#issuecomment-5230938752
- Root cause: `railUpsize`'s gate kontroloval len `system`, bez `styl` — bolo
  to náhodne bezpečné len preto, že `RAIL_UPSIZE` (compute.ts) nemá záznam
  pre 6K kód `ZASP202437` („6K nemá +1"), takže lookup pre 6K vždy padol na
  no-op nezávisle od gate.
- Verzia 0.14.18 → 0.14.19 (`906cb18`).
- `standardPlusRailEligible(system, styl)` vyextrahovaný do `src/lib/styl.ts`
  (`8c451da`) — používajú ho `railUpsize` (compute.ts, dostal nový `styl`
  parameter), checkbox visibility (+page.svelte), `pridavnaKolajnicaDefault`.
  Nový test `tests/standard-plus-rail-eligible.test.ts` — truth-table 5
  systémov × 7 štýlov + zhoda railUpsize/pridavnaKolajnicaDefault pre rovnaké
  vstupy, vrátane priameho dôkazu že `RAIL_UPSIZE['ZASP202437']` je
  `undefined`.
- Golden snapshot (`tests/__snapshots__/`) — `git diff --stat origin/main`
  prázdny, byte-identický (overené pred aj po merge).
- Review: vlastný pass + dispatchovaný `/requesting-code-review` subagent —
  0 Critical, 0 Important, 0 Minor. Komentár:
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/134#issuecomment-5230986688
- Lokálne: `npx vitest run` 778/778, `npm run lint` čisté, `npm run check`
  0/0/0, `npm run build` OK, `npx playwright test` 137/137 (celá e2e sada).
- **PR #135** (dev→main), merge `601062d`. Main CI (test+deploy) zelené.
- **Post-deploy overenie naživo** (Playwright MCP, `marek` účet): `/health`
  → `{"ok":true,"version":"0.14.19 (601062d)","live":true}`; footer
  `v0.14.19 (601062d)`. Štandard plus | 2K | Float sklo → checkbox viditeľný,
  odškrtnutý; prepnutie na Izolačné sklo 4.8.4 → checkbox sa automaticky
  zaškrtol; prepnutie štýlu na 6K → checkbox zmizol. 0 chýb konzoly.
  Odoslať sa nepoužilo (len Systém/Štýl/Sklo prepínanie).
- #134 zavretý mergom PR #135 (`Closes #134`).

## #137 — Základ návrhových výkresov: kóta helper, výkresový hárok, A4 landscape (2026-08-10)

- Základový ticket série NÁVRH (na ňom stoja #138+ pergola/bazén). ROZHODNUTÉ
  komentár (user 2026-08-10) rozšíril zadanie o celý výkresový hárok (rám +
  mriežka 1-16/A-L), nielen pečiatku.
- Design comment (pred prvým code commitom):
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/137#issuecomment-5236457517
- Verzia 0.14.20 → 0.14.21 (`318afe5`).
- `src/lib/vykres/kota.ts` — vyextrahovaný z FixVykres2D/Nahlad2D (existujúce
  3 kresliace komponenty NEZMENENÉ, migrácia je mimo scope): `lineDimension`/
  `horizontalDimension`/`verticalDimension` (čiarové kóty + odkazové/witness
  čiary + ťaháky), `angleDimension` (uhlová kóta, oblúk overený round-trip
  testom endpoint→center podľa SVG spec F.6.5), `boxesCollide`/`placeLabel`
  (kolízne odsadzovanie), `fitScale`/`viewBoxAttr`, `fmtMm`/`fmtDeg`.
  `src/lib/vykres/mierka.ts` — `vypocitajMierku()`: MIERKA vždy VYPOČÍTANÁ
  (nikdy natvrdo "1:20", issue bod 4).
- `src/lib/components/vykres/`: `Kota.svelte` (tenký wrapper), `MontAluLogo.svelte`
  (inline SVG, žiadny externý fetch), `TitleBlock.svelte` (NÁZOV/PROJEKT/
  ČÍSLO VÝKRESU/MIERKA/Revízia/VARIANTA/Vypracoval/Dátum/NAVRH, clipPath
  ochrana proti pretečeniu na všetkých 8 hodnotových poliach), `VykresovyHarok.svelte`
  (rám + mriežka + title block v rohu + content snippet pre budúcu kresbu).
- A4 landscape tlač scoped LEN na `/vykresy/preview` (route-CSS-split `@page`)
  — overené e2e AJ naživo (CSSOM), že `/zasklenia` zostáva len `a4` (portrait).
- Nová interná demo route `/vykresy/preview` (nie v nav, b2b denylist
  `src/lib/server/b2b-access.ts` — drift guard `b2b-route-coverage.test.ts`
  ju vyžadoval).
- Adversariálny review (dispatchovaný Explore subagent) — 0 Critical, 3
  Warning (všetky opravené v `7d42c5b`: TitleBlock clipPath chýbal na 5/8
  poliach → Dátum mohol pretiecť; `horizontalDimension`/`verticalDimension`
  mali `perpOffset` natvrdo 0 → nepoužiteľné pre odsadenú CAD kótu, teraz
  prijímajú `perpOffset` + `Kota.svelte` deleguje na `verticalDimension`
  a vykresľuje witness čiary; `+page.svelte` dogfooduje `fitScale()` namiesto
  duplicitného `Math.min(...)`), 2 Suggestion (nekritické, pokryté).
  Review komentár: https://github.com/zbynekdrlik/automatizacie-montalu/issues/137#issuecomment-5236813500
- Golden snapshot (`tests/__snapshots__/`) — nezmenený (čisto display-only).
- Lokálne: `npx vitest run` 849/849 (62 kota.test.ts + 8 mierka.test.ts),
  `npm run lint` čisté, `npm run check` 0/0/0, `npm run build` OK,
  `npx playwright test` 140/140 (3 nové v `navrh-vykres.spec.ts`).
- **PR #140** (dev→main), merge `0af5223`. Main CI (test+deploy) zelené.
- **Post-deploy overenie naživo** (Playwright MCP, `marek` účet): `/health`
  → `{"ok":true,"version":"0.14.21 (0af5223)","live":true}`; footer
  `v0.14.21 (0af5223)`. `/vykresy/preview` — mriežka 1-16/A-L, pečiatka
  vyplnená (dátum zo servera), vodorovná/zvislá kóta s odkazovými čiarami,
  uhlová kóta 4,3°, červená poznámka — vizuálne zhodné s lokálnym
  screenshotom. CSSOM naživo potvrdil: `/vykresy/preview` = `["a4","a4
  landscape"]`, `/zasklenia` = `["a4"]` (nedotknuté). 0 chýb konzoly na
  oboch stránkach.
- #137 auto-zavretý mergom PR #140 (`Closes #137`).

## #138 — Pergola: zákaznícky návrhový výkres z rozmerového formulára (vzor OP260032) (2026-08-10)

- ROZHODNUTÉ komentár (user 2026-08-10) prepísal telo issue: 3D izometria SO
  ZVOD šípkami JE súčasť prvej verzie (pôvodne "bez 3D").
- Design comment (pred prvým code commitom):
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/138#issuecomment-5237090825
  (+ doplnok s "dôvod/prístup/alternatíva" frázovaním pre design-gate hook:
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/138#issuecomment-5237339945)
- Verzia 0.14.22 → 0.14.23 (`eb5dfc9`).
- Nová route `/pergola/navrh` (formulár → SVG výkres → A4 landscape tlač),
  postavená na základe #137 (`VykresovyHarok`/`Kota`/`TitleBlock`). Nový
  generický `src/lib/vykres/iso.ts` (30° dimetrická/axonometrická projekcia,
  4 kardinálne smery overené priamym výpočtom). Nový čistý TS compute modul
  `src/lib/pergola-navrh.ts` (spád, svetlá výška, rozmery strešnej výplne,
  3D izometrické hrany, ZVOD/poznámka kotvy) + `src/lib/server/pergola-navrh-vstup.ts`
  (parser formulára).
- Presné vzorce a ČESTNE PRIZNANÁ číselná nezrovnalosť oproti vzorovému "VIEW A
  2200"/"4,3°" (nedali sa čisto odvodiť jednou konzistentnou formulou z
  flattened PDF bez per-view magických konštánt) — plné zdôvodnenie v
  design komentári + hlavičke `pergola-navrh.ts`. Šírka/dĺžka strešnej výplne
  a predná svetlá výška sedia na vzore PRESNE (726mm, 3411mm, 2310mm).
- Money: 0 zásahov do `compute.ts`/`pergola.ts`, golden snapshot nezmenený.
  b2b: automaticky pokrytý existujúcim `/pergola` prefixom (drift guard).
- Self-review (pred `/requesting-code-review`) našiel a opravil 1 nález:
  `nastavPocetPoli()` nechávalo v stave zaškrtnutý ZVOD na stĺpe, ktorý po
  znížení počtu polí zanikol — server ho pri odoslaní odmietal bez zjavnej
  príčiny. Opravené `4a9f8f5`, regresný e2e test overený AJ na skutočnom páde
  (dočasný revert + rebuild pred obnovením opravy).
  Review komentár: https://github.com/zbynekdrlik/automatizacie-montalu/issues/138#issuecomment-5237548574
- Dispatchovaný `general-purpose` reviewer (`/requesting-code-review`,
  base `0af5223`, head `4a9f8f5`) — 0 Critical, 0 Important, 4 Minor
  (mierka je jednodimenzionálna aproximácia — už zdokumentované; diakritika
  v názve funkcie `stlpyZPolí`; zníženie počtu polí nevracia zvody pri
  opätovnom zvýšení — zámerné; chýba dedikovaný b2b e2e test na tejto
  konkrétnej podroute — pokryté unit drift-guardom). Verdikt: Ready to merge.
- Golden snapshot (`tests/__snapshots__/`) — nezmenený.
- Lokálne: `npm run lint` čisté, `npm run check` 0/0/0, `npx vitest run`
  910/910 (11 iso.test.ts + 37 pergola-navrh.test.ts + 12
  pergola-navrh-vstup.test.ts nové), `npm run build` OK,
  `npx playwright test` 146/146 (6 nových v `pergola-navrh.spec.ts`).
- **PR #141** (dev→main), merge `08e9874`. Main CI (test+deploy) zelené.
- **Post-deploy overenie naživo** (Playwright MCP, `marek` účet): `/health`
  → `{"ok":true,"version":"0.14.23 (08e9874)","live":true}`; footer
  `v0.14.23 (08e9874)`. `/pergola/navrh` s hodnotami OP260032
  (6000=3000+3000, hĺbka 3500, výšky 2500/2800, 8×726mm výplň) — všetkých 5
  pohľadov vykreslených, pečiatka vyplnená, ZVOD šípky na oboch zaškrtnutých
  stĺpoch, vizuálne zodpovedá vzoru (spány/hĺbka/panel presne, sklon 4,9° vs
  vzorové 4,3° — zdokumentovaná nezrovnalosť). 0 chýb konzoly.
- Discord run-card odoslaná (`notify --run-card --issue 138`, potvrdené
  doručenie). #138 auto-zavretý mergom PR #141 (`Closes #138`).

## #142 — Voľba roly pri založení účtu + zmena roly z appky (2026-08-11)

- Reálny incident: šéf si cez jediný dostupný formulár (len B2B) založil
  účet `palo@montalu.sk`, dostal orezanú rolu, opravovalo sa ručne cez
  docker exec. Design comment (pred prvým code commitom):
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/142#issuecomment-5251316355
  (+ validačný komentár:
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/142#issuecomment-5251315994)
- Verzia 0.14.24 → 0.14.25 (`54c22c5`).
- `pridat` číta rolu z formulára (default B2B) — bezpečné, lebo b2b aktér je
  odmietnutý PRED čítaním role. Nová `changeUserRole()` (db.ts) + akcia
  `zmenit_rolu`: vlastnú rolu nemožno zmeniť (porovnáva `id`), posledný
  interný účet nemožno degradovať. Nová tabuľka `user_audit` (migrácia
  v19→v20, aditívna) — audit vytvorenia aj zmeny roly.
- Commity: `bd41431` (feat), `78aaa1d` (unit testy), `8e44d2c` (e2e testy),
  `8d387f8` (docs/playbook access-control), `584caf4` (fix: self-review —
  no-op zmena roly nehlásila „zmenená", pridaný `changed:boolean`),
  `d700c56` (fix: deep-review nález — `pridat`/`zmazat` zarovnané s
  `!locals.user` gate).
- Testy: `tests/users-admin.test.ts` (addUser audit, countInternalUsers,
  changeUserRole úspech/vlastná rola/posledný interný/no-op),
  `tests/pouzivatelia-actions.test.ts` (forged POST na všetky 3 akcie —
  b2b nemôže eskalovať ani s `role=internal` v tele), `e2e/pouzivatelia-role.spec.ts`
  (3 nové: založenie Interný účtu → plný prístup → zmena roly späť na B2B cez
  UI → zmazanie; vlastná rola sa v UI vôbec nezobrazí; popisok viditeľný) +
  aktualizované `e2e/app.spec.ts`/`e2e/sietka.spec.ts` (tlačidlo „Pridať B2B
  účet" → „Pridať účet"). Migrácia teraz končí na v20 — všetky
  `migration-*.test.ts` finálne assercie prepísané z 19 na 20.
  Lokálne: `npm run lint` čisté, `npm run check` 0/0/0, `npm test` 925/925,
  `npm run build` OK, `npx playwright test` 149/149.
- `superpowers:requesting-code-review` (nezávislý subagent, skutočne spustil
  celý lokálny gate na izolovanom worktree nad `08e9874c..8d387f8d`): 0 🔴,
  1 🟡 (presne no-op-hlásenie nález, už opravený v `584caf4`), 2 🔵
  (`!locals.user` konzistencia — opravená v `d700c56`; chýbajúci
  autopilot-log záznam — toto je ten záznam). Review komentár:
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/142#issuecomment-5251671233
- **PR #143** (dev→main), merge `3d5ccfc`. Main CI (test+deploy) zelené.
- **Post-deploy overenie naživo** (Playwright MCP, `marek` účet): `/health`
  → `{"ok":true,"version":"0.14.25 (3d5ccfc)","live":true}`; footer
  `v0.14.25 (3d5ccfc)`. `/pouzivatelia`: select roly (default B2B) + popisok
  v pridávacom formulári, per-riadok select+Zmeniť na 5/6 účtoch (marekova
  vlastná rola bez ovládača, len text), `palo@montalu.sk` zobrazený ako
  Interný. Live smoke test: vytvorený `e2e-postdeploy-test-142` (B2B) →
  potvrdené v tabuľke → zmazaný → späť na 6 účtov. 0 chýb konzoly.
- Discord run-card odoslaná (`notify --run-card --issue 142`, potvrdené
  doručenie). #142 auto-zavretý mergom PR #143 (`Closes #142`).

## 2026-08-11 — Pergola návrh: vizuálna vernosť CAD vzoru 2. kolo + oprava kolízie nadpisov (#145 #146)

- **Issues:** #145 (nadpisy PREDNÝ POHĽAD / REZ A kolidujú s hornou rastrovou
  lištou), #146 (druhé kolo vizuálnej vernosti voči vzoru OP260032 — kóty bez
  „mm", reálna hrúbka konštrukcie, hierarchia hrúbok čiar, rozloženie hárku,
  úzke technické písmo, uhlová kóta spádu). Oba CLOSED (auto, `Closes #145`
  `Closes #146` v PR #148).
- **Design comment** (predchádzajúci worker, pred prvým code commitom):
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/146#issuecomment-5252667266
  (DESIGN + OVERENÉ, viď issue #146 história pre plné znenie)
- **Commity (dev):** `caa8051` verzia 0.14.28 → `d5770d1` test:[red] regresný
  test #145 → `1ac976b` fix:[green] #145 fix + #146 vizuálna vernosť (hlavná
  implementácia predchádzajúceho workera, ktorý zomrel na API rate limit
  uprostred vlastného review — nálezy neboli zapísané) → `897ca0e` fix:[green]
  MÔJ deep-review nález #1 (panelDlzka kóta renderovaná CEZ obrys, sign error
  v `perpOffset` — `verticalDimension`'s vlastný kontrakt je "kladné =
  doľava", `-16` posúval opačne) + duplicitná `TB_H=50` (teraz
  `titleBlockData.height`) → `19a011b` fix:[green] MÔJ deep-review nález #2
  (nezávislý fresh-context subagent našiel: oprava #1 posunula
  `witnessLine`'s pevný `overshoot` za ľavú hranicu kresliacej oblasti —
  `perpOffset=17` + nezávislé `labelOffset=0` to opravilo bez nového
  kolízneho nálezu; + zastaraný komentár "dvojriadkovo").
- **Testy:** `e2e/pergola-navrh.spec.ts` regresia #145
  (`getBoundingClientRect` nadpis vs. horná rastrová lišta) + prepis kót na
  presnú zhodu bez „mm" (regex `/^3000$/` namiesto substring). Lokálne:
  `npm run check` 0/0/0, `npm run lint` čisté, `npm test` 929/929,
  `npx playwright test e2e/pergola-navrh.spec.ts` 8/8 (vrátane b2b #144 aj
  regresie #145).
- **Review:** fresh-context `general-purpose` subagent (ekvivalent /review +
  requesting-code-review), napísal samostatný skript replikujúci
  `kota.ts`'s dimension funkcie na overenie súradníc. Prvé kolo: 0 🔴 0 🟡
  2 🔵 (witness presah cez rám, zastaraný komentár) — oba opravené v `19a011b`.
  Finálny stav: 0 🔴 0 🟡 0 🔵. Review komentáre na #146:
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/146#issuecomment-5254191665
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/146#issuecomment-5254614141
- **PR #148** (dev→main), merge `a2087f2`. Main CI (test+deploy) zelené.
  CI gotcha: `version-check` check-run zamrzol na `IN_PROGRESS` napriek tomu,
  že run aj job-log boli hotové/zelené (nová varianta zombie-run bugu, viď
  `.claude/rules/ci.md`) — opravené cez `gh workflow run ci.yml --ref dev`.
- **Post-deploy overenie naživo** (Playwright MCP, `marek` účet): `/health`
  → `{"ok":true,"version":"0.14.28 (a2087f2)","live":true}`; footer
  `v0.14.28 (a2087f2)`. `/pergola/navrh` s OP260032 hodnotami: všetkých 5
  pohľadov, kóty bez „mm", 0 chýb konzoly, žiadny vizuálny prekryv v paneli
  výplne. Golden snapshot (`zasklenia-posuvspec-golden.test.ts.snap`)
  overený byte-identický (žiadna zmena).
- Discord run-card odoslaná pre #145 aj #146 (`notify --run-card`,
  potvrdené doručenie).
- Playbook: `.claude/rules/vykres.md` (2 nové sekcie — `perpOffset` sign
  overenie + tight-column `labelOffset` decoupling) a `.claude/rules/ci.md`
  (zombie check-run variant) — viď PR pre túto verziu.

## #150 — Pergola návrh: farebný režim podľa RAL (prepínač technický/farebný + RAL dropdown)

- **Predošlý worker** (zahynul po code review, nestihol reagovať): implementoval
  celú feature (`c0ef640` — dátový model `RAL_PALETA`/`farbaKonstrukcie`/
  `ciarovaFarba` v `pergola-navrh.ts`, podmienený fill/stroke v
  `PergolaNavrhVykres.svelte`, print CSS vo `VykresovyHarok.svelte`, RAL
  dropdown + swatch vo formulári, testy) + version bump `56e87b9`
  (0.14.29 → 0.14.30-dev.1). Review verdikt: 0 🔴 1 🟡 4 🔵.
- **Táto session dokončila:** oprava 🟡 (`src/routes/pergola/navrh/+page.svelte:397-402`
  — výber „— nevybraté —" nevynuloval `ralS`, červená poznámka ukazovala starý
  odtieň). RED (`1488d89`, overené na rebuilde BEZ fixu — padá presne na
  `not.toBeAttached()`) → GREEN (`a5e3690` — `ralS = ''` pri `kod === ''`).
  Vlastný prechod diffom nenašiel žiadny zo 4 nespecifikovaných 🔵 nálezov
  (neboli enumerované, nič nevymýšľané).
- **Review:** vlastný prechod + nezávislý fresh-context subagent nad celým
  diffom `origin/main..HEAD` — **0 🔴 0 🟡 0 🔵**. Komentár:
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/150#issuecomment-5265315136
- **Testy:** `npm run lint` čisté, `npm test` 944/944, `npm run build` zelený,
  `npx playwright test` 158/158 (vrátane všetkých 15 v
  `e2e/pergola-navrh.spec.ts`, incl. nového regresného testu). Snapshot diff
  (`tests/__snapshots__/`) proti `origin/main` prázdny.
- **PR #151** (dev→main), merge `da846c7`. Main CI (test+deploy) zelené,
  všetky joby (`test`, `deploy`) success.
- **Post-deploy overenie naživo** (Playwright MCP, `marek` účet): `/health`
  → `{"ok":true,"version":"0.14.30-dev.1 (da846c7)","live":true}`; footer
  zhoda. `/pergola/navrh` s OP260032 hodnotami: technický (čiernobiely,
  default) render nezmenený; farebný RAL 7016 ANTRACIT — konštrukcia
  `fill=#383E42`, tenký obrys `stroke-width=0.4` (< šírka tvaru), izometria
  stroke `#383E42` (nezmenený, tmavý odtieň); farebný RAL 9006 STRIEBORNÁ —
  `fill=#A5A8A6`, tenký obrys drží kontrast na bielom, izometria stmavená na
  `#4a4c4b`, 17 hrán (žiadne zdvojenie). 0 chýb konzoly na všetkých 3
  renderoch.
- Discord run-card odoslaná pre #150 (`notify --run-card`, potvrdené
  doručenie).
- Playbook: `.claude/skills/testing/SKILL.md` — opravená existujúca
  poznámka o `browser_click`/`browser_select_option` „Invalid arguments"
  (skutočná príčina je zlý parameter `element`/`ref` namiesto `target`, nie
  flaky tool — `ToolSearch` + `target: <ref>` funguje priamo,
  `browser_evaluate` netreba len kvôli tomuto); + 2 nové poznámky (RED-state
  overenie cez `git stash` potrebuje tiež rebuild pred testom; Playwright MCP
  screenshot píše len do allowed roots AKTUÁLNEJ session, nie cieľového repa
  pri cross-project dispatchi — ukladaj relatívne, potom `cp`).

## 2026-08-12 — Pergola výkres: obrysové profily namiesto plných pásov (#153)

- **Issue:** #153 — šéf (Odoo #1671033) porovnal náš výkres so Solid Edge
  vzormi: "ešte trocha ostrejšie kontúry na profiloch, pôsobí to
  rozmazane". Rescope komentár (ROZHODNUTÉ) zúžil rozsah na ostrosť
  profilov — obsah/rozloženie výkresu sa nemení.
- **Design comment** (root cause, prístup, zamietnutá alternatíva) pred
  prvým kódovým commitom:
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/153#issuecomment-5265909510
- **Root cause:** `STRUKTURA_STROKE=1,8mm` (technický režim) bola pri
  typickej mierke (OP260032) ŠIRŠIA než reálne nakreslená hrúbka profilu
  (stĺp ≈1,65mm) — stred-zarovnaný SVG stroke zhltol celú svetlú fill.
  `pn-section-strecha`/`pn-section-predok` mali navyše priamo
  `fill=CIERNA` v technickom režime.
- **Commits (dev):** `093605a` verzia 0.14.32-dev.1 → `25155ba` zjednotená
  STRUKTURA_STROKE=1,2mm (oba režimy) + crispEdges → `bc2c125` [red] +
  `0b26aea` [green] review nález (obrysStroke — dynamický clamp na
  polovicu rozmeru tvaru) → `1fa8891` verzia 0.14.32 + autopilot log +
  playbook (proces-nález nižšie) → `<tento commit>` oprava na 0.14.33.
- **Review:** fresh-context subagent nad celým diffom `origin/main..dev` —
  **1 🔴 nález** (pevná STRUKTURA_STROKE=1,2mm sa pri extrémnych, stále
  validných rozmeroch vstupu (hĺbka blízko HLBKA_MAX) opäť zhltne — NOVÁ
  regresia aj pre farebný RAL režim), opravené `obrysStroke()` + RED→GREEN
  regresný test. Komentár:
  https://github.com/zbynekdrlik/automatizacie-montalu/issues/153#issuecomment-5266374356
- **Testy:** `npm run check`/`npm run lint` čisté, `npm test` 944/944,
  `npx playwright test` 160/160 (17 v `e2e/pergola-navrh.spec.ts`, vrátane
  nového `#153` obrysového spot-checku + nového extrémne-rozmerového
  regresného testu).
- **PR #157** (dev→main), merge `4cfcb59`. Main CI (test+deploy) zelené.
  **Proces-nález (vlastný, nie review):** PR #157 sa zmergol s dev ešte na
  `0.14.32-dev.1` — vynechaný krok „bump na čistú verziu TESNE PRED PR"
  (CLAUDE.md „## Version") — main tak krátko niesol `-dev` string (známa
  trieda bugu #1/#101/#98). Náprava (`1fa8891`) skúsila vrátiť dev na
  čistú `0.14.32`, ale `version-check`'s `sort -V` porovnanie NIE JE
  semver-aware — pri ROVNAKOM číselnom prefixe radí `-dev.N` variant
  VYŠŠIE než čistý (`sort -V` na `["0.14.32-dev.1","0.14.32"]` vráti
  `-dev.1` posledný = "najvyšší"), takže `main=0.14.32-dev.1` vyšlo
  "vyššie" než `dev=0.14.32` a CI `version-check` spadol. Skutočná náprava:
  bump na ĎALŠIE číslo (`0.14.33`), nie späť na rovnaké — zdokumentované v
  `.claude/rules/ci.md`.
- **Post-deploy overenie naživo** (Playwright MCP, `e2e` účet cez lokálny
  preview pred pushom + `/health` po deploji): technický aj farebný RAL
  7016 režim vizuálne overené screenshotmi — profily majú svetlý interiér
  s ostrým tenkým obrysom namiesto plných čiernych pásov, presne podľa
  Solid Edge vzoru.
- Discord run-card odoslaná pre #153 (`notify --run-card`).
- Playbook: `.claude/rules/vykres.md` — nová poznámka (fixed stroke-width
  na vyplnenom tvare treba overiť proti CELÉMU vstupnému rozsahu, nie len
  proti demo fixture — `obrysStroke()` vzor na znovupoužitie);
  `.claude/skills/testing/SKILL.md` — nová poznámka (manuálny
  `npm run preview` pre živý MCP screenshot potrebuje rovnaké env
  premenné ako `playwright.config.ts`'s `webServer`, a musí bežať cez
  `run_in_background: true`, nie `(cmd &)` subshell); `.claude/rules/ci.md`
  — nová poznámka (`sort -V` `-dev.N` vs. čistá verzia kolízia + náprava).

## #162 — Zasklenia: zákaznícky návrhový výkres (2026-08-12)

- Nová route `/zasklenia/navrh`, architektúra 1:1 podľa pergolového `/pergola/navrh`
  (#138/#144/#150/#153): `src/lib/components/ZaskleniaNavrhVykres.svelte` na
  zdieľanom #137 základe (VykresovyHarok bez `titleBlock` — bod 4 zadania, žiadny
  info rámček), `src/lib/zasklenia-navrh.ts` (čistá geometria, N ZNOVUPOUŽITÉ z
  `listSysStyly()`), `src/lib/server/zasklenia-navrh-vstup.ts`,
  `src/routes/zasklenia/navrh/+page.{server.ts,svelte}`. RAL logika
  vyextrahovaná z `pergola-navrh.ts` do zdieľaného `src/lib/vykres/ral.ts`
  (pergola-navrh.ts re-exportuje pre spätnú kompatibilitu). b2b prístup
  automaticky (žiadna výnimka v `B2B_ALLOWED_EXCEPTIONS` netreba) + top-nav
  odkaz. Design komentár: issuecomment-5267691601 (repost 5267739296).
- Testy: `tests/zasklenia-navrh.test.ts`, `tests/zasklenia-navrh-vstup.test.ts`
  (45 nových), `e2e/zasklenia-navrh.spec.ts` (9 testov), `tests/b2b-route-
  coverage.test.ts` rozšírený. Commity 7c9a698 (verzia)/649a89e (feature).
- Deep review (general-purpose subagent): 0 🔴, 5 🟡, 3 🔵 — všetky opravené
  v 397a763 (obrysStroke guard na MIN(šírka,výška), parseKlin prepísaný na
  rovnakú validáciu ako `$lib/server/vstup.ts`, top-nav odkaz + opravená e2e
  kolízia v `app.spec.ts`, round-trip test rozšírený). Reviewed komentár:
  issuecomment-5268462797.
- PR #164 merged ab924f4 → main CI zelené, deploy OK, ale `/health` ukázal
  `0.15.0-dev.1` — CHÝBAJÚCI clean-version bump pred PR (rovnaký bug ako
  #1/#101). Naprava per `.claude/rules/ci.md`: bump na ĎALŠIE číslo (0.15.1,
  nie späť na 0.15.0), PR #165 (748d647→4b9a0a3), `/health` opravené.
- **Live post-deploy overenie (Playwright MCP, marek účet) odhalilo KRITICKÝ
  bug**: select "Systém" na `/zasklenia/navrh` sa po zmene TICHO vrátil na
  prvý systém v DB zozname (Deluxe) namiesto zvoleného — sebareferenčný
  `$effect` self-loop (`stylS = v?.styl ?? stylyForSystem(systemS)[0] ?? ''`
  čítalo `systemS` hneď po tom, čo ho ten istý effect zapísal). Lokálne E2E
  testy to nechytili, lebo vždy vyberali "Robust" — zhodou okolností PRVÝ
  systém v lokálnom/CI seede, takže revert-na-default náhodou dal správnu
  hodnotu. Fix (f9905be, verzia 0.15.2): odstránené sebareferenčné čítanie.
  Nový regresný e2e test (explicitne zisťuje NIE-prvý systém za behu) overený
  RED bez opravy / GREEN s opravou. PR #166 (f9905be→849f444). Live
  re-overené: Robust 3K, 3 krídla, kóty správne, 0 console chýb.
- Discord run-card odoslaná pre #162 (`notify --run-card`).
- Playbook: `.claude/rules/vykres.md` — nové poznámky (RAL logika žije v
  `$lib/vykres/ral.ts`, outer-`<g>`-vs-inner-element `data-testid` kolízia).

## #139 — Bazén: zákaznícky návrhový výkres, fáza 1 (2026-08-12)

- Nová route `/bazen/navrh`, architektúra 1:1 podľa `/pergola/navrh`
  (#138/#144/#150/#153) a `/zasklenia/navrh` (#162): `src/lib/bazen-navrh.ts`
  (čistá geometria — `variantaZSekcii`, `presahKolajniska`, `sekcieVysky`,
  `sekciePozicie`, `posuvPopis`, `dverePopis`, `predvyplnenyNazov`),
  `src/lib/server/bazen-navrh-vstup.ts`, `src/lib/components/
  BazenNavrhVykres.svelte` (bokorys/pôdorys/textový popis/rez sekciou
  rezervovaný), `src/routes/bazen/navrh/+page.{server.ts,svelte}`.
  `VykresovyHarok.svelte` dostal novú opt-in `podpisovaLista` prop (default
  `false`) + nový `PodpisovaLista.svelte` komponent. Na rozdiel od pergoly/
  zasklenia je `/bazen/navrh` pre b2b ÚPLNE zablokovaná (zadanie ticketu) —
  žiadna výnimka v `b2b-access.ts`, blokuje ju existujúci `/bazen` prefix.
  Priečny rez sekciou (VIEW A) je zámerne mimo fázy 1 — tvar oblúka
  overiteľne nesedí na kruh ani elipsu, tracked ako samostatný issue.
  Design komentár: issuecomment-5269395174.
- Testy: `tests/bazen-navrh.test.ts`, `tests/bazen-navrh-vstup.test.ts`,
  `tests/bazen-navrh-money-safety.test.ts` (68 nových), `tests/
  b2b-route-coverage.test.ts` rozšírený, `e2e/bazen-navrh.spec.ts`
  (8 testov, vektor OP260055). Commity `9190750` (verzia)/`18bd93f`
  (feature).
- Deep review (fresh-context `general-purpose` subagent): 3 🔴 3 🟡 2 🔵 —
  všetky opravené v `7a28d29`: degenerovaná (nulovej dĺžky) presah-kóta pri
  `dlzkaKolajiska === zatvorenaDlzka` (validácia `<` → `<=`), výškové
  popisky kót čítali priamo z `vstup.vyskaMax/vyskaMin` namiesto zo
  skutočne nakreslenej `vysky[]` geometrie (nesedelo pri 1 sekcii),
  `obrysStroke()` guard chýbal na dverovej sekcii, `sirkaSekcieOverride`
  neposúval skutočnú pozíciu hranice (len popisok), textový popis mohol
  pretiecť pod pečiatku (pridaný `<clipPath>`). Reviewed komentár:
  issuecomment-5270007279.
- PR #169 (dev→main), verzia 0.15.4 (`a400c86`). Lokálne overené pred
  pushom: 1050 unit + 177 e2e (celý balík, potvrdzuje zdieľanú
  `VykresovyHarok.svelte` zmenu ako bezpečnú pre pergolu/zasklenia).
- Playbook: `.claude/rules/vykres.md` — nové poznámky (kóta popisok MUSÍ
  čítať z nakreslenej geometrie nie priamo z formulárových polí; ručný
  override musí posunúť aj pozíciu, nie len popisok; text-blok vedľa
  pečiatky potrebuje `<clipPath>`, zúženie regiónu samo nič nevynucuje;
  `podpisovaLista` vzor pre ďalší hárkový prvok) + rozšírená `paths:`
  frontmatter o nové bazén súbory.

## 2026-08-12 — Zasklenia: profesionálny zákaznícky 3D náhľad, fáza 1 (#170)

- **Issue:** #170 — plochý 2D SVG technický výkres ako predajný materiál pre
  zákazníka bol majiteľom zamietnutý ("uplne hrozne to vyzera, ma to byt profi
  upútavujúci 3d model"). Nahrádza/dopĺňa ho three.js 3D scéna produktu v
  skutočnom kontexte (dlažba/stena/obloha/kontaktný tieň) — víťazný koncept
  "scena-kontext" zo 7-agentového design workflow, roubovaný s prvkami
  prehratého konceptu "stylizovany" (bez voľnej orbity, dvojvrstvý kontaktný
  tieň, nula textu v rendere, T0 SVG-poster fallback).
- **Validácia + prístup** (pred prvým commitom): issuecomment-5270444307
  (STEP 0 overenie), issuecomment-5270444741 + issuecomment-5270468999
  (root cause → prístup → zamietnutá alternatíva), issuecomment-5270488644
  (doplnenie STEP 0).
- **Commits (dev, feature):** `563640c` verzia 0.16.0-dev.1 → `04ba0bb` feat:
  THREE-free geometria (`geo/zasklenia.ts`) + builder/materiály/textúry/
  scéna/kamera/kvalita/snímka → `fd4762c` feat: `Vizual3D.svelte` (canvas +
  onMount + dynamic import), `Vizual3DPanel`, `Vizual3DPoster` (T0), wire do
  `/zasklenia/navrh` + nová `/zasklenia/navrh/zakaznicky` (tlačový list,
  `<foreignObject>` PNG) → `1321d60` self-review fix (context listener
  duplicity, dispose leaky) → `48ce62d` fix: 10 review nálezov → `bac4c6a`
  verzia 0.16.0 → `058463a` fix: e2e timeout 60s pre 2 najťažšie testy
  (softvérový WebGL na CI runneri pomalší než lokál).
- **Testy:** 95 nových unit (geometria/proporcie/RAL/builder/kamera/kvalita/
  snímka/money-guard) + existujúca sada (1125/1125). 13 nových e2e
  (`vizual3d.spec.ts`, `zasklenia-zakaznicky.spec.ts`) + existujúca
  `zasklenia-navrh.spec.ts` sada (190/190 v CI).
- **Deep review** (fresh-context `general-purpose` subagent): 1 🔴 4 🟡 5 🔵 —
  všetkých 10 opravených v tejto vetve. 🔴 = duplicitné WebGL context
  listenery (registrácia presunutá z `inicializuj()` do `onMount`). Reviewed
  komentár: issuecomment-5271973286.
- **PR #171** (dev→main), verzia 0.16.0 (`788f2d1`). Live post-deploy
  overenie Playwrightom: desktop (1440×900) aj phone (390×844) viewport,
  4 presety (3/4 exteriér, čelný, zvnútra, otvorené/zatvorené) na oboch,
  nula console errors/warnings v celom behu, verzia potvrdená z DOM footera.
- **Follow-up (dokumentácia + deploy hardening, MIMO #170 diffu, nájdené pri
  post-deploy overovaní):**
  - PR #172 (`c51a633`, v0.16.1) — `.claude/rules/vizual3d.md` (WebGL
    context-lock probe, `forceContextLoss()` nevratnosť, `preserveDrawingBuffer`
    test gotcha, SVG `<foreignObject>` Playwright locator limit) + CLAUDE.md
    router.
  - Deploy na `167.233.125.9` zlyhal 3× po sebe (`npm ci` → `better-sqlite3`
    `prebuild-install` "socket hang up" pri sťahovaní z GitHub CDN, node-gyp
    fallback vždy padne — image zámerne bez Pythonu). Root cause: prechodná
    záťaž VPS (build cache 21GB reklamovateľných → vyčistené na 5.7GB, disk
    82%→43%), NIE trvalá porucha — nepodarilo sa manuálne zreprodukovať
    (curl×3, `docker run`, `docker build` cez BuildKit, všetko čisto).
  - PR #173 (`fc57d25`, v0.16.2) — prvý pokus fixu (`npm ci --fetch-retries`)
    bol OMYLOM: ten flag pokrýva len npm registry klienta, `prebuild-install`
    má vlastný HTTP klient mimo neho — 4. deploy zlyhal identicky AJ s flagom.
  - PR #175 (`6720fab`, v0.16.3) — skutočný fix: retry CELÉHO `npm ci`
    shell príkazu (2 opakovania, 5s/20s backoff) — zopakuje aj
    `prebuild-install`-ov fetch. Overené priamym `docker build --target build`
    na VPS pred pushom. Nasadené a zdravé (`{"ok":true,"version":"0.16.3
    (6720fab)","live":true}`).
- Playbook: `.claude/rules/vizual3d.md` (nový, viď vyššie) + poznámka na
  budúce: `npm ci --fetch-retries` NEPOMÁHA proti prebuild-install zlyhaniam
  (registry-only flag) — použi shell-level retry celého príkazu.

## #174 ZNOVUOTVORENÉ (usadenie na zem) — PR #181

- Reopen po #178 (prijaté: sklo/kamera/kontrast): finálne live screenshoty
  ukázali jednotku "vznášajúcu sa" nad dlažbou (medzera, odpojená tieňová
  elipsa, "pravý spodný roh visí vo vzduchu" v troStvrte).
- Numerické overenie (Node + `window.__VIZDEBUG` live scene-introspekcia)
  VYVRÁTILO prvý dohad — žiadny Y-výškový posun (unit-bottom/zem/základňa
  steny/rovina tieňa všetky = 0). Skutočná príčina: `vytvorKontaktnyTien`
  (scena.ts) — (1) X/Z posun celej roviny v smere svetla (správne pre
  vrhnutý tieň, nesprávne pre kontaktný dekal), (2) kruhový radiálny
  gradient na ŠTVORCOVEJ ploche podľa `Math.max(w,d)` — pri širokej/plytkej
  jednotke (~28:1) tvrdé jadro nedosiahlo ku koncom koľajnice.
- Fix: tieň vždy centrovaný (x=0,z=0), tvarovaný nezávisle šírka/hĺbka
  (šírka podľa bbox.w, hĺbka podľa `max(bbox.d, 0.45×bbox.h)`, orezaná
  zhora na šírku).
- Commity: `f7a52c6` (bump 0.16.8) → `36b4c7b` [red] → `5fe8cb3` [green] →
  `0461fea` (review fixes: komentárová aritmetika 680mm→1361mm + hĺbkový
  clamp pre úzku-vysokú jednotku). Fresh-context review (general-purpose
  subagent): 0🔴 2🟡(oba opravené) 2🔵. `tests/vizual-scena.test.ts` (9 testov,
  nový súbor).
- PR #181 (dev→main), merge `f1758c2`, verzia 0.16.8. CI: version-check +
  test (1149 unit + 190 e2e, `npx playwright test` celá sada lokálne pred
  pushom aj v main-branch CI) + deploy, všetko zelené.
- Post-deploy Playwright overenie (desktop 1440×900 + phone 390×844,
  celny/troStvrte/otvorene, live app.montalu.cloud): VŠETKY kritériá PASS —
  rám sedí priamo na dlažbe, žiadna medzera, tieň sleduje celú šírku rámu.
  `{"ok":true,"version":"0.16.8 (f1758c2)","live":true}`.
- Playbook: `.claude/rules/vizual3d.md` rozšírený o (1) "nepredpokladaj
  Y-posun, over číslami" ponaučenie, (2) `__VIZDEBUG` naживo scene-
  introspekcia technika, (3) canvas/`document` no-op polyfill pre testovanie
  `scena.ts` mimo `low` tieru, (4) `jadroR`/`stred` sú frakcie CELEJ šírky
  canvasu, nie polovice (rovnaká trieda chyby ako sRGB/lineárny gotcha).

## #154 — Cenový zoznam materiálu k zákazke, fáza 1 (2026-08-13)

- ROZHODNUTÉ (šéf/tím, komentáre na tikete 2026-08-12): fáza 1 = ceny + dostupnosť
  materiálu, READ-ONLY z denného Money snapshotu (appka do Money nikdy nezapisuje).
  Rezervácia + sledovanie cez pracoviská ostávajú otvorené — #154 touto prácou
  NEZATVORENÉ.
- Migrácia v21: `material_prices` (kod PK, `sklad` nullable REAL — 0/záporné sú
  reálne hodnoty z Money, `NULL` = kód nikdy nemal skladovú kartu), `material_prices_meta`
  (1 riadok, vek/mtime snapshotu), `odpis_polozky` (FK CASCADE na odpis_log, zapisované
  v TEJ ISTEJ transakcii ako `odpis_log` insert — `writeOdpis` v money.ts obalené).
- `src/lib/server/ceny.ts` — lazy mtime-gated import, zlý riadok sa preskočí+zaloguje
  (nikdy nezhodí celý import), `enrichPolozky()` JOIN + súčty s `kompletne` príznakom.
  ZASK* (kovanie) kódy nikdy nedostanú veľkoobchodnú predajnú cenu (šéfovo rozhodnutie,
  vynútené priamo v ceny.ts, nielen v producer skripte).
- `scripts/ceny-snapshot.py` — read-only producer, overený ŽIVO cez tunel proti Money
  (299 riadkov ZASP*/ZASK*). Stĺpcové mapovanie: `nakupCennik`=Ceniky_PolozkaCeniku
  (Cenik `NC`/Nákupný cenník), `nakupPoslednaFaktura`=Artikly_ArtiklDodavatel.PosledniCena,
  `predajVo`=Ceniky_PolozkaCeniku (Cenik `PRF_VO`), `sklad`=S5_Artikl_CelkoveMnozstviNaSkladech.
- UI: `CenyTabulka.svelte` (zdieľaná) v zasklenia náhľade (nahlad/nahladMulti, LEN
  interní — `cenyPre()` gate) + nová `/odpisy/[id]` detail stránka (tlačiteľná).
- Fresh-context review (general-purpose subagent): 0🔴 2🟡(oba opravené — sklad
  nullable namiesto kolapsu na 0, rejectedCount surfacnutý v UI) 5🔵(2 opravené —
  mtime typ REAL, mena per-riadok; 3 vedome neopravené, zdôvodnené na tikete).
  Golden charakterizačný snapshot (#109) ostal čisto ADITÍVNY (dve kolá: +1563/-0,
  +121/-0).
- Commity: `fb2af1a`(bump 0.17.0-dev.1) → `7208044`(migrácia v21) → `c366c1a`
  (transakcia) → `37e40e5`(ceny.ts) → `b04dd25`(UI) → `c3192c0`(/odpisy/[id]) →
  `cd2fda2`(producer+ops) → `88402ba`(e2e) → `be07b0d`(review fixes) →
  `e8a0c6b`(proces oprava: čistá verzia pred mergom).
- PR #184 (dev→main), merge `9acf88f`, verzia `0.17.0-dev.1` (CHYBA — zabudnutý
  druhý version bump pred mergom, viď money-odpis skill §6). Opravené PR #185,
  merge `c87ee24`, výsledná nasadená verzia `0.17.1`.
- Post-deploy Playwright overenie na `app.montalu.cloud` (interný účet, LEN
  Spočítať, NIKDY Odoslať): cenová tabuľka sa vykreslila správne, „cena neznáma"
  všade (žiadny snapshot na VPS ešte neexistuje), súčty priznané ako neúplné,
  0 console errors/warnings, verzia v pätičke `v0.17.1 (c87ee24)` sedí s deployom.
- Ops krok, ktorý appka sama nespraví: `scripts/ceny-snapshot.py` treba spustiť
  DENNE (cron) na boxe, odkiaľ je Money dosiahnuteľné (dev1, cez tunel), výstup
  rsync-nuť na VPS do `/opt/automatizacie-montalu/ceny/ceny.json`
  (`docker-compose.yml` má pripravený `:ro` bind mount) — nespravené v tomto behu,
  potrebuje človeka na nastavenie cronu + credentials na dev1.
- Playbook: `.claude/skills/money-odpis/SKILL.md` §6 (verzia pred mergom) — pridaný
  živý dôkaz, prečo sa na to oplatí dať pozor: PR #184 sa zmergovala s „-dev.1"
  priamo na main, opravné PR #185 muselo bumpnúť o celé číslo vyššie (0.17.1),
  lebo `sort -V` nedovolí návrat na čistú 0.17.0.

## #168 — spoločná kompozícia technických hárkov (2026-08-13)

- Root cause: `ZaskleniaNavrhVykres.svelte` fixný `baseY = r.y + r.h*0.85` (nie
  centrovanie) → prázdna horná tretina pri width-limited mierke; `BazenNavrhVykres
  .svelte`'s `REZ SEKCIOU` box zaberal `oblast.w*0.17` × celú výšku, hoci nesie len
  2-3 riadky textu, kým #163 nedoplní skutočný rez.
- Nový zdieľaný modul `src/lib/vykres/kompozicia.ts` (`fitCentered`/`centerAt`/
  `sharedFitScale` + `MIN_TITLE_FONT`/`MIN_SUBTITLE_FONT`/`MIN_DIM_FONT`/
  `MIN_SPEC_FONT`) — cieľ 60-75% plochy, vycentrované v oboch osiach namiesto
  fixného odsadu. Nová `pohyblivePanely(n, smer)` (`zasklenia-navrh.ts`) — šípka
  na pohyblivom krídle, nezávislá reimplementácia `vodiaceIndexy()` z
  `vizual/geo/zasklenia.ts` (ten súbor ostal nedotknutý). Bazén: bokorys/pôdorys
  zdieľajú JEDNU mierku + zdieľaný X=0 (aby deliace sekcií sedeli pod sebou),
  vážený (nie 50/50) výškový split (`bokFrac`), keďže bokorys je takmer vždy
  pomerovo veľmi plochý. Pergola nezmenená (referenčný vzor z tela ticketu).
- RED→GREEN: `tests/kompozicia.test.ts` (13 testov), `pohyblivePanely` prípady v
  `tests/zasklenia-navrh.test.ts`, nové `#168:`-prefixované e2e v
  `e2e/zasklenia-navrh.spec.ts`/`e2e/bazen-navrh.spec.ts`.
- Fresh-context deep-review subagent našiel 1× 🟡 (MIN_DIM_FONT deklarovaný, ale
  nezapojený do 4 kót — opravené v `39af47d`, adjacent-finding-in-touched-file,
  #311 same-branch-fix).
- Commity: `178f27c`(bump 0.17.4-dev.1) → `2dabf7a`(feat kompozícia) →
  `2cca8a0`(bump 0.17.4 pred mergom) → `39af47d`(review fix MIN_DIM_FONT).
- PR #188 (dev→main), merge `cc46d41`. main CI (incl. deploy) zelené. Nasadená
  verzia `0.17.4 (cc46d41)`.
- Post-deploy Playwright overenie na `app.montalu.cloud` (marek, LIVE): pergola
  (nezmenená, stále dobre využitá), zasklenia (Robust 3K 4200×2100 P-L — veľký
  čitateľný nadpis, vycentrovaná kresba, šípka na ľavom krídle), bazén (OP260055,
  RAL 9006 — malý REZ SEKCIOU box, väčší bokorys/pôdorys, sekcie zarovnané) —
  0 console errors (len benígne GL driver warning), verzia v pätičke sedí s
  deployom.

## #177 + #183 (jeden batch, 2026-08-13) — vizual testy + db.ts split

- **#177**: chýbajúce unit testy `src/lib/vizual/textury.ts` (0 testov predtým)
  + zvyšné netestované `scena.ts` exporty. `tests/vizual-scena.test.ts` (#174)
  medzičasom pokryla `vytvorZem`/`vytvorStenu`/`vytvorKontaktnyTien` — scope
  zúžený, žiadna duplicita. Nové súbory: `tests/vizual-textury.test.ts` (canvas
  rozmery/colorSpace, deterministický výstup cez `vi.spyOn(Math,'random')`
  pre dlažbu/stenu, presné gradient/radial-gradient parametre — regresný test
  proti staršiemu jadroR/rozlisenie fraction nálezu), `tests/vizual-scena-svetla.test.ts`
  (`vytvorSvetla` — FIXNÉ NAVŽDY §2.6 azimut/elevácia/vzdialenosť nezávisle
  prepočítané, nie re-importované; `vytvorOblohu`; `disposeVsetko` dispose-
  registry completeness vrátane regresie na "jedna zhodená výnimka nezabráni
  disposu zvyšku"). Žiadny production kód sa nemenil.
- **#183**: `src/lib/server/db.ts` (986 riadkov, `migrate()` sama 679) sa blížil
  k 1000-riadkovému stropu. Presunuté do nového `src/lib/server/migracie.ts`
  (795 riadkov): `migrate(db, hashPassword)` berie oboje ako PARAMETRE (nie
  import z `./db`) — žiadny cyklický import. `db.ts` (209 riadkov) zostal len
  pripojenie + `hashPassword`/`verifyPassword` + query API. Nulová zmena
  správania — overené fresh-context review agentom byte-for-byte normalizovaným
  diffom (prázdny) + celou sadou 14+ migračných testov.
- Fresh-context deep-review subagent (jeden pass pre oba tikety): 0 🔴 0 🟡 0 🔵.
  Nezávisle prepočítal viacero deterministických assertion (dlažba/stena
  matematika, svetlá trig), nezávisle overil `.image`/`needsUpdate` proti
  reálnemu three.js zdroju, nezávisle spustil celú sadu (95/1223 zelené),
  lint, svelte-check.
- **Nájdený a nahlásený airuleset bug** (samostatný ticket, `zbynekdrlik/airuleset#436`):
  `hooks/post-record-design-comment.sh` nepíše design/validated/reviewed
  marker pre workera dispatchnutého do INÉHO repozitára než je jeho session
  cwd (cross-repo dispatch) — používa surové `cwd` z payloadu namiesto
  `resolve_work_cwd(cmd, cwd)`-štýlového rozpoznania inline `cd <path> &&`
  prefixu, ktoré `block-commit-without-design.sh` už má. Workaround v TOMTO
  behu: markery zapísané priamo cez `design_gate.write_marker()` s overenou
  evidenciou (komentár už klasifikoval `ok`, len marker sa nezapísal).
- Commity: `f086ffb`(bump 0.17.6-dev.1) → `de4b074`(test #177) →
  `6075936`(refactor #183 db.ts split) → `b0a1ac4`(bump 0.17.6 pred mergom).
- PR #190 (dev→main), merge `b107173`. main CI (test/build/E2E/deploy) zelené.
  Nasadená verzia `0.17.6 (b107173)`.
- Post-deploy overenie na `app.montalu.cloud` (LIVE): `/health` `{"ok":true,
  "version":"0.17.6 (b107173)","live":true}`, Playwright DOM footer
  `v0.17.6 (b107173)` sedí, 0 console errors/warnings. Žiadna user-viditeľná
  zmena v tomto batchi (test coverage + interný refaktor) — potvrdené, nie
  vymyslené.

## 2026-08-13 — Pergola z rozmerov: technický výkres (vzor OP260032) (#194)

- **Issue:** #194 (part of #155 epic), engine base = #193 (PergolaNarezVstup / schemaVykresu na `pergola-narez.ts`).
- **Commits:** 42fe048 (bump 0.19.0-dev.1) -> ed5c4f2 (feat výkres) -> c2d2684 (bump 0.19.0) -> 2bb10b6 (docs rule) -> 0d8d5b0 (review fixes). PR #200, merge 38c74f6.
- **Čo:** `schemaVykresu(v)` čistá geometria (engine) + `PergolaNarezVykres.svelte` (predný pohľad + bokorys + pôdorys) na zdieľanom `$lib/vykres` (VykresovyHarok+Kota+kompozicia sharedFitScale/fitCentered). Krov = zjednodušený obrys + poznámka na krov-ticket #161, nikdy hádaná geometria. Display-only, money-safety guard rozšírený, route-scoped landscape tlač.
- **Testy:** +8 geometria unit (2215, [0,1920,3840,5760], 2760, priečky <=700 invariant @20000) v `pergola-narez.test.ts`; +2 E2E (`e2e/pergola-narez.spec.ts`, console-zero); 1276 unit + 7 E2E zelené.
- **Review:** adversariálny 0 R 2 Y 3 B -> Y/B opravené v 0d8d5b0 (čestná mierka zahŕňa vyskaZadna, stale komentár, obrysStroke dvojité *0.5, podFit komentár); font-literál ponechaný (sesterský precedens).
- **Nasadené:** 0.19.0 (38c74f6), overené naživo app.montalu.cloud/pergola/narez (DOM verzia + 3 pohľady + kóty + krov-poznámka).
- **Playbook:** `.claude/rules/pergola-narez.md` (2x „light", krov-ticket, len potvrdené vzorce, spec do spodného riadku).

## 2026-08-14 — Pergola: verifikácia enginu proti historickým zákazkám (#196)

- **Issue:** #196 (part of #155 epic), GATE pred #197 (napojenie na Money odpis). Engine = #193.
- **Commit:** 145d4c0 (harness `tests/pergola-narez-historicka-verifikacia.test.ts` + doc komentár na `sirka`). Žiadny formula fix — engine chybu nemá.
- **Dáta:** z 39 historických pergol majú surový CAD po kusoch len 2 (ZAK202694/OP260086, ZAK2026302/OP260258) + ich VYROBA výkresy (jediné rozmery). Zdroj: `montalu/n8n/cad2dlv/server-sync/ODPIS VZOR/*.xlsx` list PERGOLY + `*.pdf`. 37/39 = len agregované metre bez rozmerov.
- **Overené 1:1 (obe zákazky, Robust/na stenu):** predná noha = svetlosť+15 (2150→2165, 2200→2215; svetlosť je kóta na výkrese), systém→kód stĺpu/žľabu (18013/18021), priečka kód+počet (18004/18102, ceil(šírka/700)+1), metráž jednotka. 11 GREEN asertácií.
- **Zistenie 1 (dôležité pre #197):** engine `sirka` = šírka RÁMU (poľa krokiev), NIE dĺžka žľabu — žľab presahuje rám (~318/558 mm/str.). Žľab→10/15 priečok, rám→9/13 (reálne). #197 musí posielať šírku rámu. Zafixované v teste + doc komentári.
- **Zistenie 2:** ZAK2026302 mal reálny rozostup 721.7 > 700 (tvrdý strop enginu) → engine by mohol nadrátať priečku. Otázka na Dominika → #198.
- **Neoverené (v histórii chýba vzor, čestne zapísané):** zadná noha (žiadna samostatne stojaca), výstuha −280 (žiaden zosilnený nosník), dĺžky rezov (O1). Komponenty #195, krov #161 = očakávané medzery.
- **Bez PR-do-Money / bez deploy user-zmeny** (test + docs). Otvorené otázky zapísané na #198, verifikačný záver + tabuľka na #196. #196 uzavretý (#155 zostáva otvorený).

## #161 — Pergola krov: geometria uloženia (prah 7°) — POTVRDENÝ prírastok (2026-08-14, v0.19.2)
- **Zdroj:** analýza nahrávky callu 13.8. (komentár na #161). Prvá oprava zadania: TANGENS, nie sínus. SE tabuľka scr_030: `uhol2=IF(UHOL<=7,0,1)`, `uhol3=UHOL−7`, `ls=ps=tan(uhol3)·c+0,01` (c=29), `lv=pv=tan(uhol3)·cc+0,01` (cc=37,28).
- **Nový pure engine `src/lib/pergola-krov.ts`** — `krovUlozenie(sklon)`. Číselný vektor 8° (uhol3=1): ps=ls=tan(1°)·29+0,01=0,516→**0,52**, lv=pv=tan(1°)·37,28+0,01=0,661→**0,66** (presne tabuľka). Dekódovaný trojuholník 0,52–29–0,01 = (ps, c, konštanta) pri 8°.
- **Prah 7°:** `=7°` → rovnobežne (offsety = konštanta 0,01); `>7°` → otvara (dva dotyky + previs); `<7°` → **nepodporované** (O5 prehodenie bodu dotyku, lv/ps by vyšli záporné); nezadané → nezadane; `≥9–10°` pridá poznámku o zatváraní drážky (frézovací detail O5), offsety ostávajú z potvrdeného vzorca.
- **Vstup:** voliteľný `sklonStrechy?` do `PergolaNarezVstup` (NIE odvodený z výšok/hĺbky — vzťah nepotvrdený; SE má `uhol` oddelene). Parser prázdne→null, validácia 0<sklon≤60 len keď zadané.
- **Výkres:** keď sklon ≥7° → krov-note detail (režim, c/cc, ps=ls/lv=pv + schematický trojuholník „nie v mierke") + ponechaná poznámka „frézovanie drážok → #161". Bez sklonu / <7° → súčasný placeholder → #161 (bez regresu). Route karta „Krov — uloženie".
- **Testy:** RED→GREEN vektory `tests/pergola-krov.test.ts` (15), parser `tests/pergola-narez-vstup.test.ts` (+4), E2E `e2e/pergola-narez.spec.ts` (+2: 8° detail, 5° nepodporované). money-safety SUBORY += pergola-krov.ts.
- **#161 OSTÁVA OTVORENÝ** — frézovanie drážok (výrobný list, O5), vetva <7° (O5), priradenie odvesny c/cc (O5), jednotka 0,01 (O5b), metrický prepočet (O14). Dodaný LEN potvrdený prírastok. Display-only, žiaden Money zápis.

## #206 — Pergola formulár: 5 nových volieb z výkresu OP260282 (2026-08-14)

PR #209 (dev→main), merge `142ab059`, release **v0.19.5 (142ab05)**, nasadené + naživo overené
(app.montalu.cloud/pergola/narez). Commity: `35fed22` (feat), `46aab4e` (review fixes),
`4221e83` (release). Display/engine-only, žiadne Money wiring; golden OP260282 + money-safety
nedotknuté.

- **(a)** checkbox „jednoduchá pergola bez zasklenia" → vypína bočné 110×43 (engine drop + poznámka).
- **(b)** POTVRDENÉ: NIE-SS (u steny) bočný 110×43 pod kotviacim = **ZV − 190**, 2 ks (18016),
  do vypocitane; SS/bez-zasklenia → riadok sa neemituje. ZV validovaná aj pri stena+zasklená.
- **(c)** profil výstuhy: **200×140 → efektívna svetlosť −60** (preteká do prednej nohy sv+15,
  Massive-gate); výstuha horná odzrkadľuje kód 18022. Robust 110×110/110×250 = honest-null (poznámka).
- **(d)** ZVOD frézovanie: toggle + výška SH — evidencia na výkrese (detail → #161).
- **(e)** sklá: strecha sklo + obvodové zasklenie — informatívne polia (žiadny Zasklenia engine).
- **Testy:** +22 unit/parser vektorov (`pergola-narez.test.ts`/`-vstup.test.ts`) + 4 e2e (a/b/c/d/e).
  Kódy 18016/18022/18014 = KÓPIA z katalógu `server/pergola.ts`, nie import.
- **Review (fresh Opus 4.8):** 0 🔴 2 🟡 6 🔵 — všetko fixnuté v branchi (viď komentár na #206).
- **Gap → #198:** či −60 pri 200×140 mení reálnu dĺžku nohy alebo len svetlú výšku (kompozícia
  potvrdených pravidiel, display-only).
- **#155 (epic) OSTÁVA OTVORENÝ.**

## #195 — Pergola: komponenty (spojky, krytky) do nárezu (2026-08-16)

- **PR #210** (merge 2a62b34), nasadené **v0.19.6**, deploy verified (/health live:true,
  DOM v0.19.6 (2a62b34)).
- **Engine:** nová `komponentyPergoly(v)` + katalóg `PERGOLA_KOMPONENTY` v `pergola-narez.ts`
  — SAMOSTATNÁ funkcia (golden `pergola-narez-op260282` + `NarezVysledok` bit-identické).
- **Honest-null aj na komponenty:** počet ks = „—" pre všetky typy (žiadne pravidlo),
  jednorazové pozorovanie (spojka U 12 ks / rámová 2 ks) len v poznámke; žiadny ZASK*
  Money kód (CAD kódy 24007/24003 informatívne, 2400? sa nedopĺňa). User (16.8.): „len typy".
- **RED→GREEN:** `tests/pergola-narez-komponenty.test.ts` (11) e10799d→b6903da; E2E Massive+Robust.
- **Review (fresh Opus 4.8):** 0 🔴 0 🟡 4 🔵 — všetky 4 fixnuté v branchi (493c383).
- **Live overené:** Massive 5 typov (počty „—", CAD 24007/24003), Robust 2 typy (per-systém filter).
- **#155 (epic) OSTÁVA OTVORENÝ.**
