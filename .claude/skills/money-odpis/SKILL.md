# Money odpis — správnosť množstiev a článkov (zásady)

Odpis, ktorý appka vyráta, sa importuje do **ostrého Money ERP** (`MONEY_LIVE=1`).
Zlé číslo = zle vyfakturovaný materiál. Táto zásada zbiera opakujúce sa pasce.

## 1. KAŽDÝ Money kód over proti ŽIVÉMU Money — aj „odpisové" kódy

Podklady (nárezové aj **odpisové** Excely) obsahujú STARÉ / preklepnuté kódy. Pravidlo
„ber kódy z odpisu, nie z nárezov" NESTAČÍ — aj odpisový hárok môže mať copy-paste preklep.
Overené prípady: bazén `BPP00046`→`BPP202414`, Deluxe 2x3K spodná koľajnica `ZASP00104`
(2K, workbook preklep) → `ZASP00030` (3K). Pred pridaním/zmenou článku over v Money:
kód existuje, `Deleted=false`, názov sedí s profilom (rodina + dĺžka tyče v názve).

**Read-only Money recept** (NIKDY zápis do Money):
```bash
# query.py: sys.path.insert(0,"/opt/montalu-sync/scripts/import-montalu"); import moneydb
#   conn=moneydb.connect(); moneydb.query(conn, sql)   # SQL literály N'...'
#   Artikly_Artikl (Kod/Nazev/ID/Deleted); sklad: S5_Artikl_CelkoveMnozstviNaSkladech (s.Artikl_ID=ar.ID)
scp -i ~/.ssh/slovnormal_odoo query.py root@erp.montalu.cloud:/tmp/
ssh -i ~/.ssh/slovnormal_odoo root@erp.montalu.cloud '/opt/montalu-sync/venv/bin/python /tmp/query.py'
```
0-sklad kód NEBLOKUJE odpis (napr. nosový ZASP00010) — dôležité je, že je to SPRÁVNY
aktuálny článok, nie sklad.

**Rovnaký NÁZOV profilu existuje vo viacerých systémoch — rozlišuj podľa `Model_UserData`.**
Money má napr. DVA „Oponový profil surový 7500 mm": `ZASP00006` s `Model_UserData =
'Zasklenie Robust'` (FINAL, 2021) a `ZASP20249` s `'Zasklenie Slide'` (Cortizo, 2024).
Kontrola „kód existuje + názov sedí" to NEODHALÍ — Slide opona roky odpisovala robustový
článok, lebo bola z Robustu odvodená (v15, 2026-07-27). Preto pri každom kóde vyber aj
`Model_UserData` a over, že sedí so SYSTÉMOM, do ktorého kód dávaš:
```sql
SELECT Kod, Nazev, Model_UserData FROM Artikly_Artikl WHERE Nazev LIKE N'%Oponový%' AND Deleted=0
```
Pri odvodení nového štýlu z iného systému prejdi CELÝ jeho BOM a pre KAŽDÝ kód over model —
odvodenie prenesie kódy zdrojového systému aj tam, kde cieľový má vlastný článok.

## 1b. Excely od Dominika: „rozmer" ≠ „dĺžka rezu" — a referencia vs. ručná hodnota

Nárezové Excely majú na TEN ISTÝ profil dva rôzne stĺpce a zámena je Money-chyba:

| stĺpec | hlavička | čo to je | použi na |
|---|---|---|---|
| `E` | **rozmer** | dĺžka, ktorú dielňa REŽE | rez + náš `cfg_rez.offset` |
| `Q` | dĺžka rezu | vstup do odpisových stĺpcov `P..V` (tyče) | NIČ — býva zastaraný |

Príklad (Slide opona 2x3K): `E14 = (B6+142,5)/D10` vs `Q14 = (B6−12)/D10`; `E15 = C6−67`
vs `Q15 = C6−65`. Migrácia v14 vzala `Q` → dielňa hlásila „reže sa 857, appka píše 831".

**Ako poznať, ktorý stĺpec je aktuálny:** pozri, či je hodnota REFERENCIA alebo ručné
číslo. Dominik pri úprave prepíše `E`; riadky, ktoré si `Q` berú referenciou (`Q18 = =E15`)
sa doladia samé, riadky s ručne zadanou konštantou v `Q` (`=C6−65`) zostanú staré.
**Referencia = aktuálne, ručná konštanta v odpisovom stĺpci = podozrenie na leftover.**
Krížová kontrola: rámový `rozmer` musí vyjsť `sklo + skloOffset` (83) — ak to sedí so už
overeným sklo vzorcom, čítaš správny stĺpec.

**PRÁZDNY rozmer v Exceli ≠ profil sa nepočíta** — môže znamenať „reže sa spolu s iným
profilom v celku". Slide opona: redukcia `ZASP00091` mala prázdny rozmer, ale plné počty
(12 + 12 ks) aj počet tyčí, lebo sa reže s rámovým; presný vzorec („šírka prírezu mínus
72,4", platí na šírku AJ výšku) dal až Dominik na dopyt (v16, 2026-07-27). Keď je stĺpec
prázdny a počty nie sú nulové, VYPÝTAJ si vzorec — neodvádzaj ho z príbuzného profilu.

Dump Excelu vždy DVAKRÁT — raz so vzorcami, raz s hodnotami:
```python
openpyxl.load_workbook(f, data_only=False)  # vzorce (vidno referencie vs konštanty)
openpyxl.load_workbook(f, data_only=True)   # vypočítané hodnoty
```
A po oprave over 1:1 nielen dĺžky rezov, ale aj **počty tyčí** proti Excelu (stĺpec `V`) —
to je jediné, čo priamo overí Money odpis.

## 2. Celé tyče + per-profil dĺžka → guard na kus dlhší než tyč

Odpis = `tyče × dĺžka_tyče / 1000` (celé tyče, `compute.ts`). Dĺžka tyče je **per-profil**
(`RezRow.dlzkaTyce`, default `BAR=7500`; Deluxe: kladka/klzný 3600, 5K horná 6000).
**Pasca:** kus DLHŠÍ než jeho tyč (napr. 5K šírka 6100 na 6000mm koľajnici) FFD „zabalí"
na 1 tyč so záporným odpadom → odpis podhodnotený na polovicu. `oversizeCut()` v
`safeCompute`/`safeComputeMulti` to odmietne s konkrétnou chybou — VŠETKY Money zápisy
idú cez safeCompute, takže zlé číslo sa nedostane do Money. `dlzkaTyce` je aj v
`BOUNDS`/`inBounds` (preklep 600/75000 sa odmietne).

## 2d. PERGOLA: profil vedený vo VIACERÝCH dĺžkach tyče — kusy MUSIA zdieľať tyč

Money vedie časť pergola profilov vo viacerých dĺžkach naraz (žľab 110/140, kotviaci
horný, 200x140, 250x110 → 4500 / 6000 / 7500 mm; zvyšok len 7500). `pergola.ts transform()`
má preto dve vetvy a **tá viac-variantová dlho nebalila vôbec** — každý kus dostal vlastnú
tyč (`nearestHigher`), takže rezy 6400 + 1030 dali 7,5 m + 4,5 m namiesto jednej 7,5 m tyče
(nadodpis v Money, hlásené zo živej ZAK2026337, 2026-07-29).

Pravidlo: kusy ≤ najdlhšia tyč sa balia **spoločne** (`packMulti()` — FFD do tyčí každej
dostupnej dĺžky ≥ najdlhší kus, každá tyč sa zmenší na najkratšiu variantu, ktorá na jej
obsah stačí, vyberie sa variant s najmenším materiálom). Kus dlhší než najdlhšia tyč ide
inou cestou — `minCoverCombo` + voľba kombinácie podľa polohy nohy — a NESMIE sa zabaliť.

- **Prídavok na kotúč pergola engine NEMÁ** (na rozdiel od zasklení, kde je `KOTUC=4`).
  Je tak overený proti reálnym Money párom; nepridávať bez rozhodnutia Dominika.
- Overené vektory (2 reálne Money páry) majú od každého viac-variantového profilu len
  JEDEN kus — takže „prešli testy" tu nikdy nedokazovalo, že balenie funguje. Pri zmene
  balenia píš test na VIAC kusov, nie na tie páry.
- Interné poznámky z `trace.notes` idú do UI pod hlavičku „Dlhé profily (rez > 7500 mm)" —
  čokoľvek tam pridáš sa používateľovi zobrazí ako tvrdenie o dlhom reze. Note o niečom
  inom = falošné varovanie (presne tento prípad).

## 2e. Ručná úprava množstiev pred odoslaním — `applyEdits` v `money.ts`

Bazén aj pergola dávajú obsluhe upraviť množstvá v náhľade: polia `qty_<KOD>`, prázdne =
spočítaná hodnota, `applyEdits()` odmieta záporné / nečíselné / > 100 000 **chybou** (nikdy
tichá nula do Money) a vracia `zmenene` na značku ✏️. Poradie je záväzné: najprv engine,
potom voľby (kombinácie tyčí), **ručné úpravy až úplne nakoniec** — do Money ide presne to,
čo obsluha vidí v poliach. Pri chybe sa ostáva v náhľade s echom zadaných hodnôt
(`editVals`), nikdy sa nespadne späť do formulára so stratou zadania.

## 2f. Názov xlsx súboru — `filenameFor` je JEDINÉ miesto, hash nesie OP

Tvar: `ZAK2026337 - Zákazník B [b1e403ee].xlsx` — číslo zákazky, zákazník, nič viac
(šéf 2026-07-29). Dve pravidlá, obe vykúpené chybou:

- **Do názvu NEDÁVAJ OP.** Kolónka sa volá „OP/OPDL číslo" a obsluha do nej píše aj
  prefix (`OP250359`, `OPDL260092` — vidno v histórii odpisov), takže šablóna
  `- OP${op} -` vyrábala `OPOP250359`. Rovnako tam nepatrí názov modulu: zákazník
  býva zadaný ako „PERGOLA Zákazník B", takže z toho bolo `… PERGOLA X PERGOLA`.
- **Hash na konci MUSÍ počítať aj s OP** (`contentHash(\`${zak}|OP${op}\`, polozky)`).
  Bez OP v názve majú dva odpisy tej istej zákazky s rovnakým obsahom rovnaký názov
  a druhý ten prvý v Money import priečinku **prepíše** — tichá strata odpisu.
  `contentHash(zak, polozky)` samotný ostáva planHash strážcom, nemeň mu vstup.

