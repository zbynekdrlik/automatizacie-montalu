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
svetlosť + 15; **zadná noha (LEN samostatne stojaca) = PLNÁ ZV** (#205, výkres OP260282 —
call síce citoval „ZV − horný profil", ale reálny výkres uvádza plnú ZV = dĺžka nohy;
`hornyProfilZadnej` UŽ neurčuje dĺžku nohy, po novom diskriminuje kaskádu 110×43 „pod
fixom" — na potvrdenie Dominikovi); počet priečok = ceil(šírka/700)+1; systém → stĺp+žľab;
priečka kód 18004/18102. Neoverené a preto NEIMPLEMENTOVANÉ: krov (#161), dĺžky líšt/žľabu
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

**Bin-packing (výdaj tyčí) — REPLIKUJ, NEIMPORTUJ (#205).** Algoritmus výdaja tyčí žije v
`$lib/server/pergola.ts` (Money odpisová cesta, katalóg tyčí 7500/6000/4500 mm), ktorú
money-safety guard ZAKAZUJE importovať. Preto je v `pergola-narez.ts` čistá funkcia
`pocetTyci(dlzka, ks, tycMm) = ceil(ks / floor(tyc/dlzka))` (null keď kus > tyč) — vzor sa
kopíruje, neimportuje. Tyče: 7,5 m default; žľab (18018/18021) + kotviaci (18019) na 6 m.

## Výkres OP260282 (O1 čiastočne odblokoval) — čo je POTVRDENÉ a čo ostáva NULL (#205/#207)

Kótovaný výkres OP260282 (PERGOLA MASSIVE 140 SS, Odoo správa 1691126) je prvý zdroj s
Plánom rezov 1:1. Golden vektor: `tests/pergola-narez-op260282.test.ts` (šírka 4990, hĺbka
3470, ZV 2790, sklon 6,1°, Massive 140 SS, výstuha 140×140). **NEROZŠIRUJ nad tento zoznam
bez ďalšieho potvrdenia — zvyšok si na výkrese PROTIREČÍ, nefituj nasilu:**

- **POTVRDENÉ (vo `vypocitane[]`, golden asertuje presne):** žľab (18018/18021) = šírka;
  kotviaci (18019) = šírka; zadná konštr. horná (18013, LEN SS) = šírka; výstuha horná
  (18017, LEN massive+zosilnenyNosnik) = šírka − 280. + výdaj tyčí.
- **NULL (nikdy sa nehádže):** `HH krovu` (3240.9) NIE JE vzorec zo vstupov — je to CAD
  výsledok geometrie krovu (#161, `pergola-krov.ts` počíta uloženie, NIE dĺžku HH). Preto
  priečka dĺžka (= HH krovu) a prítlačná/maskovacie (18006/18007/18008 = HH krovu + 40)
  ostávajú čestný null (#161/#198). Robust prítlačná HH krovu + 39 = NEPOTVRDENÉ (O18).
- **Počet priečok:** engine `ceil(šírka/700)+1 = 9`, výkres 8 (rám < žľab, presah O1/#196).
  Confirmed vzorec sa NEMENÍ; rozdiel je zdokumentovaný v `nepodporovane[]`.
- **#205 DORIEŠENÉ (dva z troch už POČÍTANÉ, jeden ostáva NULL):**
  - **110×43 „pod fixom" (18016) = hĺbka − (frontProfil + zadný prvok)** — TERAZ vo
    `vypocitane` (`podFixomOdpocet`): frontProfil = systém 110/140, zadný prvok = 43 (stena) /
    hornyProfilZadnej (SS). Reprodukuje 5 hodnôt poznámky výkresu (−153/−220/−183/−250/−280);
    „šírka" v poznámke = smer HĹBKY (4990−250 nezmysel; 3470−250=3220 presne). Gated `zasklena`.
  - **zadné nohy = PLNÁ ZV** (2790, nie ZV − horný profil) — TERAZ vo `vypocitane`; call citát
    ZV−profil prehodnotený v prospech reálneho výkresu (rozdiel = miesto merania ZV).
  - **Zvislá zadná výstuha (18017 zvislá, 2340) = STÁLE NULL** — 2340 = svetlosť 2325 + 15, ale
    2325 NIE je vstup (predná svetlosť 2200 → 2215). Formula položená Dominikovi (#198).

## Modré poznámky OP260282 (#206) — POTVRDENÉ vzorce sú TERAZ v engine

Výkres OP260282 mal 5 modrých poznámok (nové voľby); #206 ich pridal do formulára + enginu +
výkresu. **Dva sú POTVRDENÉ číselné vzorce — už NIE sú otvorené, sú vo `vypocitane`/`efektivnaSvetlost`:**

- **110×43 pod kotviacim (18016) = ZV − 190**, 2 ks, LEN pri NIE-SS (`uchytenie='stena'`) + zasklenej.
  `POD_KOTVIACI_110x43_ODPOCET`. Checkbox „jednoduchá bez zasklenia" (`jednoduchaBezZasklenia`) ho vypína.
- **výstuha 200×140 → efektívna svetlosť − 60** (`VYSTUHA_200x140_SVETLOST_ODPOCET`, Massive-gate),
  preteká do prednej nohy (svetlosť + 15) cez `efektivnaSvetlost()`. Výstuha horná odzrkadľuje kód 18022.
- **„2 pod fixom" 110×43 = POČÍTANÉ od #205** (`podFixomOdpocet`, hĺbka − kaskáda; VŠETKY konfigy,
  gated `zasklena`) — DVA riadky 18016 (pod fixom + pod kotviacim), preto `data-testid="polozka-18016"`
  NIE JE unikátny → v E2E filtruj názvom (`.filter({ hasText: 'pod kotviacim'/'pod fixom' })`).
- **honest-null (poznámka only):** Robust výstuhy 110×110/110×250 dĺžky nad −220. Gap #198: či
  −60 mení reálnu dĺžku nohy alebo len svetlú výšku.

**POZOR — `vyskaZadna` (ZV) je TERAZ load-bearing aj pri `stena`+zasklená** (nie len samostatne):
počíta bočný 110×43 a validuje sa (`chybaPergolaNarezVstupu`) pri `stena && !jednoduchaBezZasklenia`.
Neber ju ako samostatne-only.

**Vzor pre ĎALŠIE modré poznámky / OP-výkresy (zachovaj golden bit-identický):** nové polia na
`PergolaNarezVstup` dávaj VOLITEĽNÉ (`?`) — existujúce fixtúry (VZOR) aj golden `pergola-narez-op260282`
ostanú nezmenené. Nové vzorce nech sa uplatňujú na INÉ konfigurácie než golden (OP260282 = Massive/SS/
výstuha 140×140, zasklená): (b) je NIE-SS → SS golden ho nevidí; (c) −60 je 200×140 → 140×140 golden ho
nevidí. Kódy nových profilov (18016/18022/18014) = KÓPIA stringov z `server/pergola.ts` CODE_MAP, NIE
import (money-safety).

## Kusové komponenty (spojky, krytky) — #195, honest-null na POČTY aj KÓDY

Vrstva KUSOVÝCH komponentov (spojky, krytky, rámové/zakladacie lišty) žije v
`pergola-narez.ts` ako **samostatná** funkcia `komponentyPergoly(v)` + statický katalóg
`PERGOLA_KOMPONENTY` — ZÁMERNE NIE v `NarezVysledok`, aby golden `pergola-narez-op260282`
a `spocitajNarez` ostali bit-identické (vzor = `schemaVykresu`). Zdroj TYPOV = call 13.8.
(scr_014/015 Massive „KOMPONENTY Pergola 140"; scr_042 Robust „KOMPONENTY Pergola 110"/
expedícia) + výkres OP260282. User (16.8., #195): „len mi stačia tie typy" — nečakať na
Dominikove sľúbené tabuľky, dorobiť z TYPOV.

- **Honest-null sa vzťahuje aj na POČTY komponentov:** `pocetKs = null` („—") pre VŠETKY
  typy — pravidlo počtu neexistuje (Dominik komponenty neklasifikoval vždy/často). Jednorazové
  pozorovanie z JEDNÉHO výkresu (spojka U 12 ks, rámová lišta 2 ks na OP260282) ide LEN do
  `poznamka`, NIKDY do stĺpca počet. Keď reálne prídu tabuľky, doplní sa počet + pravidlo.
- **Money kód komponentu = LEN potvrdený ZASK* (kusové sú ks, ZASK; profily sú m, ZASP).**
  Žiaden ZASK* nie je v zdrojoch potvrdený → `kodCad` je len informatívny CAD kód zo Solid
  Edge (24007/24003), výslovne NIE Money odpisový kód; do odpisu (#197) nejde nič. Nečitateľná
  číslica (2400?) sa NIKDY nedopĺňa → `kodCad = null` + poznámka.
- **Systémová príslušnosť evidence-strict:** `systemy: PergolaSystem[]` per typ, filtrované
  `komponentyPergoly` podľa `v.system` (Massive 5, Robust 2). Nepridávaj typ systému, kde
  nie je zo zdroja doložený. Profily, ktoré engine už emituje (žľabový 110 = 18021 atď.), do
  komponentov NEDUPLIKUJ — sem patria LEN kusové položky navyše.
- **Testy:** unit `tests/pergola-narez-komponenty.test.ts` (honest-null, per-systém filter,
  no-shared-mutation guard); E2E v `pergola-narez.spec.ts` (Massive + Robust vetva,
  počet-bunka `data-testid="komponent-pocet"` = „—", console-zero).
