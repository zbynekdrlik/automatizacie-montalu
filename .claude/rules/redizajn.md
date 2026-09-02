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

## Stage 2 (Formulárové stránky) DOKONČENÝ (#376, 0.24.72)

Čo pribudlo do `app.css` a ako sa aplikuje na formulárových stránkach:

- **`.opt` / `.opt-grid` checkbox-riadok trieda** — nahradila 5× duplikovaný inline
  `style="display:flex;align-items:center;gap:8px;font-weight:400[;margin-top:26px]"`.
  `.opt` = flex riadok (prebíja globálny `label{display:block}`), `.opt-grid` = variant
  s `margin-top:26px` (checkbox v grid bunke, zarovná sa so susednými poľami). Nový
  checkbox riadok = `<label class="opt">` (alebo `class="opt opt-grid"` v grid bunke),
  žiadny inline štýl, žiadny inline `width:auto` na inpute.
- **`.wrap input[type=checkbox] { width:auto; accent-color: var(--m-accent) }`** —
  bronzové zaškrtnutie + zrušenie globálneho `input{width:100%}` roztiahnutia. **MUSÍ
  byť scoped na `.wrap`** (interná appka) — bare `input[type=checkbox]` presakuje na
  `/konfigurator` consent checkbox (`.suhlas input`, vlastný `--k-*` svet) — presne tá
  istá leak-pasca ako `h1` (nižšie). Preto sa inline `width:auto` z checkboxov smie
  zmazať LEN keď sú vnútri `.wrap` (všetky interné formuláre sú).