Názov skladá výhradne `filenameFor()` v `money.ts` — moduly ho neskladajú (pole
`filenameBase` v `OdpisJob` bolo zrušené práve preto, že tú istú šablónu držali 4×).

## 2g. Multi-posuv round-trip: náhľad posiela SPARSOVANÝ tvar posuvu

`hiddenMulti` v náhľade serializuje `multiVstup.posuvy` — teda to, čo server
vrátil, nie ploché polia formulára. Preto každý per-posuv údaj chodí na server
v DVOCH tvaroch a `parseMultiVstup` musí zvládnuť oba:

| Z formulára (ploché) | Z náhľadu (sparsované) |
|---|---|
| `klin: '1'`, `klinDlzka: '2509'`, … | `klin: { dlzka: 2509, … }` |
| `kolajnicaHorna: '2690'` | `kolajnica: { horna: 2690, … }` |

Kým sa čítali len ploché názvy, druhý parse (Odoslať / Späť a upraviť) hodnoty
**tichor zahodil**: klín zmizol z plánu po odoslaní a ručná dĺžka koľajnice —
ktorá je **Money-kritická** — sa vrátila na výpočet zo šírky (šéf 2026-07-30).
Pomocníci `klinRaw()` / `kolajnicaRaw()` vo `vstup.ts` normalizujú oba tvary;
vnorený tvar vždy znamená „zapnuté" (zapínač padol pri prvom parse).

**Keď pridávaš ďalší per-posuv údaj, otestuj DRUHÝ parse**, nie len prvý —
`tests/vstup-multi-roundtrip.test.ts` je vzor (parse → serialize → parse).

## 2h. Rezy profilov: sync z Money + zámka, aby zoznam nedriftoval

Náhľady rezov (`static/profil/<KOD>.webp`, zoznam `src/lib/profil-obrazky.ts`)
ťahá `scripts/sync-profil-obrazky.sh` z príloh Money kariet artiklov. Dve pasce,
obe už zamknuté testom:

- **Sync je MANUÁLNY.** Nový systém (Štandard / Štandard + v0.7.0) doniesol 11
  profilov, ktorých rezy v Money boli, ale nikto sync nespustil — dielňa videla
  obrázok len pri pár profiloch. Po každom pridaní profilu/systému ho pusti.
