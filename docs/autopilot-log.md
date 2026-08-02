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
