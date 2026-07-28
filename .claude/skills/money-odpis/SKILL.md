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

## 5. DISPLAY-ONLY prvky dielne (poznámka, RAL, kovanie, klín) — cesta a dôkaz neutrality

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

**Hidden round-trip:** každý nový display-only vstup MUSÍ ísť aj do snippetu `hiddenVstup`
(pri multi do JSON-u `posuvy`), inak sa pri „Späť a upraviť" / „Odoslať" stratí a plán
zrazu ukazuje niečo iné než formulár. Kryje to e2e „prežije Späť a upraviť".

**Pozor na výhradu:** display-only stav môže šéf otočiť (kovanie: 2026-07-27 najprv
„do Money nejde", o pár hodín „má ísť do Money" → čaká na katalógové kódy + počty ks).
Preto drž prvok v `detail` (zapíše sa do histórie) — keď sa rozhodnutie otočí, dáta
o minulých zákazkách existujú.

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