- **Zoznam sa dopĺňal ručne** → aj stiahnutý rez mohol ostať nezapísaný. Skript
  ho už prepisuje sám. `tests/profil-obrazky.test.ts` drží zoznam == súbory ==
  kódy v použití, `e2e/profil-obrazky.spec.ts` kontroluje `naturalWidth` v
  prehliadači (rozbitý súbor padne, nie len chýbajúci).

Zdroj kódov je rovnaký pre skript aj test: `pergola.ts` + `bazen.ts` +
`cfg_seed.json`. Kód pridaný LEN v editore vzorcov (ostrá DB) tam nie je — vtedy
ho pridaj aj do seedu, inak mu rez nikto nestiahne.

## 2b. Ručný ROZMER rezu od obsluhy (koľajnica) — MENÍ odpis, patrí do compute

Dielňa občas reže profil na inú dĺžku než dá vzorec (Patrik 2026-07-28: horná koľajnica
2690, spodná 2695 mm namiesto šírky). Vzor, ako to pridať bez rozbitia zvyšku:

- **Prepíš dĺžku v `profilCuts`, nie v konfigurácii** — jedna vetva: ak riadok patrí danej
  ROLE a hodnota je zadaná, použi ju miesto `val()`. Koľajnice majú `kerf = 0`, takže
  rezaná dĺžka = balená dĺžka; pri profile s nenulovým prerezom by sa muselo rozhodnúť,
  čo obsluha vlastne zadala (rez vs. spotreba na tyči).
- **Rolu ber z NÁZVU profilu v cfg** (`Koľajnica horná …` / `Koľajnica spodná …`,
  `$lib/kolajnica.ts`), a zoznam systémov, kde to má zmysel, DERIVUJ z konfigurácie
  (`systemyRucnaKolajnica`) — nie natvrdo. Robust/Slide majú jednu obvodovú koľajnicu
  (`Koľajnica 2K …`, riadky `S` aj `V`), takže „iná horná/spodná" tam nemá zmysel a
  vypadne sama.
- **PASCA (stála nás jeden beh):** `\b` za slovenským znakom NEFUNGUJE —
  `/^Koľajnica\s+horná\b/` nikdy nesedí, pretože `á` nie je ASCII `\w`, takže sa za ním
  hranica slova nevytvorí. Override sa potom ticho ignoruje (odpis vyzerá „správne", rez
  je zlý). Použi `(\s|$)` a napíš regresný test nad všetkými názvami z `cfg_seed`.
- **Pretlač to celou cestou:** `parse*` (validácia rozsahu — skriptovaný POST obíde HTML5)
  → `PosuvSpec` → `oversizeCut` (aby dlhý ručný kus padol, nie podhodnotil odpis) →
  `computeFlat`/`computeMulti` → hidden inputy potvrdzovacieho kroku → `job.detail`
  (audit, prečo v odpise sedí toľko metrov).
- **Dôkaz neutrality:** existujúca sada testov musí prejsť BEZ zmeny (prázdne pole =
  pôvodný výpočet) a nový test musí ukázať prípad, kde sa metre naozaj zmenia — inak
  netestuješ nič (dva posuvy 4000 mm: 2 tyče = 15 m → ručne 3600 mm = 1 tyč = 7,5 m).

## 3. Pridanie systému/štýlu (data-driven)

Riadky do `src/lib/server/cfg_seed.json` (systém+štýl+BOM) + idempotentná migrácia
`if (user_version < N)` v `db.ts` + bump verzie. Každý štýl MUSÍ mať presne 2 `typ:'sklo'`
riadky (dim S+V) inak `validSys` vráti null. `dlzkaTyce` len keď ≠7500. Prírez so
vzorcom `(S-a)/N + b` kde `+b` je MIMO delenia → `koef=1/N, offset=b-a/N, delitN=0`
(delitN=1 by `+b` nevyjadril). Exaktné test-vektory over cross-checkom app-FFD == Excel
ROUNDUP; každý ŽIVO-voliteľný štýl musí mať exaktný vektor (nie len smoke).

**N-závislé vzorce → konštanty per štýl:** keďže každý `sysStyl` má FIXNÉ N, každý
N-závislý člen sa poskladá do konštantného `offset` + `pocetKs` per štýl (napr. Štandard +
prírez 2K −147.5 … 6K −247.5, `pocetKs=2N`). Nerob N-aritmetiku v engine.

**Test OBIDVE migračné cesty:** nový systém sa na PRÁZDNEJ DB zoseeduje skorým `<5` blokom
(default `dlzka_tyce=7500`), potom ho v6 `updBar` opraví z cfg_seed (napr. 3600) → fresh
DB konverguje s cfg_seed; na PROD upgrade ceste ho pridá až `vN` blok s `hasSys` guardom
(žiadny dupel). Maj test na OBE (`migration-vN.test.ts` = upgrade, `migration-fresh-db.test.ts`
= fresh) — inak sa rozíde len jedna cesta a CI to nechytí.

**`sysStyl` NIE je vždy `system + '|' + styl`** — od v0.6.34 ho odvodzuje `sysStylPre()`
v `src/lib/styl.ts` (jediný zdroj pravdy pre klienta AJ server): pri **Štandard +** nesie
štýl len počet krídel a basic/IZO nárezák vyberá SKLO (`Izolačné …` → `N IZO`; opona `2x…`
IZO variant nemá). Keď skladáš `sysStyl` na novom mieste (výpočet, b2b limit, filename),
volaj `sysStylPre`, nikdy nelep reťazec ručne — inak sa tá cesta bude riadiť iným nárezákom
než formulár ukazuje. Ponuky do formulára: `stylyDoPonuky` / `sklaDoPonuky` z toho istého
modulu. Ostatné systémy sú 1:1, takže funkcia je bezpečná všade.

**Odvodenie vzorcov z firemných nárezákov (openpyxl, `data_only=False`):** odpisové súbory
(`odpis - …/2k.xlsx`) sú len tenká vrstva `='[1]<hárok>'!$H$<r>*7.5` nad majstrovským zošitom —
`H` je počet tyčí, násobok 7.5/3.6 je dĺžka tyče. Čo z toho vyplýva: **kódy, ktoré v odpisovom
súbore nie sú, do Money nejdú** (aj keď sa režú — napr. kalkulačkové `11016`, `K-M…`), a
**pooling** vidno na `H = ROUNDUP(U18+U21,0)` (dva riadky jedného kódu na spoločné tyče).
V samotnom hárku čítaj blok „Zoznam materiálu" (kód/dĺžka/ks) + „Nápočet dĺžky" (konštanty
`−13`, `−X`, počet sekcií) — z toho vypadne `koef/offset/delitN/pocetKs` priamo.

