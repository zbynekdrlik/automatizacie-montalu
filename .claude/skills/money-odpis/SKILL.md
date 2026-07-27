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

## 4. Overenie na LIVE appke = len Spočítať / Späť, NIKDY Odoslať

`MONEY_LIVE=1` → „✅ Odoslať odpis do Money" reálne zapíše. Náhľad (Spočítať) a Späť
IBA rátajú, nič nezapíšu. Post-deploy over cez Playwright len náhľadom (čítaj odpis +
rozpis), Odoslať NIKDY neklikaj.