- **`--m-muted-ink` (#585d65)** = TRETÍ text/non-text token pár (po `--m-accent`/`-ink`).
  `--m-muted` (#6b7078) na `--m-accent-soft`/`--m-surface-2` padá WCAG AA 4.5:1 pre TEXT
  (4.29 / 4.49); `--m-muted-ink` (~5.7:1 na accent-soft, 6.6:1 na bielej) je text-safe.
  Používaj ho pre muted TEXT na tónovanom podklade (mode-karta popis/foot); `--m-muted`
  ostáva pre muted text na bielej/neutrále.
- **`.mode-*` prepínač tokenizovaný na `--m-*` bronz** (+ `.mode-grid.cols-2` modifikátor
  pre 2-kartové navy — Fix). Konsolidované z per-komponent scoped CSS (#394).
- **`.mono` adoptované** na článkové kódy `{o.kod}` v odpisových kartách
  (bazen/clip/pergola/fix-cad/zasklenia PlanKarty) — kód mono, názov body. Množstvá/ceny
  v result `.g`/`.row`/`<b>` ešte mono NEmajú (stage 3/4).

### E2E-coupling pasca pri zmene TEXTU labelu / tlačidla (KRITICKÉ pre stage 3/4)

Form input LABEL text je E2E KONTRAKT — testy cielia cez `page.getByLabel('<presný>')`,
`getByLabel(/regex/)`, `getByRole('button',{name:'<emoji>'})`, `getByText('<emoji>')`.
**PRED zmenou akéhokoľvek user-visible textu (odstránenie emoji, preformulovanie) GREPNI
`e2e/` na ten text:**

- **regex-matchovaný label** (`getByLabel(/Čaká na materiál/)`, `/Prídavná koľajnica/`) →
  strip emoji je SAFE (regex matchne aj bez prefixu).
- **id/name-targetovaný checkbox** (`#sietka-on`, `#klin-on`, `#fixZrkadlo`,
  `input[name="zrkadlo"]`, `#pergolaSFixom`, `#zvodFrezovat`) → label text nie je
  selektor, zmena SAFE.
- **exact-matchovaný label** (`getByLabel(FAB)` s `const FAB='🔑 …'`) → strip emoji ROZBIJE
  spec; ZOSYNCHRONIZUJ konštantu v spec súbore (v tomto PR `kovanie-odpis.spec.ts`).
- **NEDOTÝKAJ sa result/status odznakov ani akčných tlačidiel v stage 2** — `✅ v odpise`,
  `⏳ čaká`, `🧪 TEST`, history `⏳`, `✏️` (edited marker), `🖨 Tlačiť`, `➕ Pridať posuv` sú
  asertované ~10 spec-mi PRESNÝM textom AJ patria do stage 3/4 (result/CTA/print reštruktúra).
- `app.css` je ~891 r. (approaching 1000-strop) — split pred stage 3, viď
  `large-file-split.md` watch-list.

## Stage 3 (História + tabuľky) DOKONČENÝ (#376, 0.24.74)

Čo pribudlo do `app.css`/`print.css` a ako sa aplikuje na tabuľkových/histórie stránkach:

- **`@media print` blok presunutý do `src/print.css`** (app.css bol 891 r., blízko 1000-strop).
  Importuje sa v root `+layout.svelte` HNEĎ za `import '../app.css'` — kaskáda ostáva
  nezmenená (pravidlá byte-identické). app.css klesol na ~805 r.; stage-3 CSS ho zdvihlo
  na ~869 (stále pod stropom). Vzor pre ďalší rast: extrahuj tematický blok do vlastného
  `.css` importovaného za app.css.
- **Zebra + hover** pre výsledkové/histórie tabuľky = `.wrap table:not(.narez):not(.rezy)
  tbody tr:nth-child(even)` (zebra `--m-surface-2`) + `:hover` (`--m-accent-soft`). MUSÍ byť
  scoped na `.wrap` (leak-pasca nižšie — login/konfigurátor sú full-bleed BEZ `.wrap`).
- **`.mono` na kódy + čísla** vo výsledkových/histórie tabuľkách (kódy, ZAK/OP, rozmery/
  metre). Meno/popis ostáva body font — „kód/číslo mono, názov body" (kóta z výkresu).
- **`.tbl-akcie` + `.btn … sm` + `.btn.danger.outline`** = kompaktný rad outline akčných
  tlačidiel jednej rodiny (/odpisy). `.btn` je inak block/100%-width CTA; `.sm` (definované
  PO `.btn.secondary`) ho spraví `inline-flex; width:auto; border-width:1px`.

### PASCE stage 3 (každá stála čas / bola review nález)

- **`table.narez` NIE JE jediná stage-4 tabuľka — `RozpisRezov.svelte` je `<table class="rezy">`.**
  Globálne `.wrap table` pravidlo (zebra/hover) MUSÍ vylúčiť OBE: `:not(.narez):not(.rezy)`.
  `.rezy` je kompaktný TLAČOVÝ rozpis rezov (vlastný dizajn, renderovaný v zasklenia
  PlanKartách + optimalizátore, tiež pod `.wrap`) — `:not(.narez)` samotné ho nechá presiaknuť
  (review 🟡). Pred pridaním akéhokoľvek globálneho `.wrap table` pravidla vygrepni VŠETKY
  `<table class="…">` a vylúč každú stage-4/input tabuľku (`.narez`, `.rezy`; `.kusy`
  optimalizátor je input-only, zebra tam neškodí).
- **Tónované pozadie riadku (zebra/hover) ZHORŠUJE kontrast existujúceho muted textu pod WCAG
  AA** — presne tá istá pasca ako `--m-muted` na mode-karte v stage 2. Sivé texty `#6b7280`/
  `#64748b`, ktoré prešli na bielej, padnú pod 4.5:1 na `--m-surface-2`/`--m-accent-soft`. Fix:
  `var(--m-muted-ink)` (5.7:1) — zároveň „hexy → tokeny". Skontroluj VŠETKY muted texty vnútri
  tabuliek, ktoré dostávajú zebra/hover (`.hint`, `tr.drobna`, `mj` span, `.suhrn .lbl`).
- **`.hint` (a iné muted) môžu ODdediť `.mono`, ak je bunka `<td class="… mono">`** —
  monuj len samotné číslo (`<span class="mono">{n} {mj}</span>`), nie celú bunku s poznámkou.
- **`.akcie` je UŽ obsadené** 3 scoped komponentmi (optimalizator/vizual) — pre nový globálny
  akčný rad použi `.tbl-akcie`, nikdy `.akcie` (kolízia so scoped štýlmi).
- **Hover tlačidla musí ostať odlíšiteľný od hoveru RIADKU** — `.btn.secondary:hover` aj row
  hover boli `--m-accent-soft` → afordancia tlačidla splynula. Kompaktné secondary v tabuľke:
  `.btn.sm.secondary:hover { background:var(--m-surface); border-color:var(--m-accent) }`.
- **Zebra sa nesmie tlačiť** — pridaj do `print.css` `table tbody tr { background: transparent
  !important }` (inak sa even-row pozadie vytlačí, keď používateľ zapne „tlač pozadí").
- **E2E-bezpečnosť /odpisy akcií:** testy cielia tlačidlá cez ROLU+TEXT
  (`getByRole('button',{name:'Uvoľniť'})`, `getByRole('link',{name:/Použiť znova/})`) alebo
  TESTID (`povolit-reimport-`, `detail-`) — NIKDY cez triedu/DOM štruktúru. Wrapper `<div>` +
  zmena tried je bezpečná, kým `<a>` ostane link, `<button>` button, a text/testid sa nemení.

## Stage 4 (Výsledky + výkresy) DOKONČENÝ (#376, 0.24.76) — POSLEDNÝ stage

Čisto prezentačný re-skin posledných VEDOME nedotknutých plôch (výkresy/náhľady +
zdieľané výsledkové triedy). Nula zmeny geometrie/výpočtov/Money/`data-testid`.

- **Výkresové kóty modrá → bronz:** 4 návrhové/nárezové výkresy (`PergolaNavrhVykres`/
  `ZaskleniaNavrhVykres`/`BazenNavrhVykres`/`PergolaNarezVykres`) mali každý lokálny
  `const MODRA = '#1d4ed8'` použitý ako `color={…}` na ~30 `<Kota>` volaniach + zdieľaný
  `Kota.svelte` default. Premenované na `const BRONZ = '#8a5a2b'` (`--m-accent-ink`) + Kota
  default. **Prečo `#8a5a2b` a NIE `--m-accent` #b07a45:** `<Kota color>` farbí kótovú čiaru
  AJ číselný popisok, takže musí byť TEXT-safe (5.9:1) — `--m-accent` (3.67:1) padá WCAG AA
  pre text. Rename cez `replace_all` (svelte-check chytí missed ref; `.svelte` nie sú v
  stryker mutate scope). `#eff6ff` studená konštrukčná výplň → `#f4f3ef` (teplý papier
  `--m-surface-2`); RAL materiálové farby (`$lib/vykres/ral.ts`, `farebny ? farba.hex`)
  NEDOTKNUTÉ (sémantické produktové farby, nie chrome).
- **Ďalšie výkresové/route modré → ink/bronz/neutrál:** `TitleBlock` MIERKA, `Nahlad2D`
  sklo (neutrálna šeď `#e9edf0`) / sklo-rozmer + kaskáda (bronz) / sieťka (šeď),
  `FixVykres2D`, `RozpisRezov` (segment `#f5ede2`, `.seg-label` `--m-ink`), `vykresy/preview`,
  `optimalizator` CTA (`--m-ink-2`), `+error`/`pouzivatelia`/`ProfilObrazok`,
  `.polia-box`/`.fix-box`/`.sietka-box`.
- **Výsledkové `app.css` triedy hex → `--m-*`:** muted texty → `--m-muted-ink`,
  `.poznamka-plan`/`.posuv-hd` → `--m-ink-2`, `.ral-val` → `--m-ink` (+ mono, RAL=kód),
  bordery → `--m-line`, `.posuv-box` → `--m-surface-2`/`--m-line-2`, `.link-del`/`.b2b-blok`
  → `--m-danger`, `.b2b-upoz` → `--m-warn`.
- **CTA stack + print:** hierarchia „Odoslať do Money = plné antracitové `.btn`, tlač/späť
  `.btn.secondary`" bola UŽ splnená zo stage 1 (nič nové). Emoji na CTA (`🖨`/`✅`/`➕`) =
  samostatné #398, NEfoldovať sem. `@media print` (print.css) NEDOTKNUTÉ; re-skin je
  color-only → tlač ostáva ČB-safe (bronz `#8a5a2b` v ČB = čitateľná stredná šeď — over
  print-media screenshotom, nie len logikou).

### PASCE stage 4 (review nálezy)

- **Plošný `.row b`/`.g div b { mono }` cez SELEKTOR je ZLÝ — obe triedy sú ZMIEŠANÉ
  text/číslo.** `.g` súhrn: odpisy detail `.g` je metadátový (meno zákazníka/modul/systém/
  kto/režim/súbor = TEXT), sietka/PlanKarty `.g` číselné. `.row`: materiálové riadky majú
  číslo AJ text (poznámky, placeholdery „čaká na vzorec", mená kovania). Plošný mono monoval
  mená/poznámky A prenieslo by sa do tlačeného nárezového plánu. **Pravidlo: výsledkové čísla
  monuj PER-HODNOTU** (`class="mono"` na číselný `<b>`, stage-3 vzor „monuj len samotné
  číslo"), NIKDY plošným selektorom na `.row b`/`.g div b`. `.ral-val` mono je OK (kód). Plná
  per-hodnotová adopcia = #421.
- **SVG `<text>` kontrast sa počíta voči SKUTOČNÉMU `fill`-u pod ním, NIE voči bielej.**
  `Nahlad2D` sieťka label + index text sedia na `fill="#e2e8f0"` (sieťka rect), nie na
  papieri — `#64748b` tam padá na 3.86:1 (< AA 4.5:1). Fix: text `#585d65` (`--m-muted-ink`,
  5.38:1 na `#e2e8f0`); pattern line + rect STROKES ostávajú `#64748b` (non-text, 3:1 stačí).
  Pri zmene farby SVG textu vždy over kontrast voči jeho podkladovému `fill`.
- **`app.css` po stage 4 = 879 r.** — stále pod stropom, `nav.*` extrakcia
  (large-file-split.md watch) NEBOLA potrebná (tokenizácia je takmer line-neutrálna).

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
- **Stage 2 (formulárové stránky) — HOTOVO (0.24.72):** `.opt`/`.opt-grid` checkbox
  riadky + `.wrap input[type=checkbox]` bronzový accent, `.mode-*` na `--m-*` bronz,
  emoji preč z INPUT labelov, `.mono` na článkové kódy. Detail + pasce nižšie
  („## Stage 2 DOKONČENÝ").
- **Stage 3 (história + tabuľky) — HOTOVO (0.24.74):** zebra/hover (`.wrap
  table:not(.narez):not(.rezy)`), `.mono` kódy/čísla vo výsledkových+histórie
  tabuľkách, /odpisy akčná rodina (`.tbl-akcie`+`.btn … sm`+`.btn.danger.outline`),
  `@media print` split → `print.css`. Detail + pasce vyššie („## Stage 3 DOKONČENÝ").
- **Stage 4 (výsledky + výkresy) — HOTOVO (0.24.76):** modré kóty → bronz
  (`MODRA`→`BRONZ` `#8a5a2b`), `#eff6ff` → teplý papier, výsledkové triedy hex →
  `--m-*`, výkresové/route modré → ink/bronz/neutrál. CTA hierarchia už zo stage 1,
  print ČB-safe (color-only), emoji CTA = #398. Detail + pasce vyššie
  („## Stage 4 DOKONČENÝ"). ROLLOUT #376 KOMPLETNÝ.

## Playwright MCP screenshoty pri visuálnej verifikácii z worktree

Viď `.claude/rules/testing.md` „Playwright MCP browser_take_screenshot píše LEN
do allowed roots AKTUÁLNEJ session" — v tomto repe (worktree-isolated worker)
sa screenshot uložil do ZDIEĽANÉHO hlavného checkoutu (`automatizacie-montalu/`),
nie do worktree. `cp` von funguje (read zo shared tree je OK); `rm` toho súboru
v shared checkoute PREŠIEL bez problémov pri #392 (worktree-write-guard sa naň
nevzťahoval — `block-foreign-airuleset-write.sh` chráni len samotný airuleset
repo, nie hocijaký súbor v cudzom checkoute) — ak `rm` predsa raz zablokuje,
stray `.png` v hlavnom checkoute sa necháva byť (untracked, neprekáža mergu).

## Nav dropdown vzor (#392 — Moduly/Nástroje/user menu) — natívny `<details>`, pasce

Tri dropdowny v hornej lište (Moduly-pri-zúžení / Nástroje / user menu) stavajú na
natívnom `<details>/<summary>` (žiadna JS knižnica) — reuse tento vzor v ďalších stage,
ak pribudne ďalší dropdown/menu:

- **`<summary>` NIE JE `getByRole('button', …)` v tomto Chromium/Playwright behu**, hoci
  HTML-AAM ho mapuje na ARIA rolu "button" (naživo overené: dva e2e testy timeoutli na
  presne tomto). Cieľ vždy cez `data-testid` na `<summary>`, nikdy cez rolu.
- **Zdieľaná `{#snippet}` šablóna nad viacerými `$derived` poľami s `RouteId` hrefmi**
  typuj `typeof poleA | typeof poleB` (konkrétne premenné), NIKDY bare
  `{ href: RouteId; label: string }[]` — `resolve()`'s overloaded signatúra zlyhá proti
  celej `RouteId` únii (detaily + fix v `.claude/rules/lint-formatting.md`).
- **Light-dismiss (klik mimo / Escape) natívny `<details>` NEDÁVA zadarmo** — treba
  `<svelte:window onclick/onkeydown>` (~6 riadkov, žiadna knižnica); klik VNÚTRI
  `.nav-dropdown` sa musí vynechať (`e.target.closest('details.nav-dropdown')`), inak
  sa natívny toggle na `<summary>` a tvoj listener pobijú.
- **Zatváranie po SPA navigácii**: `afterNavigate` z `$app/navigation` (nie ručný
  `$effect` na `page.url.pathname`) — root layout sa pri route zmene neremountuje,
  takže `<details open>` by inak ostalo nastavené aj po kliku na odkaz vnútri.
- **`▾` glyf patrí do `<span aria-hidden="true">`**, nie priamo do textu triggera —
  inak si accessible name („Moduly ▾") nesie aj názov glyfu pre screen reader.