**Pri opone daj `N = 2 × počet krídel jednej strany`** — potom `(S + offset)/N` vyjadrí
`(S/2 − …)/n` s `koef = 1` a počet skiel vyjde 2n automaticky (tak to má Štandard + aj Štandard).

**Nová migrácia rozbije `user_version` asserty v STARÝCH migračných testoch** — viaceré končia
kontrolou „finálna verzia po všetkých migráciách". Po pridaní `vN+1` ich treba hromadne
posunúť (`toBe(17)` → `toBe(18)`), inak padne ~14 testov naraz a vyzerá to ako regresia.

**Appka reže FFD, zošit počíta po riadkoch — pri POOLOVANOM kóde sa to môže rozísť.** Zošit
zaokrúhli využitie zvlášť za každý riadok a sčíta, appka zmieša kusy jedného kódu na tyč
(napr. Štandard 3K IZO: 6 tyčí = 21,6 m namiesto excelovských 8 = 28,8 m, lebo 948 mm kus sa
zmestí k 2239 mm). To je zámerné (odpisuje sa, čo sa naozaj poreže) a rovnaké vo všetkých
systémoch — ale pri porovnávaní s Excelom to čakaj a povedz to dielni, nech to nevyzerá ako chyba.

## 3c. Zdieľané Money kódy NAPRIEČ systémami — invariant pre pooling

Do Štandard + boli systémy kódovo DISJUNKTNÉ; Štandard + je PRVÝ, čo zdieľa kódy s iným
systémom (5 spodných koľajníc s Deluxe: `ZASP00104/00030/00033/202432/202437`).
`computeMulti` pooluje profily **po kóde** naprieč posuvmi → pri pridaní systému, čo
recykluje existujúci kód, platí INVARIANT: **každý výskyt toho istého kódu (aj v inom
systéme) MUSÍ mať rovnakú `dlzkaTyce`** — inak sa zmiešaná multi-posuv zákazka zbalí na
jednu tyč zle a odpis je nesprávny. (Štandard + zdieľané koľajnice = vždy 7500, OK.)
Pasca navyše (len KRESBA, nie odpis): `sikmyRez` pooled riadku sa nastaví z PRVÉHO posuvu,
takže v zmiešanej Deluxe+Štandard+ zákazke sa uhol rezu koľajnice môže nakresliť podľa
druhého systému. Pri pridaní systému so zdieľaným kódom over dĺžku tyče zhodu + zváž uhol.

## 3b. Atribút vyberá VARIANT článku (bez duplikovania štýlu) — `sklo_hrubka`

Keď VLASTNOSŤ položky (nie štýl) vyberá iný Money kód pri IDENTICKEJ geometrii/množstve,
NErob duplicitný štýl na každú hodnotu. Namiesto toho stĺpec-podmienka na `cfg_rez`:
`sklo_hrubka` (0 = platí vždy, 6/10 = len pre tú hrúbku skla) + `glass_types.hrubka`.
Deluxe: hrúbka SKLA (6/10 mm) vyberá kladkový+klzný profil — 6mm→`ZASP202416`/`ZASP202424`,
10mm→`ZASP202417`/`ZASP202425` (všetko 3600mm tyč, ROVNAKÝ počet, líši sa LEN kód). Koľajnice/
dorazové/sklo sú hrúbko-nezávislé (`sklo_hrubka=0`). `profilCuts` zahrnie riadok iff
`sklo_hrubka===0 || sklo_hrubka===zvolenáHrúbka`. **Pasca:** ak systém MÁ hrúbko-závislé riadky
ale žiaden nesadne na zvolenú hrúbku → tichý PODhodnotený odpis. `missingHrubkaProfile()` v
`safeCompute`/`safeComputeMulti` to odmietne fail-loud PRED oversizeCut. Editor: ukáž len KANONICKÝ
(6mm) riadok, edit zrkadli offset na 10mm dvojča (`baseRole` párovanie) + invariant že 6/10 majú
rovnaký offset — inak by tá istá zákazka písala iné množstvo pre 6 vs 10.

- **Deluxe reže VŠETKO na 90°** (rovný rez) — `sikmyRez=false` pre celý systém Deluxe (server:
  `system !== 'Deluxe' && jeSikmyRez(nazov)`). Robust/Slide majú šikmé (45°) podľa profilu.
- **JS regex gotcha:** `\b` za NEASCII znakom (napr. `Surov[ýy]\b`) nikdy nesadne — `ý` nie je `\w`,
  hranica slova tam neexistuje. `baseRole` preto strip bez `\b`.
- **Over KAŽDÝ rozmer nového systému, nie len vzorec:** rez uhol, obrázky profilov, model skla —
  Dominik/Zbynek našli chyby práve v týchto „okolo-vzorca" veciach, nie v FFD matike.

## 3d. OSTRÁ konfigurácia ≠ cfg_seed — dielňa si ju mení v editore vzorcov

`cfg_seed.json` je len seed; ostrá DB je zdroj pravdy a **dielňa ju edituje sama**
(`/zasklenia/nastavenia`). Pri overovaní „prečo mi ten profil vyšiel 0" NEČÍTAJ len seed —
pozri ostrý stav a **História zmien** na tej stránke (audit `cfg_audit`). Živý prípad:
redukcia 6 mm vychádzala 0 pri IZO skle, lebo `vyroba` si 2026-07-27 zaškrtla nulovanie
pre všetky izolačné sklá (`redukcia_zero` 0→1) — v seede to tak nie je. Pri LIVE overení
Money-relevantnej zmeny preto **vyber sklo/voľby tak, aby daný riadok bol naozaj aktívny**,
inak overuješ nulu a myslíš si, že je to v poriadku.

## 4. Overenie na LIVE appke = len Spočítať / Späť, NIKDY Odoslať

`MONEY_LIVE=1` → „✅ Odoslať odpis do Money" reálne zapíše. Náhľad (Spočítať) a Späť
IBA rátajú, nič nezapíšu. Post-deploy over cez Playwright len náhľadom (čítaj odpis +
rozpis), Odoslať NIKDY neklikaj.

## 5. DISPLAY-ONLY prvky dielne (poznámka, RAL, kovanie, klín, sieťka) — cesta a dôkaz neutrality

