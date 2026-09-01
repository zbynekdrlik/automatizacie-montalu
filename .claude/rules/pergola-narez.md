---
paths:
  - 'src/lib/pergola-narez.ts'
  - 'src/lib/pergola-krov.ts'
  - 'src/lib/server/pergola-narez-vstup.ts'
  - 'src/lib/components/PergolaNarezVykres.svelte'
  - 'src/lib/components/pergola/**'
  - 'src/lib/components/PergolaModeNav.svelte'
  - 'src/routes/pergola/+page.svelte'
  - 'src/routes/pergola/narez/**'
  - 'src/routes/pergola/navrh/**'
  - 'src/lib/server/pergola-rezervacia.ts'
  - 'tests/pergola-narez*.test.ts'
  - 'tests/pergola-rezervacia.test.ts'
  - 'tests/pergola-krov*.test.ts'
  - 'e2e/pergola-narez.spec.ts'
  - 'e2e/pergola-rezervacia.spec.ts'
  - 'e2e/pergola-uix.spec.ts'
---

# Pergola — nárez/výkres z rozmerov (#155 epic) — gotchy a disciplína

Modul `/pergola/narez` generuje z rozmerov **materiál (nárez)** (#193) aj **technický
výkres** (#194). Zdroj pravidiel = analýza callu s Dominikom 13.8.2026 (komentár na
#155 „Analýza nahrávky callu") + **Odoo Discuss kanál 207 („Vyroba automatizacia",
erp.montalu.cloud)** — Dominikove formulové odpovede ŽIJÚ tam a ticketové súhrny sú
STRATOVÉ: pred implementáciou vzorca čítaj VERBATIM správy cez XML-RPC read-only
(login `claude-handover-marek@montalu.local`, kľúč `~/.secrets/montalu-odoo-api-key`;
POZOR `execute_kw` berie UID z `authenticate()`, nie login string; `mail.message`
where `model='discuss.channel', res_id=207`; prílohy = `ir.attachment.read` →
base64 `datas`). NIKDY do Odoo nič neposielaj bez schválenia majiteľa. Toto je
zberná playbook stránka pre celý pergolový nárez/výkres — načítaj ju PRED úpravou
ktoréhokoľvek `pergola-narez*` súboru.

## „len POTVRDENÉ vzorce" — najdôležitejšia disciplína (Money-priľahlé)

Nárez GENERUJE vstup Money odpisu (#197 ho neskôr napojí). Preto engine aj výkres
kreslia/počítajú **iba to, čo call POTVRDIL**; všetko ostatné je explicitne „zatiaľ
nepodporované" (engine) alebo čestný poznámkový box (výkres) — **NIKDY sa nehádže
neoverený vzorec**. Potvrdené (s citáciami t=… v engine hlavičke): predná noha =
svetlosť + rozmer výstuhy (110/140/250) pri zosilnenom nosníku, inak svetlosť + 15 (#155 A9,
Dominik 1724498; `prednaNohaPridavok`/`prednaNohaDlzkaMm` — kľúč je `zosilnenyNosnik`, profil =
`vystuhaProfil` ?? systémový default; 200×140 odvodené = svetlosť+140); **zadná konštrukcia
(LEN samostatne stojaca) sleduje `hornyProfilZadnej`** (#316, Dominik 24.8. kanál 207 msg 1731730 —
rozriešil ZV-protirečenie výkresu OP260282 plná 2790 vs call ZV−profil v prospech callu):
**dĺžka zadnej nohy = ZV − horný profil** (110→ZV−110, 140→ZV−140; horizontálny profil sedí NA
nohách) a **kód nohy AJ „zadnej konštr. hornej" = `ZADNA_KONSTRUKCIA_PROFIL[hornyProfilZadnej]`**
(110→18013/110×110, 140→18017/140×140) → zadná konštrukcia jednotná by-construction, NEZÁVISLÁ od
`system` (OP260282 = Massive 140 systém so 110 zadnou). `hornyProfilZadnej` diskriminuje AJ kaskádu
110×43 „pod fixom" (podFixomOdpocet); počet priečok = ceil(šírka/700)+1; systém → stĺp+žľab;
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
  „nezadane". **A7 (25.8.): sklon `> 9°` = NEPODPOROVANÉ** (offsety null + poznámka;
  presne 9° ešte počíta s varovnou poznámkou) — otázka na pásmo „drážka sa zatvára,
  výška krovu sa dvíha" ostala v ch207 nezodpovedaná, extrapolácia sa NErobí a
  `krovDlzkaNominal` nad 9° vracia null tiež. Jednotka 0,01 = POTVRDENÁ mm (ch207
  msg 1724330 — „pomyslený trojuholník prehadzujúci rovinu bodu uloženia priečkového
  profilu 105"; bývalá O5b poznámka odstránená). NIKDY sa nehádže: pod-7° vetva,
  priradenie odvesny c/cc prednej/zadnej hrane (O5), metrický prepočet (O14).
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

## Money-safety je STATICKY strážená (zúžené #221)

**Od #221 už NIE JE route Money-clean** — route `/pergola/narez` legitímne posiela
rezervačný odpis (cez most, viď sekcia „Rezervačný odpis" nižšie). Guard
`tests/pergola-narez-money-safety.test.ts` stráži LEN **vzorcový ENGINE** (zoznam
`CISTY_ENGINE`, predtým `SUBORY`): `pergola-narez.ts`, `pergola-krov.ts`,
`pergola-narez-vstup.ts`, `PergolaNarezVykres.svelte` — tie NEimportujú
`server/money`/`server/pergola`/`server/db`. Nový DISPLAY engine → pridaj do
`CISTY_ENGINE`; Money ZÁPIS → daj do samostatného server mostu (nie do enginu ani do
guardu). Žiadny golden snapshot, žiadny priamy zápis do dlv-import z enginu.

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
  - **zadné nohy = ZV − horný profil** (OP260282: ZV 2790, hornyProfilZadnej 110 → 2790−110 = 2680) —
    TERAZ vo `vypocitane`; call citát ZV−profil POTVRDENÝ Dominikom 24.8. (#316), ZV-protirečenie
    výkresu (plná 2790) rozriešené v prospech callu. Vizuálna kreslená výška ostáva plná ZV (noha +
    horný profil dosiahnu ZV) — mení sa len CUT dĺžka.
    **ZNÁMY BUG zadnej konštr. (Dominik QA, #155) — VYRIEŠENÝ v #316:** predtým sa profil zadnej NOHY
    odvodzoval z `system` (Massive→18017/140) a „zadná konštr. horná" bola HARDCODED 18013 → pri Massive
    so 110 zadnou nejednotná (nohy 140 + horný 110). TERAZ obe sledujú `hornyProfilZadnej` cez
    `ZADNA_KONSTRUKCIA_PROFIL` (110→18013/110×110, 140→18017/140×140) → jednotné by-construction. Golden
    r.3 asertuje kód AJ dĺžku (2680/18013), nie len názov. Validácia mixu sa NEROBÍ (mix nie je zadateľný
    vstup — jediný rear profil je `hornyProfilZadnej`; „system ≠ hornyProfilZadnej" je LEGITÍMNE, OP260282).
  - **Zvislá zadná výstuha (18017 zvislá, 2340) = REKONCILIOVANÁ na prednú nohu (#155 A9)** — už
    NIE honest-null. Dominik (A9, 1724498): „nerozumiem 2340; noha = svetlosť + 140" → výkresová
    2340×2 pod 18017 = PREDNÁ NOHA (svetlosť 2200 + výstuha 140), TERAZ vo `vypocitane`. Skoršia
    misatribúcia: 2340 = svetlosť 2325 + 15 vs predná 2200 + 140 dávali rovnaké číslo. Nota odstránená.

## Modré poznámky OP260282 (#206) — POTVRDENÉ vzorce sú TERAZ v engine

Výkres OP260282 mal 5 modrých poznámok (nové voľby); #206 ich pridal do formulára + enginu +
výkresu. **Dva sú POTVRDENÉ číselné vzorce — už NIE sú otvorené, sú vo `vypocitane`/`efektivnaSvetlost`:**

- **110×43 pod kotviacim (18016) = ZV − 190**, 2 ks, LEN pri NIE-SS (`uchytenie='stena'`) + zasklenej.
  `POD_KOTVIACI_110x43_ODPOCET`. Checkbox „jednoduchá bez zasklenia" (`jednoduchaBezZasklenia`) ho vypína.
- **−60 pri 200×140 je ODVOLANÉ (Dominik, ch207 msg 1731729: „tých 60 to je asi zle") — `efektivnaSvetlost`
  aj konštanta ZMAZANÉ (#155, 25.8.).** Platí seating model: výstuha je skovaná 15 mm v žľabe
  (`VYSTUHA_SKOVANIE_MM`) a TRČÍ (zvislý rozmer − 15) do svetlosti (110→95, 140→125, 200→185,
  250→235; `vystuhaTrcanieMm`) → **noha = svetlosť + zvislý rozmer výstuhy VŠEOBECNE** (aj 200×140
  → +200 = 2400 pri 2200 — bez vlastného goldenu, flagnuté na potvrdenie). Informatívne
  `svetlostBezVystuhy` = svetlosť + trčanie (golden 2200+125 = 2325 = kóta výkresu). Bez zosilnenia
  VŽDY +15 (aj so zadaným profilom — 2155 bol presak −60). Výstuha horná odzrkadľuje kód 18022.
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
`pergola-komponenty.ts` (vyčlenené z `pergola-narez.ts` #183 large-file splitom; re-export fasáda
z `pergola-narez.ts`, konzumenti importujú z `$lib/pergola-narez` bez zmeny) ako **samostatná**
funkcia `komponentyPergoly(v)` + statický katalóg `PERGOLA_KOMPONENTY` — ZÁMERNE NIE v `NarezVysledok`, aby golden `pergola-narez-op260282`
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

## Rezervačný odpis do Money (#221) — MOST z rozmerov na Money odpis

Od #221 route `/pergola/narez` už NIE JE display-only — premenovaná na **„Rezervačný
odpis"**, posiela do Money rezervačný odpis pri zadaní objednávky (call Dominik 19.8.),
cez EXISTUJÚCI potvrdzovací tok (rozmery → materiál → ZAK/OP/zákazník → Money rozpis
nahlad → **explicitné potvrdenie** → zápis), bez +20 %.

- **Kľúčový most (`src/lib/server/pergola-rezervacia.ts`):** potvrdené riadky
  `spocitajNarez().vypocitane` s `dlzkaRezuMm != null` majú PRESNE tvar `CadRow`
  (`{code, name, qty=pocetKs, cut_mm=dlzkaRezuMm}`), takže sa prehnajú tým istým, na
  20/20 Money pároch overeným `transformRows` jadrom → PRP metre tyčí = bit-presne ako
  CAD odpis pre tie isté rezy. **Nikdy nepočítaj Money metre nanovo** — reuse
  `transformRows`, inak sa rezervácia rozíde s reálnym odpisom (a #227 nezmieri).
- **Honest-null vylúčenie je BEZPEČNOSTNÉ:** `narezToCadRows` filtruje `dlzkaRezuMm != null`,
  takže null riadok (priečka 18004 = HH krovu) sa ako CadRow ANI NEVYTVORÍ → do Money sa
  nikdy nedostane; zobrazí sa cez `vylucenePolozky` ako „zatiaľ nepočítané". Komponenty
  (bez Money kódu) do odpisu tiež nejdú.
- **Označenie rezervácie (párovateľnosť pre #227):** `OdpisJob.rezervacia=true` →
  `filenameFor` marker „REZ" (`ZAK - zákazník REZ [hash].xlsx`); `popis` prefix „REZ"
  (vidno v Money); `detail.rezervacia` + rozmery + vylúčené kódy. **modul='pergola'
  ZAMERNE** = zdieľaný dedup `(modul,zak,op,live)` s CAD odpisom → rezervácia + neskorší
  CAD odpis tej istej ZAK+OP kolidujú (bráni dvojitému odpisu; oprava = `releaseOdpis`).
- **`transform` refaktor:** čistá extrakcia `transformRows(CadRow[])`; `transform(text)`
  je len obal `transformRows(parseInput(text))` — kontraktové vektory `pergola.test.ts`
  platia. Ak treba odpis z iných štruktúrovaných riadkov, volaj `transformRows`, nie
  serializáciu späť na CAD text.
- **Money-safety guard (`tests/pergola-narez-money-safety.test.ts`) sa ZÚŽIL:** vzorcový
  ENGINE (`pergola-narez.ts`, `pergola-krov.ts`, `pergola-narez-vstup.ts`, výkres) ostáva
  Money-clean; route + most odpis posielať SMÚ. Ak pridávaš ďalší display engine, drž ho
  v guarde; Money zápis daj do samostatného server mostu.
- **Testovanie odoslania = LEN TEST režim** (`skipAkLive`, seedovaný `e2e` user) — appka
  na prode je LIVE (`/health` `live:true`), reálny „Odoslať do Money" na prode nikdy.

## Stavové UI (#222) — počty/odznaky MUSIA mať tú istú podmienku ako Money filter

Výstup `/pergola/narez` (`step === 'vysledok'`) ukazuje stavové zhrnutie (`spocitaneCount`
/ `cakaDlzkaCount` / `cakaPravidloCount`) a per-riadkový odznak v tabuľke Materiál
(✅ v odpise / ⏳ čaká). **Podmienka „spočítané / ide do rezervácie" MUSÍ byť BYTE-FOR-BYTE
tá istá ako filter do Money** v `pergola-rezervacia.ts`:

- `spocitané` (do rezervácie) = `dlzkaRezuMm != null && pocetKs > 0` — presne
  `narezToCadRows`.
- `počet istý, dĺžka čaká` = `dlzkaRezuMm == null` — presne `vylucenePolozky`.
- `čaká na pravidlo` = `nepodporovane.length`.

Ak sa per-riadkový odznak alebo počítadlo odchýli (napr. odznak len `dlzkaRezuMm != null`
bez `pocetKs > 0`), obrazovka bude tvrdiť „ide do odpisu" o riadku, ktorý reálne do Money
nejde — a Dominik zase nebude vedieť, čo je naozaj v odpise (presne to, čo #222 riešil).
Pri akejkoľvek zmene enginu, ktorá vie vyrobiť riadok s dĺžkou ale nulovým počtom, over
oba povrchy naraz. Stavové odznaky sú `.badge.ok`/`.badge.wait` (app.css, sémantické
varianty existujúcich `.badge.live`/`.badge.test` — žiadny nový dizajnový jazyk).

## Ručné položky do rezervácie (#234) + round-trip pasca (kritické)

- **Ručné („pometrané") položky** (napr. kotviace profily): `$lib/pergola-rucne.ts`
  (čistý, client-imported, v money-safety CISTY_ENGINE) — `RucnaPolozka {kod,nazov,mnozstvo,mj}`,
  `parseRucnePolozky` (JSON z hidden inputu), `rucnaValidacia` (neznámy kód = VAROVANIE, nie
  odmietnutie; MJ sa NEHÁDA — chýbajúca MJ = chyba). `buildRezervaciaRozpis(vstup, ident,
  manualRows=[])` — ručné riadky OBÍDU `transformRows` (sú už Money kód + MJ) a pridajú sa
  priamo do `nonzero`/`polozky` s `rucne:true`. Server ich prepočíta ZNOVA (nedôveruje klientu).
- **`manualWarnings` sa DEDUPUJÚ (`[...new Set(...)]`)** — dva riadky s rovnakým neznámym/kolíznym
  kódom dajú identický string; v svelte `{#each … (w)}` by to bola `each_key_duplicate` chyba.
  Keyuj `nonzero` cez `(o.kod + '·' + i)` (ručný kód sa môže rovnať spočítanému). Kolízia
  ručný==spočítaný kód → varovanie pred dvojitým odpisom (nie tiché).
- **ROUND-TRIP PASCA (PR #81 vzor):** stav, ktorý má prežiť „Späť a upraviť" (ident ZAK/OP,
  `rucnePolozky`), sa serializuje do hidden inputov a server ho ECHUJE späť v KAŽDEJ akcii
  (spocitat/rezervovat/odoslat/upravit) → `$effect` ho obnoví. **POZOR:** formulárový krok
  (`step==='form'`) `?/spocitat` form NErenderuje `hidden()` snippet (má viditeľné vstupy) —
  každý nový carried-through stav tam MUSÍ dostať vlastný `<input type="hidden">`, inak sa pri
  form→vysledok stratí. Server: `parseIdent`/`parseRucne` aj v `spocitat`+`upravit`.

## Žiadny interný žargón na obrazovke (#233)

- Renderované stringy (svelte, `PergolaNarezVykres` `<text>`, engine `nepodporovane`/`poznamka`,
  `krov.poznamky`) NESMÚ obsahovať `#N` / `O-čka` / „callu 13.8." — plain slovenčina
  („čaká na vzorec od Dominika"). Referencie ostávajú v komentároch kódu. Akceptačný E2E
  (`pergola-uix.spec.ts`) skenuje `body.textContent()` (aj zbalené `<details>`) na `/#\d/`,
  `/\bO\d/`, „call". CSS hex farby (`#15803d`) sú v `<style>`/`style=`, nie v `textContent`.
- Engine `nepodporovane: NepodporovanaPolozka[] {kratky, detail}` — krátka veta v zozname +
  plné odôvodnenie v `<details>` (default zbalené). `poznamka` (krátka šedá) + `poznamkaDetail`
  (rozklik) v materiálovej tabuľke. Testy asertujúce staré `#N` stringy prepíš na plain znenie.

## Post-deploy verifikácia na LIVE (bezpečne)

`Spočítať` + `upravit` + `rezervovat` (Pripraviť rezervačný odpis → rez-nahlad) sú READ-ONLY
(NEpíšu do Money) → dá sa overiť aj na prode (`live:true`). Iba `odoslat` (writeOdpis) zapisuje.
Verifikuj až po rez-nahlad PREVIEW, nikdy neklikaj „Odoslať do Money" na prode. Login na prode:
seed useri v `/opt/automatizacie-montalu/.env` (creds v lokálnej memory). Svelte 5 `bind:value`
neberie syntetické `input` eventy z `evaluate` — na vyplnenie použi Playwright `fill`.

**Varovania #234 — KDE ich čítať (read-back 2026-08-20, falošný negatív):** `rucne-varovanie`
(neznámy kód) je client `$derived` z aktuálneho inputu — po „➕ Pridať" sa input vyprázdni a
varovanie ZMIZNE. `rez-rucne-varovanie` (neznámy + „dvojitý odpis") vyrába server v
`buildRezervaciaRozpis` → vidno až na `rez-nahlad` po `rezervovat`. `pergola-rezervacia.spec.ts`
je celý `skipAkLive` → proti produ beží 0 testov; ručne: Spočítať (stateless) → pridať riadok →
Pripraviť rezervačný odpis (náhľad, stále bez zápisu).

## Krokové subkomponenty (#239) — kde žije stav, kam pridať nový vstup

`/pergola/narez` (kedysi 1231 r. monolit) je rozdelený: `+page.svelte` (~311 r.) = **state +
compute hub**, kroky sú komponenty v `src/lib/components/pergola/`:

- **`RezForm.svelte`** — krok `form` (rozmery). 18 polí ako `$bindable` propy (vzor
  `KlinPolia.svelte`); `hiddenIdent` snippet + `rucneRiadky` prídu ako propy.
- **`RezVysledok.svelte`** — krok `vysledok`, 9 kariet (nadpis/stav/výkres/krov/materiál/
  komponenty/informatívne/údaje/nepodporované). Čistá prezentácia (props in).
- **`RucnePolozky.svelte`** — karta Ručné položky (#234). `$bindable rucneRiadky` + lokálny
  input-stav; katalóg si derivuje z `catalog` propu.
- **`RezNahlad.svelte`** — krok `rez-nahlad`. `hidden`/`hiddenIdent` snippety prídu ako propy.
- **`RezHotovo.svelte`** — krok `rez-hotovo`, čistý display.

**Kritické pre round-trip (rozšírenie „ROUND-TRIP PASCA" vyššie):** VŠETOK `$state` (18 polí,
ident, `rucneRiadky`), `$effect` echo a OBA serializačné snippety `hidden`/`hiddenIdent`
zostávajú v `+page.svelte` — jediná autorita serializácie. Deti dostanú snippety ako propy a
`{@render}`-nú ich vo svojich `<form>`-och (DOM potomkovia formulára → submit ich zahrnie).
**Nový carried-through stav = nový `<input type="hidden">` v `hidden()` snippete rodiča** (a vo
`form` kroku vlastný hidden v RezForm — form krok NErenderuje `hidden()`), NIE v dieťati.
Editovateľné polia RezForm sú `$bindable`; rodič ostáva ich zdrojom (echo `$effect` ich obnoví).

**CSS:** zdieľané `table.narez` + `.badge.rucne` sú v `src/app.css` (global). Page-lokálne triedy
sú scoped v komponente, ktorý ich renderuje — **POZOR na `.sec .badge`** (odznak v `.sec`
hlavičke): `.sec` je uppercase, `.sec .badge` to override-ne; MUSÍ byť scoped v KAŽDOM komponente
s `.sec`-hlavičkovým odznakom (RezVysledok aj RucnePolozky), inak odznak zdedí uppercase (#239
review nález).

## Zdieľaný prepínač `PergolaModeNav.svelte` (#371) — testid kolízia so starým in-page odkazom

Keď sa zdieľaná nav komponenta (napr. `PergolaModeNav.svelte`, renderovaná hore na
`/pergola`, `/pergola/narez` aj `/pergola/navrh`) vloží na stránku, ktorá už MALA svoj
VLASTNÝ starý odkaz s rovnakým `data-testid` smerujúci na to isté miesto (`RezForm.svelte`
malo pred #371 vlastný in-page odkaz `data-testid="link-navrh"` v úvodnom odstavci), vznikne
**Playwright strict-mode violation** (`getByTestId(...)` matchne 2 elementy) — `npm run
check`/`npm run lint` to NEODHALIA, len skutočný beh e2e testu. Pred pridaním zdieľanej
navigácie na existujúcu stránku **grepni cieľové testid-y aj v komponentoch, ktoré sa na
tej stránke renderujú POD ňou** (`grep -rn "data-testid=\"link-X\"" src/`), nielen v
súbore, ktorý upravuješ. Fix: starý duplicitný in-page odkaz zmaž (nová zdieľaná
navigácia ho už plne nahrádza) — nikdy nepremenúvaj testid len aby kolízia zmizla (to
by zase rozbilo test, ktorý ten pôvodný testid asertuje inde).

**Card-wrap konzistencia:** ak hub stránka (`/pergola`) renderuje zdieľanú nav komponentu
VNÚTRI vlastnej `.card`, subsránky (`/pergola/narez`, `/pergola/navrh`) ju wrapni do
VLASTNEJ `.card` tiež (nie ako bare blok na pozadí stránky) — inak vznikne vizuálna
nekonzistencia medzi hubom a subsránkami, ktorú `npm run lint`/`check` neodchytí (nájdené
až v `/requesting-code-review` pass, #371).

## Post-deploy na LIVE — v ČISTOM prehliadači (Svelte hydration pasca)

Post-deploy overenie tejto appky rob v **čerstvom prehliadači** (`browser_close` → nový
`browser_navigate`). Reused Playwright session s PRED-deploy client bundlom + nová SSR HTML =
hydration mismatch na novej hranici komponentu → `{#each}` sa vykreslí PRÁZDNY (napr. rez-rozpis
prázdny, kým `.length` header ukazuje nenulový počet). Nie je to bug kódu — čerstvý prehliadač +
CI E2E render korektne. Príznak: `<tbody><!--[--><!--]--></tbody>` (prázdny each) pri nenulovom
počte v hlavičke.

## Krov cut-list (#161) — IMPLEMENTOVANÉ pre OVERENÚ konfiguráciu (config-gate na Money)

Derivácia 21.8. (overená proti golden OP260282) odblokovala krovový cut-list — POZOR: časti
vyššie („krov NEIMPLEMENTOVANÉ", „HH krovu / priečka / prítlačná / zaklapávacia ostávajú NULL")
sú tým ČIASTOČNE prekonané. Aktuálny stav:

- **Nominálna dĺžka krovu** = `krovDlzkaNominal(hĺbka, sklon)` v `pergola-krov.ts` (ODDELENÁ od
  `krovUlozenie` — uloženie počíta len ≥ 7°, ale DĹŽKA funguje pre KAŽDÝ sklon > 0; golden 6,1° je
  POD prahom, preto MUSÍ ísť mimo uloženia): `hĺbka/cos(sklon) − 250` = 3239,76. HH krovu (výkres
  3240,93) = nominál + ~1,17 mm reálne uloženie (seating, BEZ čistého vzorca → emituje sa NOMINÁL,
  gap sa len dokumentuje). R2 (0,01 mm) = presnosť výkresu.
- **Priečka (18004)** = nominál, **prítlačná/maskovacie (18006/07/08)** = nominál + 40 = 3279,76
  (počty n/(n−2)/2), **zaklapávacia (18005)** = svetlosť medzi krovmi, 2(n−1) ks. Premenované
  zobrazenie „výstuha horná" → „žľabová výstuha".
- **Počet krovov = MANUÁLNY vstup `pocetKrovov`** (Dominik 21.8.): RUŠÍ auto `ceil(šírka/700)+1`
  (dával 9 vs výkres 8). Appka ukáže **svetlosť medzi krovmi = (šírka − 50n − 2)/(n−1)** (živý hint
  v `RezForm` + informatívne). `pocetPriecok` ostáva len ako FALLBACK počtu (bez n) — do Money však
  dĺžka bez n NEIDE.

### CONFIG-GATE — najdôležitejšia Money-safety disciplína (single-golden pravidlo)

Vzorec −250 je overený na JEDNOM golden bode; **Robust má od 25.8. vlastné pravidlo −220**
(Dominik verbatim ch207 msg 1724329: „výsuv −154,94 masív / −124,94 Robust" = rozdiel presne
30 = predný profil 140−110, ukotvené na overený masív bod; lišty Robust = +30, msg 1724331 —
bez Robust goldenu → riadok nesie poznámku „na potvrdenie"). Engine emituje nominál/lišty do
Money **iba pre konfiguráciu KOTVY**:

```
krovConfigOverena = uchytenie === 'samostatne' && hornyProfilZadnej === 110   // OBA systémy
krovNominal       = krovConfigOverena ? krovDlzkaNominal(hĺbka, sklon, system) : null
krovDlzkaDoMoney  = krovNominal != null && pocetKrovov != null ? krovNominal : null   // AJ n-gate
```

- **Gate na SYSTÉM samotný je PASCA** (review nález): default formulára je `stena` + zadný `140`
  (VZOR = „9/10 pergol") — bez gate by sa neoverené číslo poslalo do rezervačného odpisu.
  Massive-140-zadná / stena ostávajú honest-null; sklon > 9° vracia null (A7); „výsuv" báza
  Dominikovej parametrizácie ostáva nedefinovaná (A3) — implementovaný je LEN jej rozdiel.
- **Money-emitovaná DĹŽKA gatuj aj na MANUÁLNY `n`** — bez neho by priečka niesla starý (výkresom
  vyvrátený) auto-počet do Money. Zaklapávacia potrebuje len `n` (svetlosť je geometria zo šírky).
- **Záporná svetlosť guard:** priveľa krovov na šírku → svetlosť ≤ 0. `svetlostMedziKrovmi` vráti
  null pri ≤ 0 A `chybaPergolaNarezVstupu` to odmietne (inak by záporná dĺžka/kladný počet prešli
  `narezToCadRows` do Money). Engine-side `platnyPocetKrovov` ZRKADLÍ validátor (celé číslo + max,
  žiadne tiché zaokrúhlenie) — inak caller mimo validácie dostane iný počet.
- **Honest-null stále drží:** Robust lišta, Massive+140/stena, seating +1,17, frézovanie drážok.
  (Zvislá zadná výstuha 2340 UŽ NIE honest-null — rekonciliovaná na prednú nohu, #155 A9.) Rozšírenie na ďalšie konfigurácie = NOVÝ golden / potvrdenie Dominikom
  (majiteľ posúdi), NIKDY dohad. Kódy 18004–18008 SÚ v Money CODE_MAP (`server/pergola.ts`), takže
  po pustení idú cez `transformRows` do rezervácie — preto config-gate.

## Strešné sklo (#223) — SAMOSTATNÁ pure funkcia, Money-NEUTRÁLNA (nikdy do `vypocitane`)

Výpočet strešného skla žije v `src/lib/pergola-sklo.ts` (`spocitajStrechaSklo(v)`) ako
**samostatná** pure funkcia — vzor `komponentyPergoly`, ZÁMERNE **mimo `NarezVysledok`/`spocitajNarez`**,
aby golden OP260282 ostal bit-identický A aby sa sklo NIKDY nedostalo do `vypocitane` →
`narezToCadRows` → Money. Modul je v `CISTY_ENGINE` money-safety guardu (importuje LEN pure moduly:
`sklo-strecha` #274 + `pergola-narez`). Sklo je **display-only, žiadny Money odpis** (rozhodnutie až
po potvrdení variácie, ticket #223).

- **Šírka tabule = `svetlostMedziKrovmi(šírka, n)` + prídavok**: +30 (sklo/STADUR),
  **+34 (polykarbonát)** — `strechaSkloSirkaPridavok(nazov)` cez `jePolykarbonatSklo` (name includes
  „polykarbon"). Potvrdené A1 (Dominik #198, 21.8.); výstuha 140 do šírky NEvstupuje.
- **Počet tabúľ = počet polí medzi krovmi = `platnyPocetKrovov(v) − 1`** (`platnyPocetKrovov` je
  odteraz exportovaný z `pergola-narez.ts`). Bez manuálneho počtu krovov → honest-null.
- **Dĺžka tabule = VŽDY honest-null — od 25.8. podložené REÁLNYM kusom.** Výrobný výkres skla
  OP260282 (ch207 msg 1731731, príloha 10504; „sklo maš pripnute" msg 1739824): 7 ks, 685 × 3259.
  Šírka aj počet vzorce reprodukujú (685,43 → rez 685 nadol; 7 polí ✓ — prvé overenie proti reálnemu
  rezu, `tests/pergola-sklo.test.ts` verifikačný describe), ale dĺžku NEreprodukuje ŽIADNE verbatim
  pravidlo: chat „dĺžka krovu + 40" → 3279,76 ✗ (= presne prítlačná lišta!), call „HH + 20" →
  3260,93 ✗. NEHÁDAŤ (nominál+20+floor by sedel, ale je to dvojitá domnienka). Korekcia šírky pre
  „pole s výstuhou" NEEXISTUJE — všetkých 7 tabúľ rovnakých + Dominik „ano nevstupuje" (1725595).
- **Typ skla = NOVÝ `strechaSkloTyp` select** (14 typov z `SKLO_STRECHA_TYPY`), riadi vzorec (+30/+34)
  aj cenu. Voľný text `strechaSklo` ostal SAMOSTATNE (poznámka/coating/RAL na výkres) — nulová regresia.
- **Cena = €/m² UNIT zo snapshotu**, server modul `src/lib/server/sklo-strecha-cena.ts`
  (`strechaSkloCenaPre` → `skloStrechaMoneyKod` → `cenaZaM2`), interní gate `!isB2B` v `spocitat`
  (vzor `cenyPre`). **ŽIADNY total** (plocha = šírka × DĹŽKA × počet, dĺžka null → plocha neznáma).
  Typ bez TS kódu (8/14) → „karta v Money zatiaľ neexistuje" (honest-null), NIKDY hádaný kód.
- **Rozdelenie klient/server:** geometria je klientsky `$derived spocitajStrechaSklo(vstup)` (ako
  `vysledok`/`komponenty`); cena príde zo servera (`form.strechaSkloCena`). `RezVysledok`/`+page.svelte`
  NEimportujú `$lib/server/*` (ani cenový TYP) — prop používa klientsky štrukturálny typ.
- Round-trip: `strechaSkloTyp` je vo vstupe, reset `$effect` echo, `hidden()` snippete aj `bind:` (select
  je viditeľný vstup → submitne sa priamo vo `form` kroku, hidden je pre ďalšie kroky).

## Tesnenia (gumy) do rezervačného odpisu (#339) — data-driven katalóg + typová Money-zámka

Tri pravidlá z callu 31.8.: tesnenie žľabu = dĺžka žľabu; tesnenie kotviaceho = dĺžka kotviaceho;
tesnenie na sklá = dĺžka stropného profilu × 4. Žijú v `src/lib/server/pergola-rezervacia.ts`
(`spocitajTesnenia(NarezVysledok)` + data-driven katalóg `TESNENIA`), zobrazujú sa sekciou
„Tesnenia (gumy)" v `RezNahlad.svelte`. Vzor, ktorý sa oplatí zopakovať pri ĎALŠEJ položke
bez potvrdeného Money kódu:

- **`TesnenieRozmer.kod: null` (LITERÁLOVÝ typ) = ŠTRUKTURÁLNA Money-zámka, nie `if`-flag.** Typ
  s `kod: null` (a bez `qty`) sa nedá priradiť na `Polozka` (`kod: string`), takže položka sa NEDÁ
  dostať do `job.polozky` — nemožné-typom, nie preskočené-podmienkou. Zámku over KOMPILAČNE:
  `@ts-expect-error` test (`tests/pergola-tesnenia.test.ts`) padne cez `npm run check`, keď ju
  niekto oslabí (falsifikovateľné, nie runtime-only).
- **Nejednoznačný základ vzorca (× 4 na „stropný profil" — prítlačná lišta 18006 vs priečkový
  profil 18004) = `zakladKody: null` → `stav:'caka'`, NIKDY hádané číslo.** Data-driven: doplnenie
  Money kódov / potvrdenie základu = úprava poľa `TESNENIA`, nie redizajn (phase 2 = #347). Základ,
  ktorý nie je v spočítanom náreze (napr. bez krovu), degraduje na `caka` rovnako — honest-null je
  TRVALÝ stav.
- **Money kód tesnenia treba dohľadať v Money read-only** (ssh `~/.ssh/slovnormal_odoo` na
  `root@erp.montalu.cloud` — POZOR: na worktree boxe môže CHÝBAŤ; vtedy je to blocker, ktorý sa
  rieši otázkou na tiket, nie hádaním). Dominikov písomný zoznam ide do kanála 207.
- **#233 žargón-sken MUSÍ pokryť aj krok `rez-nahlad`** (nie len `spocitat` výsledok) — nové
  user-visible stringy tesnení sa renderujú tam. `pergola-uix.spec.ts` sken doťahaj cez
  `pripravit-rezervaciu` (ČÍTACIE, žiadny zápis).
