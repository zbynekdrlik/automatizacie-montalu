---
paths:
  - 'src/lib/pergola-narez.ts'
  - 'src/lib/server/pergola-narez-vstup.ts'
  - 'src/lib/components/PergolaNarezVykres.svelte'
  - 'src/routes/pergola/narez/**'
  - 'tests/pergola-narez*.test.ts'
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

## Krov vo výkrese = LEN zjednodušený obrys + poznámka → #161

`PergolaNarezVykres.svelte` NIKDY nekreslí krovovú geometriu (sklon 7°, rozostup
krovov, frézovanie drážok) — tá je #161 a O4/O5/O6 blokovaná. Kreslí:
- **bokorys**: strecha = zjednodušený PRERUŠOVANÝ obrys medzi potvrdenými výškami
  (predná svetlosť vpravo/nižšie, zadná výška vľavo/vyššie) — LEN pri samostatne
  stojacej (na stenu je výška uloženia na stenu nepotvrdená → strecha sa NEKRESLÍ,
  len poznámka).
- **rezervovaný box „KROV / STRECHA — doplní konštruktér → #161"** (dashed, vzor
  bazén `rezSekciou`).
Keď #161 dodá krovovú geometriu, nahradí sa poznámka skutočným rezom — dovtedy je
čestný placeholder povinný (nikdy vymyslený sklon).

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

## Money-safety je STATICKY strážená

Engine, parser, route AJ výkresová komponenta NEimportujú `server/money`/
`server/pergola`/`server/db` — `tests/pergola-narez-money-safety.test.ts` to skenuje
(zoznam `SUBORY`). Nová súčasť modulu → pridaj ju do `SUBORY`. Žiadny golden
snapshot, žiadny zápis do dlv-import.