Dielňa si pravidelne vyžiada prvok, ktorý „len nech je na pláne" (poznámka, RAL, kovanie
kľučky, klín). Ich cesta je VŽDY tá istá a nikdy nesmie zabočiť do `polozky`:

`formulár → parse*Vstup (validácia rozsahov na SERVERI) → vstup/PosuvVstup → náhľad +
karta plánu (tlač) + jobFor(...).detail` — a **nikdy** `job.polozky` (to je Money .xlsx).
Pri multi-posuve ide prvok cez `PosuvSpec` → `PosuvInfo` len ako prieťah (compute ho
nečíta), aby ho mal náhľad posuvu.

Dva povinné dôkazy, inak sa „display-only" nedá tvrdiť:
- **unit:** `computeMulti` s prvkom a bez neho dá `toEqual` odpis AJ materiál
  (`tests/vstup-klin.test.ts`, `tests/vstup-kovanie.test.ts`).
- **e2e:** to isté zadanie spočítaj bez prvku, odčítaj riadky karty „Odpis (do Money)",
  potom „← Späť a upraviť", zapni prvok, spočítaj znova a riadky musia byť IDENTICKÉ.
  Toto chytí aj chybu, ktorú unit nechytí (napr. keby prvok menil `sysStyl`/voľbu).

