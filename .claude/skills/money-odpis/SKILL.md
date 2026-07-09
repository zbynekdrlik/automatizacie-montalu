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

## 4. Overenie na LIVE appke = len Spočítať / Späť, NIKDY Odoslať

`MONEY_LIVE=1` → „✅ Odoslať odpis do Money" reálne zapíše. Náhľad (Spočítať) a Späť
IBA rátajú, nič nezapíšu. Post-deploy over cez Playwright len náhľadom (čítaj odpis +
rozpis), Odoslať NIKDY neklikaj.
