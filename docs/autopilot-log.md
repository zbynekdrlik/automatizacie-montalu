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