**Parametrizuj neutralitu naprieč VŠETKÝMI systémami, ktoré prvok ponúkajú, nie len
jedným (#90, 2026-08-01).** `computeMulti` dnes odovzdáva `sietka`/`klin`/… bez
vetvenia podľa systému, takže jeden systémový vektor v teste vyzerá ako dostatočný
dôkaz — ale to je len ARGUMENT, nie stráž: v momente, keď pribudne systémovo-
špecifická vetva (napr. Slide dostane vlastný zužovací profil pre sieťku, presne
#90), pri jednom otestovanom systéme nič nezačervená. Over si allowlist prvku
(`SIETKA_SYSTEMY`, alebo ekvivalent pre klin/kovanie) a daj `it.each` vektor pre
KAŽDÝ systém v ňom — vektor musí byť platný pre daný systém+štýl (over v existujúcich
testoch, napr. `tests/compute.test.ts`, nevymýšľaj S/V naslepo). Dôkaz, že guard
naozaj chytí regresiu: dočasne priprav sabotáž (fiktívny riadok do odpisu pri danom
systéme+prvku), over RED, vráť späť pred commitom.

**Hidden round-trip:** každý nový display-only vstup MUSÍ ísť aj do snippetu `hiddenVstup`
(pri multi do JSON-u `posuvy`), inak sa pri „Späť a upraviť" / „Odoslať" stratí a plán
zrazu ukazuje niečo iné než formulár. Kryje to e2e „prežije Späť a upraviť".

**Pozor na výhradu:** display-only stav môže šéf otočiť (kovanie: 2026-07-27 najprv
„do Money nejde", o pár hodín „má ísť do Money" → čaká na katalógové kódy + počty ks).
Preto drž prvok v `detail` (zapíše sa do histórie) — keď sa rozhodnutie otočí, dáta
o minulých zákazkách existujú.

**Sieťka (2026-07-31, #86–#90) bola presne tento prípad, VEDOME rozdelená na dve
polovice hneď od začiatku** — a 2026-08-02 dostala Money polovicu (§5b nižšie). Ako
príklad displays-only-najprv postupu ostáva platný: appka najprv postavila len
display-only časť (checkbox, úchyt, 2K upozornenie, `/sietka` bez odpisu — vzor
`/fix`), lebo Money strana chýbala na TROCH miestach naraz (joklík bez karty v
katalógu §2j, kusy/metre nepotvrdené, rozmer nedaný). Keď je dôvod „nemáme dosť
čísel na to, aby appka niečo tvrdila", nevymýšľaj vzorec — nechaj pole na ručné
zadanie a zdokumentuj v komentári na tickete presne to, čo chýba (presne ako
`KlinPolia.svelte` dodnes — klin nikdy nedostal Money polovicu, lebo šéf ju
nechcel).

## 5b. Sieťka = ĎALŠIE krídlo posuvu (KOREKCIA 2026-08-02) — počítadlo kusov, nie nová dĺžka

Keď Patrik doplnil chýbajúce čísla (Odoo #1614821/#1614823/#1614827, kanál 207),
korigoval aj SAMOTNÝ MODEL: sieťka nie je samostatný objekt s ručne zadaným
rozmerom — je to **ĎALŠIE krídlo TOHO ISTÉHO posuvu**, „úplne rovnaký rozmer ako
každé iné okno v tom posuve". Z toho vyplýva vzor, ktorý sa oplatí zopakovať
nabudúce, keď treba pridať „ešte jedno z toho istého":

- **Nepridávaj novú dĺžku rezu — zvýš POČET existujúcich kusov.** Rámový aj nosový
  RezRow už majú presný `koef/offset/kerf` vzorec pre KAŽDÉ krídlo toho sysStyl
  (3K: rám `pocetKs=6` na S aj V = 2 rezy/krídlo × 3 krídla). Sieťka len navýši
  `pocetKs` (`sietkaExtraPocetKs` v `compute.ts`, tesne pred generovaním kusov v
  `profilCuts`) — dĺžka rezu je AUTOMATICKY zhodná s existujúcimi krídlami, lebo
  ju počíta ten istý `val()`. Natvrdo zapísaná dĺžka by sedela len pre JEDEN
  rozmer okna; pri inom S/V by dala tichý zlý odpis.
- **PEVNÁ delta, NIE odvodená z N.** Patrik: „(robust) 2 a 2 rám a 1x nos" — teda
  vždy `+2` rámových rezov (S aj V) a `+1` nosový rez, na jednu sieťku, nezávisle
  od toho, či je posuv 2K/3K/4K. Všeobecný vzorec pre existujúce nosové rezy je
  `2×(N−1)` (over v `cfg_seed.json`: 2K→2, 3K→4, 4K→6) — pre N→N+1 by dal `+2`, nie
  `+1`. Pri konflikte medzi odvodeným vzorcom a Patrikovým explicitným (dvakrát
  zopakovaným) číslom vyhráva PRIAMA ODPOVEĎ, nie symetria vzorca — asymetrická
  fyzická realita (Slide má na strane sieťky úplne INÝ profil miesto zužovacieho,
  #90) je presne to, čo symetrický vzorec nevidí.
- **Kód karty sa vie meniť BEZ zmeny dĺžky rezu — swap kódu, nie prepočet.** 2K
  posuv nemá voľnú koľaj pre 4. krídlo → celá koľajnica (Robust/Slide majú JEDNU
  obvodovú, `rolaKolajnice()===null`) sa mení na 3K variant. 2K aj 3K koľajnica
  majú TOTOŽNÝ vzorec (`koef=1, offset=0, delitN=0`) — mení sa len Money kód/názov,
  nikdy dĺžka. `sietkaKolajnicaSwap` berie 3K kód/názov ŽIVO z `cfg[system+'|3K']`
  (nikdy natvrdo), rovnaký vzor ako `railUpsize` (Štandard + prídavná koľajnica).
- **SAMOSTATNÁ objednávka (#89, `/sietka` bez posuvu) NIE JE diff dvoch výpočtov.**
  Prvý inštinkt — spočítať `computeFlat` s sieťkou a bez nej a poslať rozdiel — je
  fyzicky ZLE: dodatočná sieťka je SAMOSTATNÁ objednávka, ktorú dielňa reže týždne
  po pôvodnej (tá je dávno preč zo skladu, žiadne zdieľané zvyšky tyčí neexistujú).
  Diff by v prípadoch, keď extra kus „padne" do hypotetického zdieľaného zvyšku
  (FFD to robí ticho — pozri nižšie), PODHODNOTIL odpis. Namiesto toho
  `sietkaSamostatnaVypocet` zoberie LEN mesh kusy (2 rám S + 2 rám V + 1 nos, [+2
  koľajnica S + 2 V ak 2K]) a zabalí ich VLASTNÝM čerstvým FFD behom — malá,
  ale samostatná dodávka.
- **FFD delta v ODPISE (metroch) sa nerovná delte v KUSOCH — to je SPRÁVNE, nie
  bug.** Overené naživo (Robust|3K 4645×2320): nos ide zo 4 kusov na 5, ale odpis
  ostáva 15 m v OBOCH prípadoch — 5. kus sa zmestí do zvyšku, ktorý FFD aj tak už
  „stráca" na inej tyči. Test na túto zmenu píš na REZY (`material[].rezy`, kusy —
  vždy deterministicky `+2/+2/+1`), nie na predpokladaný METROVÝ rozdiel — ten
  závisí od konkrétneho S/V a môže vyjsť 0.
- **Rozmer SIEŤOVINY (látky) ≠ rozmer krídla.** Mesh fabric sa objednáva u INÉHO
  dodávateľa a má vlastný malý offset voči sklu bežného krídla: `rozmerSietoviny
  = {sirka: skloS+2, vyska: skloV+1}` (Patrik, potvrdené jeho fotom vlastného
  nárezáka — sklo 1063×1795 → sieťka 1065×1796). Do Money odpisu NEJDE (appka len
  vypíše na tlač) — nepliesť s krídla dĺžkou rezu vyššie (tá je z RÁMOVÉHO profilu,
  nie zo skla). Tento offset je SYSTÉM-ŠPECIFICKÝ, nie univerzálny — Štandard/
  Štandard + majú vlastnú formulu `rozmerSietovinyStandard = {sirka: skloS+3,
  vyska: skloV+3}` (#110, jeho Štandard+ nárezák: sklo 957×1735 → sieťka
  960×1738) — INÁ delta ako Robust/Slide vyššie. Nový systém nikdy nededí túto
  formulu automaticky.

## 5c. Sieťka na ĎALŠOM systéme (#110/#90, 2026-08-03) — keď „počítadlo kusov" prestane stačiť

Keď Štandard/Štandard + dostali sieťku, `sietkaExtraPocetKs`-ov generický regex na
predponu mena (`^R[áa]mov`) prestal stačiť — a pribudla druhá, KOMPLEXNEJŠIA
požiadavka (výber SYSTÉMU sieťky nezávisle od posuvu). Poučenia, ktoré sa oplatí
zopakovať pri ĎALŠOM systéme so sieťkou (alebo inou "delta rolí"):

- **Keď dve role zdieľajú predponu mena, ale MAJÚ inú deltu, regex na predponu
  praská.** Štandardova krajová („Rámový profil Surový…") aj nos („Rámový profil
  **stredový** Surový…") obe začínajú na „Rámov" — Robustov jednoduchý
  `/^R[áa]mov/i → +2` by ich nevedel rozlíšiť (a krajová aj tak potrebuje `+1`,
  nie `+2`). Riešenie: explicitná TABUĽKA rolí per systém (`STANDARD_ROLY` v
  `compute.ts`), s kotveným regexom vrátane negative lookahead tam, kde treba
  vylúčiť dlhší variant (`/^Rámový profil(?! stredový)/i`) — over vždy proti
  VŠETKÝM štýlom (2K–6K + IZO) cez `cfg_seed.json`, nie len proti jednému.
- **Cross-systémová delta (kód, ktorý posuv SÁM nemá) sa nedá vyjadriť ako „+ks
  na existujúci riadok" — treba PRIDAŤ nový riadok.** Keď je sieťka INÉHO
  systému než posuv (Štandard ↔ Štandard +), krajová/dorazová idú s KÓDOM
  cudzieho systému (posuv ich vo vlastnej cfg skupine vôbec nemá). Vzor:
  `mergeExtraCuts` zlúči zoznam `ExtraRez[]` do `ProfilCuts[]` PRED balením —
  rovnaký kód + rovnaký `rozmer` → pripočíta sa do JEDNÉHO `rezy` riadku (nie
  dva riadky s rovnakou dĺžkou vedľa seba — to by nesedelo s tým, ako Money
  nárezák zobrazuje zlúčené počty); iný kód → nový riadok.
- **Delta na už zaokrúhlenú dĺžku ≠ delta na SUROVÚ dĺžku pred zaokrúhlením.**
  Pri kombinácii plus-posuv+starý-sieťka Patrik dal DOSLOVNÉ číslo `942,5 + 16,5
  = 959`. Naivná implementácia (`Math.round(val(...)) + delta`) dá `943 + 16,5 =
  959,5` — o 0,5 mm vedľa, lebo zaokrúhlenie prebehlo PRED pripočítaním delty.
  Správne: `Math.round(val(...) + delta)`. Vždy over PRIAMYM prepočtom
  (spusti `computeFlat`/`computeMulti` v scratch teste a porovnaj s dodaným
  číslom), nikdy nepredpokladaj poradie operácií.
- **Rozšírenie zdieľanej „ktoré systémy majú X" konštanty môže omylom
  sprístupniť INÚ funkciu, ktorá X interpretuje inak.** `SIETKA_SYSTEMY`
  (sieťka NA POSUVE) aj `/sietka` (samostatná sieťka BEZ posuvu, #89) pôvodne
  zdieľali JEDEN zoznam systémov. Rozšírenie o Štandard/Štandard + pre #110 by
  ticho sprístupnilo aj `/sietka`, ktorej VLASTNÝ (jednoduchší) rámový/nosový
  mechanizmus (`sietkaSamostatnaVypocet`) by na Štandarde dal nesprávny počet
  (rovnaká kolízia predpony mena ako vyššie). Fix: dve NEZÁVISLÉ konštanty
  (`SIETKA_SYSTEMY` vs. `SIETKA_SAMOSTATNA_SYSTEMY`) — keď dve funkcie zdieľajú
  gate konštantu, over PRED rozšírením, že OBE funkcie vedia rozšírenú množinu
  spracovať rovnako správne, inak rozdeľ.
- **IZO-only rozšírenie (`Rozširujúci profil`) sa dá vylúčiť „zadarmo" presnosťou
  rolovej tabuľky.** Patrik: „ak pôjde IZO sklo, sieťka ide bez rozširujúceho
  profilu". Namiesto explicitného IZO-gate `if` stačí, že `Rozširujúci profil`
  nesedí na ŽIADNU rolu v `STANDARD_ROLY` (jeho meno nezačína na „Kladkový"/
  „Koncový"/„Rámový profil stredový"/„Dorazová/Dorazový") — IZO variant má
  IDENTICKÉ ostatné role (over v `cfg_seed.json`: krajová/nos/dorazová majú v
  „…IZO" skupine ROVNAKÉ hodnoty ako v základnej), takže presné regexy exkluzívne
  na role automaticky vylúčia len ten JEDEN riadok, ktorý sieťka nemá dostať.

## 5d. `buildPosuvSpec()` — pridávaj NOVÉ pole PosuvSpec TU, nie do `compute()`/`computeMultiFrom()` priamo (#109)

`compute()` (jeden posuv) a `computeMultiFrom()` (viac posuvov) skladali `PosuvSpec`
každý ako VLASTNÝ objektový literál — presne preto sa dalo pridať `sietka` len na
JEDNU z dvoch ciest (§5 vyššie, sieťka bug). Od #109 existuje `buildPosuvSpec()`
(`compute.ts`, vedľa `PosuvSpec`) — **pri pridaní nového poľa do `PosuvSpec` uprav
OBE volania `buildPosuvSpec({...})`** v `+page.server.ts` (jedno v `compute()`,
jedno v `computeMultiFrom()`); TypeScript odmietne skompilovať, kým to neurobíš na
oboch. Jednoposuvová cesta bežne nepotrebuje polia, ktoré sú len pre plán/tlač
(`otvaranie/sklo/kovanieL/kovanieP/kovanieStred/kovanieStredOkno/klin`) — tam sa
píše explicitný `undefined` s komentárom prečo (jobFor číta tie polia priamo z
`vstup`), nie vynechanie poľa.

**Gotcha objavená pri code review #109 (Money-kritické, over si to pri KAŽDOM
podobnom „vynúť oba call-sites" type-trick):** ručne prepísaný „zrkadlový" typ
(`PosuvSpecInput` so všetkými poľami `PosuvSpec` skopírovanými nanovo, len bez
`?`) zatvorí LEN „2 volania sa rozídu" dieru — NIE „`PosuvSpec` a jeho ručne
písaný mirror sa rozídu" dieru. Pridané pole do `PosuvSpec` bez ručného
doplnenia do ručne písaného mirror typu ticho skompiluje (`{...input}` je stále
priraditeľné, lebo nové pole je v `PosuvSpec` voliteľné). Over si to izolovaným
`tsc --strict` repro, nie len čítaním kódu. Fix: mirror typ ODVODIŤ z `keyof
PosuvSpec` mapovaným typom (rozdeliť na povinné/voliteľné kľúče cez `Record<string,
never> extends Pick<T, K> ? never : K`), nie ručne prepísať — vtedy je štruktúrne
nemožné, aby sa mirror rozišiel od zdroja. Tento vzor (jeden vstupný typ so
VŠETKÝMI kľúčmi povinnými, ODVODENÝ nie ručne písaný) je opakovane použiteľný
kdekoľvek appka potrebuje „viac volaní musí zostať v sync s jedným typom".

**Dôkaz Money-identity pri podobnom refaktore (žiadna zmena logiky, len ako sa
skladá vstup):** golden/charakterizačný vitest snapshot cez `nahlad`/`nahladMulti`
(preview akcie — nikdy nezapisujú, ani do TEST priečinka) je lacnejší než
`odoslat`/`odoslatMulti` (žiadna DB dedup ochrana na riešenie) a rovnako platný
dôkaz, lebo obe cesty volajú identický `compute()`/`kovanieFor()`/`jobFor()`.
Commitni snapshot PRED refaktorom (zelený na starom kóde), refaktoruj, over že
ISTÝ istý snapshot prejde bezo zmeny. Vynechaj zo snapshotu `vytvorene` (server
clock) a `cielInfo.dir` (náhodný mkdtemp per beh) — nezávisia od `PosuvSpec`,
inak test padá na čase/ceste behu, nie na dátach.

## 2c. KUSOVÉ položky (kovanie) — iná jednotka, iné pooling pravidlo než profily

Do v0.8.0 odpis poznal len metrážové profily a jednotka v xlsx bola natvrdo `'m'`.
Kovanie (Dominik 2026-07-28) je prvá kusová položka. Čo z toho vyplýva:

- **Jednotka je per položka:** `Polozka.mj?: 'm' | 'ks'`, xlsx píše `o.mj ?? 'm'`. Default
  drží spätnú kompatibilitu — bez `mj` je export bajt na bajt ako predtým (kryté testom
  nad každým riadkom). Money má MJ na karte zásoby; keď sa rozídu, naveze sa zlé množstvo.
- **Kusy sa NEPOOLUJÚ, sčítavajú sa.** Profily naprieč posuvmi zdieľajú tyče (FFD), takže
  2 posuvy ≠ 2× odpis. Kovanie je opak: každý posuv má svoje krídla, takže 2 posuvy = 2×
  kusy. Preto sa kovanie počíta PER POSUV cez `computeFlat` (nie z `computeMulti`, ktorý
  materiál už zlial po kóde) a až potom sa zlúči.
- **Počty odvodzuj z už spočítaného plánu, nie z nového vzorca** (`zakladPoctov`): počet
  krídel = `N` štýlu, počty nosových profilov a súčty dĺžok rámového/nosového/oponového z
  `material[].rezy`. Roly sa poznajú z NÁZVU profilu — tá istá konvencia ako `jeSikmyRez`.
- **Konštanta môže visieť na KOĽAJNICI, nie na štýle.** Rohovník obvodový: „je jedno koľko
  okien na tom je, stále je to tá istá koľajnica" → opona `2x3K` berie počet `3K`. Preto
  `konstPreKolajnicu` + `kolajnicaStylu()`, nie ďalší riadok v mape štýlov.
- **Jeden kód môže mať dve pravidlá naraz.** Slide nemá zvlášť rohovník krídla — `ZASK00037`
  je obvod (podľa koľajnice) AJ 4 ks/krídlo. V tabuľke je dvakrát a `pocitajKomponenty` ho
  zlúči do JEDNÉHO riadku odpisu (dva riadky s tým istým kódom by Money zmiatli).
- **Chýbajúci počet = HLASNÁ chyba, nikdy 0 ks.** Štýl bez konštanty vráti `chyby` a
  `kovanieDoOdpisu` z toho spraví `err`, ktorý zastaví už náhľad. Tichá nula by znamenala,
  že sa kovanie nikdy neodpíše a nikto si to nevšimne — rovnaká disciplína ako
  `oversizeCut` / `missingHrubkaProfile`.
- **Artikel v Money ≠ skladová zásoba.** Kód môže byť v `Artikly_Artikl` (a používateľ ho
  VIDÍ v Katalógu), ale bez riadku v `Sklady_Zasoba` naň nejde zapísať skladový pohyb.
  Pri overovaní kódu sa preto pýtaj na OBE tabuľky; Slide kovanie je kvôli tomu vypnuté
  cez `SLIDE_PRIPRAVENY`. (Diagnóza „ten kód v Money neexistuje" bola kvôli tomuto
  nesprávna — Dominik ho v Katalógu videl.)
- **Vstup, ktorý mení počty, musí prejsť celou cestou** (jednostranná FAB): `parse*Vstup`
  → `Vstup`/`MultiVstup` → `kovanieDoOdpisu` → `job.polozky` + `job.detail` (audit) →
  hidden inputy („Späť a upraviť"). Bez `detail` sa po rokoch nedá zistiť, prečo tá zákazka
  mala polovicu kľučiek.
- **Pasca pri návrate z akcie:** nový kľúč (`kovanie`) pridaj do VŠETKÝCH náhľadových
  vetiev naraz (`nahlad` aj `nahladMulti`). Keď je len v jednej, SvelteKit `ActionData`
  prestane zužovať `form.vstup` a `svelte-check` vysype ~24 chýb v `+page.svelte`, ktoré
  vyzerajú ako chyby úplne inde.
- **E2E beží proti `npm run preview`, čiže proti POSLEDNÉMU BUILDU** — po zmene servera
  spusti `npm run build`, inak testuješ starý kód a márne hľadáš chybu v novom.

## 6. Verzie: `version-check` porovnáva cez `sort -V`, NIE semver

CI gate robí `printf '%s\n%s\n' "$MAIN" "$DEV" | sort -V | tail -1` a žiada, aby najvyššia
bola dev. `sort -V` radí **`0.9.1-dev.1` VYŠŠIE než `0.9.1`** (semver má prerelease nižšie).
Dôsledky, ktoré stáli jeden červený beh:

- **Pred mergom dev→main daj na dev RIADNU verziu** (`0.9.1`), nie `-dev.N`. Značka, ktorú
  main dostane, je tá, čo svieti dielni na dashboarde.
- **Keď sa `-dev.N` raz dostane na main, späť na čistú `0.9.1` sa už nedá** — `sort -V` ju
  považuje za nižšiu. Jediná cesta vpred je ďalšie číslo (`0.9.2`).
- Po merge bumpni dev na ĎALŠIU pracovnú verziu (`0.9.3-dev.1`) — vtedy je `-dev.N` v poriadku,
  lebo je vyššia než release na main.

## 2i. Názov systému, ktorý vidí obsluha, ≠ kľúč konfigurácie

`Štandard +` **nie je len text** — je to `sysStyl` kľúč (`Štandard +|4K IZO`), na ktorom
visia nárezáky v `cfg_seed.json` aj v DB, `b2b-limits.ts` a história odpisov
(`odpis_log.detail`). Premenovanie kľúča rozbije nárezáky aj históriu.

Zobrazovaný názov preto žije samostatne v **`src/lib/system-nazvy.ts`**
(`nazovSystemu` / `nazovSysStyl`). Pravidlá:

- do UI ide `nazovSystemu(...)`, ale `<option value>`, hidden inputy a POST nesú
  **pôvodný kľúč** — inak server dostane názov, ktorý v cfg neexistuje;
- Money `popis` dokladu je `OP : zákazník`, systém neobsahuje ⇒ premenovanie je
  Money-neutrálne. Keby sa doň niekedy systém dopĺňal, MUSÍ ísť kľúč, nie label;
- test `tests/system-nazvy.test.ts` stráži, že sa v `cfg_seed.json` neobjavil kľúč
  s novým zobrazovaným názvom.

**Prečo to nerozbilo existujúce e2e:** Playwright `selectOption('Štandard +')` matchuje
najprv **value**, takže testy, ktoré vyberajú systém, prežijú premenovanie labelu — padnú
len tie, čo asertujú TEXT (`plan-badge`). To je správne rozdelenie: value = kontrakt,
text = kozmetika.

## 2j. Money katalóg: položka bez `Kod` sa NEDÁ odpísať

Pri hľadaní kariet pre novú funkciu (read-only SQL, viď skill `money-readonly-sql`) sa dá
naraziť na položky s **prázdnym `Kod`** — napr. všetkých 24 kariet „Jokel …" (2026-07-31).
Odpis ich riadok identifikuje kódom, takže taká položka je pre appku nepoužiteľná.

⇒ Keď sa hľadá kód pre nový materiál, vždy sa pýtaj aj na `Kod` a prázdne vyhoď zo
zoznamu kandidátov **predtým**, než ich niekomu ponúkneš — inak sa dohodne mapovanie na
kartu, ktorá sa nedá zapísať.
