# Autopilot log

Terse per-ticket log of autopilot/autonomous-worker runs: issue #, commits, tests, decisions, PR.

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
