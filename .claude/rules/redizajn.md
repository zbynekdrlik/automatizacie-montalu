---
paths:
  - "src/app.css"
  - "src/routes/+layout.svelte"
  - "src/routes/login/+page.svelte"
---

# Celoplošný vizuálny redizajn (#376) — `--m-*` tokeny, stage rollout, pasce

Design smer (paleta, typografia, architektúra, celý rollout plán) je zapísaný
ako owner design komentár na #376 — pred ďalším stage vždy prečítať odtiaľ, tu
sú len IMPLEMENTAČNÉ gotchas z už dokončených stage.

## Stage 1 (Fundament) DOKONČENÝ — `--m-*` tokeny v `src/app.css :root`

Paleta: `--m-bg/--m-surface/--m-surface-2/--m-line/--m-line-2/--m-ink/--m-ink-2/
--m-ink-2-hover/--m-muted/--m-accent/--m-accent-ink/--m-accent-soft` + sémantické
`--m-ok/--m-warn/--m-danger/--m-manual` (+`-bg` varianty) + alert-box `--m-err-*/
--m-warnbox-*/--m-okbox-*` + rádiusy `--m-radius/--m-radius-sm/--m-radius-btn/
--m-radius-pill` + písma `--m-font-display` (Archivo Variable) / `--m-font-body`
(Inter Variable) / `--m-font-mono`. Súrodenec `--k-*` z `konfigurator/+layout.svelte`
— **NIKDY sa nemiešajú** (`--k-*` ostáva scoped na `.konf-app`, `--m-*` je na
globálnom `:root`).

**Dva tokeny majú DVA levely zámerne — text vs. non-text kontrast (WCAG AA):**
- `--m-accent` (3.67:1) = LEN pre non-text (underline, border, focus ring — 3:1 stačí).
  `--m-accent-ink` (~5.9:1) = pre TEXT (`.sec` eyebrow a čokoľvek podobné).
- `--m-line` (1.27:1) = jemné card/table hairline oddelenie. `--m-line-2` (`--k-line-2`
  vzor, 1.49:1) = input/select border, kde potrebuješ viditeľnú afordanciu poľa.
Nikdy nepoužiť `--m-accent`/`--m-line` tam, kde patrí `-ink`/`-2` variant.

## PASCA: bare `h1`/`nav`/… selektor v `app.css` LEAKUJE na login aj konfigurátor

`app.css` je importované GLOBÁLNE (cez root `+layout.svelte`) — platí pre
`/login` aj `/konfigurator`, hoci obe majú VLASTNÝ, nezávislý dizajnový jazyk.
Predtým bol globálny `h1` bez `color`/`font-family` — login aj interná appka sa
naň spoliehali INAK (login dedil `.panel`'s svetlú farbu na tmavom pozadí,
interná appka nemala žiadny explicitný akcent). Pridanie `h1 { color: var(--m-ink);
font-family: var(--m-font-display) }` bez scope zmenilo BEZ VAROVANIA:
- login wordmark (`.brand h1`, žiadna vlastná `color`) na `#16181c` na tmavom
  navy pozadí (kontrast ≈1.1:1, prakticky neviditeľné) — ŽIADNY E2E test nečíta
  farby, takže by to prešlo CI nepovšimnuté,
- `/konfigurator` hero nadpis (`.konf-hero-nadpis`, vlastná `color`/`weight`, ale
  žiadny `font-family`) na Archivo namiesto Inter.

**Fix vzor: scope internej appky štýl na `.wrap h1`** (`.wrap` obaľuje LEN interné
admin stránky vrátane chybovej stránky — root `+layout.svelte`'s `{:else}`
vetva), NIKDY bare `h1`/`nav`/`footer`/… element selektor, keď login alebo
konfigurátor majú/môžu mať rovnaký element s VLASTNÝM dizajnom. Rovnaká
disciplína platí pre AKÝKOĽVEK ďalší globálny element selektor pridávaný v
stage 2-4 — vždy over, či ho login/konfigurátor tiež renderujú, a ak áno, scop
na `.wrap` (alebo naopak `:not(.konf-app)`-štýl guard, podľa toho, čo je
čitateľnejšie).

## Fázovaný rollout — čo (ne)patrí do KTORÉHO PR

- **Stage 1 (hotovo):** tokeny, fonty, globálne primitívy (`.card .btn .badge
  table th td input select label nav.top footer.app .err .warn .okmsg .sec
  h1/.wrap h1 .sub`), header/nav, `.mono` utility (infra, zatiaľ aplikovaná len
  na verziu v pätičke), login 2× accent + zvyšné 3 modré miesta (`.vitaj`,
  focus, hover) — VŠETKO dokončené vrátane review nálezov.
- **Stage 2 (formulárové stránky):** zasklenia/pergola/bazen/fix/clip/sietka/
  optimalizator — field grid, checkbox riadky, emoji preč z LABELOV (nie len
  nav), sekčné eyebrows. TU sa prvý raz plošne adoptuje `.mono` na
  rozmery/kódy/ceny v týchto formulároch.
- **Stage 3 (história + tabuľky):** `/odpisy` (akčné tlačidlá jednej rodiny,
  badge), dopyty, používatelia, problém, vzorce/nastavenia. TU sa `table`/`td`
  štruktúrne prerába (stage 1 nechalo `table`/`td` farebne tokenizované, ale
  ŽIADNU štruktúrnu zmenu — bezpečné pokračovať).
- **Stage 4 (výsledky + výkresy):** nárezové plány, náhľady (ink-on-paper +
  bronzové kóty), CTA stack, print audit. `.g/.row/.ral-val/.poznamka-*/.kov-*/
  .posuv-*/table.narez/@media print` boli VEDOME nedotknuté v stage 1-3 — tu sa
  prerábajú prvý raz.

## Playwright MCP screenshoty pri visuálnej verifikácii z worktree

Viď `.claude/rules/testing.md` „Playwright MCP browser_take_screenshot píše LEN
do allowed roots AKTUÁLNEJ session" — v tomto repe (worktree-isolated worker)
sa screenshot uložil do ZDIEĽANÉHO hlavného checkoutu (`automatizacie-montalu/`),
nie do worktree. `cp` von funguje (read zo shared tree je OK), ale `rm` toho
súboru v shared checkoute je worktree-write-guardom BLOKOVANÝ (`block-foreign-
airuleset-write.sh`) — stray `.png` v hlavnom checkoute sa necháva byť
(untracked, neprekáža mergu).
