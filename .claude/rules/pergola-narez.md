---
paths:
  - 'src/lib/pergola-narez.ts'
  - 'src/lib/pergola-krov.ts'
  - 'src/lib/server/pergola-narez-vstup.ts'
  - 'src/lib/components/PergolaNarezVykres.svelte'
  - 'src/routes/pergola/narez/**'
  - 'tests/pergola-narez*.test.ts'
  - 'tests/pergola-krov*.test.ts'
  - 'e2e/pergola-narez.spec.ts'
---

# Pergola — nárez/výkres z rozmerov (#155 epic) — gotchy a disciplína

Modul `/pergola/narez` generuje z rozmerov **materiál (nárez)** (#193) aj **technický
výkres** (#194). Zdroj pravidiel = analýza callu s Dominikom 13.8.2026 (komentár na
#155 „Analýza nahrávky callu"). Toto je zberná playbook stránka pre celý pergolový
nárez/výkres — načítaj ju PRED úpravou ktoréhokoľvek `pergola-narez*` súboru.

## „len POTVRDENÉ vzorce" — najdôležitejšia disciplína (Money-priľahlé)

Nárez GENERUJE vstup Money odpisu (#197 ho neskôr napojí). Preto engine aj výkres
kreslia/počítajú **iba to, čo call POTVRDIL**; všetko ostatné je explicitne „zatiaľ
nepodporované" (engine) alebo čestný poznámkový box (výkres) — **NIKDY sa nehádže
neoverený vzorec**. Potvrdené (s citáciami t=… v engine hlavičke): predná noha =
svetlosť + 15; zadná noha (LEN samostatne stojaca) = výška zadná − horný profil
(110/140, NIE systém); počet priečok = ceil(šírka/700)+1; systém → stĺp+žľab; priečka
kód 18004/18102. Neoverené a preto NEIMPLEMENTOVANÉ: krov (#161), dĺžky líšt/žľabu
(O1), výstuha profil (O2/O3), sklá (O11), spád/kliny (patria k zaskleniu, nie k
nohám). Overovací vektor: ZAK2026302 = 4× predná noha 2215 pri svetlosti 2200.

## POZOR — DVE rôzne veci sa volajú „light", NEZAMIEŇAŤ

1. **Priečka „light" (18102) vs „normal" (18004)** — manuálny checkbox v engine,
   volí Money KÓD priečky. Zdroj = **ťažba Money histórie** (17/17 zákaziek), NIE
   call. Toto JE v engine (`prieckaLight`).
2. **Krov „light / vystužený"** — INÝ vstup z callu (t=225–252s), bez odvodzovacieho
   vzorca (indície: výsuv, letky, stredová podpora). Patrí do **#161**, v tomto
   engine NIE JE. Nepridávaj ho sem — nemá pravidlo.

Miešanie týchto dvoch je ľahká chyba (obe sú „light"). Priečka-light je Money kód
tu; krov-light je konštrukcia inde (#161).

## Krov = uloženie (prah 7°) POTVRDENÉ (#161), frézovanie STÁLE poznámka → #161

Call 13.8. dodal SE vzorce prahu 7° → potvrdená časť #161 je implementovaná v
**`src/lib/pergola-krov.ts`** (`krovUlozenie(sklon)`), frézovanie výrobného listu
ostáva otvorené. Disciplína „len POTVRDENÉ" platí BEZ zmeny:

- **Engine `pergola-krov.ts`** počíta LEN vzorce z tabuľky scr_030 (POZOR: TANGENS,
  nie sínus): `uhol2=IF(UHOL<=7,0,1)`, `uhol3=UHOL−7`, `ls=ps=tan(uhol3)·c+0,01`
  (c=29), `lv=pv=tan(uhol3)·cc+0,01` (cc=37,28). Číselný vektor: 8° → ps=ls=0,52,
  lv=pv=0,66. `< 7°` = „nepodporované" (O5 „prehodenie" bodu dotyku), nezadané =
  „nezadane", `≥ 9–10°` pridá poznámku o zatváraní drážky (frézovací detail O5),
  ale offsety ostávajú. NIKDY sa nehádže: pod-7° vetva, priradenie odvesny c/cc
  prednej/zadnej hrane (O5), jednotka 0,01 (O5b), metrický prepočet (O14).
- **Sklon strechy je SAMOSTATNÝ voliteľný vstup** (`sklonStrechy?`), NIE odvodený z
  výšok/hĺbky — ten vzťah call nepotvrdil (SE má `uhol` oddelene od `výšok`).
  Neodvodzuj sklon zo strechy medzi výškami — to by bol vymyslený rozmer.
- **Výkres `PergolaNarezVykres.svelte`**: keď je sklon zadaný a ≥ 7° → krov-note box
  vykreslí **uloženie detail** (režim prahu 7°, c=29/cc=37,28, ps=ls/lv=pv +
  schematický trojuholník „nie v mierke") + ponechá „frézovanie drážok … → #161".
  Keď sklon nezadaný alebo < 7° → SÚČASNÝ čestný placeholder „→ #161" (bez regresu,
  E2E bez sklonu ostávajú zelené). Bokorys strechu stále kreslí len ako zjednodušený
  PRERUŠOVANÝ obrys medzi výškami (samostatne stojaca) — sklon NElabeluje z uhla
  (vzťah uhol↔výšky nepotvrdený), len inline poznámka odkáže na uloženie detail.
- Schematický trojuholník je zámerne NIE v mierke (uloženie je sub-mm vs 29 mm
  odvesna) — všetky KÓTY sú potvrdené, len proporcia je schéma; to nie je vymyslený
  rozmer.

## Výkres stojí na zdieľanom `$lib/vykres` základe — NIKDY vlastný `<svg>`/mierka

`PergolaNarezVykres.svelte` = `VykresovyHarok` + `Kota` + `kompozicia.ts`. Platia
VŠETKY gotchy z `.claude/rules/vykres.md` (obrysStroke guard proti zhltnutiu fill,
`sharedFitScale`+`centerAt` namiesto fixného `baseY`, font-floors, outer-`<g>` vs
inner testid, clipPath pri texte vedľa pečiatky). Špecificky pre tento výkres:
- **predný pohľad + pôdorys ZDIEĽAJÚ šírkovú mierku a `x0`** (`sharedFitScale` +
  override `podFit.x0 = feFit.x0`) — nohy musia sedieť pod sebou. Bokorys má vlastnú
  os (hĺbka), preto vlastný `fitCentered`.
- **spec text patrí do samostatného SPODNÉHO riadku VĽAVO od pečiatky** (šírka
  `tbX − 2 − oblast.x`), NIE do pravého stĺpca nad pečiatku — inak ho pečiatka
  (92×50) squeezne na ~4 mm a zobrazí sa len prvý riadok (overené vizuálne #194).

## O-otázky, ktoré modul spresnia/odblokujú → #198

Zberný ticket **#198** drží O1–O17 (okrem O16 = ROZHODNUTÉ: výkres AJ materiál).
Odpovede z neho postupne odblokujú: dĺžky rezov líšt/žľabu (O1 kótovaný výkres),
výstuha profil (O2/O3), strop 700 pre krov (O4), sklá (O11), pozície zvodov (O12).
Kým O nie sú zodpovedané, príslušný prvok ostáva „nepodporované"/poznámka — pozri
#198 pred pridávaním nového vzorca.

## `sirka` = šírka RÁMU (poľa krokiev), NIE dĺžka žľabu — verifikácia #196

Overenie proti reálnym zákazkám ZAK202694/ZAK2026302 (`tests/pergola-narez-historicka-verifikacia.test.ts`)
ukázalo: vzorec počtu priečok `ceil(šírka/700)+1` sedí na realitu LEN keď `sirka` =
šírka **rámu** (pole krokiev), NIE celková dĺžka žľabu. Žľab presahuje rám na obe strany
(ZAK202694 žľab 5930 vs rám 5293.9; ZAK2026302 žľab 9120 vs rám ~8004). Keby sa do enginu
posunula dĺžka žľabu, počet priečok by bol o ~2 vyšší. **#197 (napojenie na Money) musí
posielať šírku rámu**; vzťah žľab = rám + 2×presah je O1-blokovaný (#198). Predná noha
(svetlosť+15) a systém→kódy (18013/18021, 18004/18102) sú overené 1:1; zadná noha a výstuha
−280 v histórii NEMAJÚ vzor (obe surovo-CAD zákazky sú na stenu, bez zosilneného nosníka) —
nezapínať do Money bez ďalšieho overenia.

## Money-safety je STATICKY strážená

Engine, parser, route AJ výkresová komponenta NEimportujú `server/money`/
`server/pergola`/`server/db` — `tests/pergola-narez-money-safety.test.ts` to skenuje
(zoznam `SUBORY`). Nová súčasť modulu → pridaj ju do `SUBORY`. Žiadny golden
snapshot, žiadny zápis do dlv-import.
