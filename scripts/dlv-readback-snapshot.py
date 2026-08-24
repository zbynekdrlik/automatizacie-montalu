#!/usr/bin/env python3
"""POST-import readback DLV — READ-ONLY snapshot nedávnych Money dokladov (#298).

Vypíše JSON `{generatedAt, rows:[{dlv, zak, op, datum, pocetPolozek, popis}]}` pre
nedávne Money DLV (dodacie listy) vytvorené automatickým importom. Appka
(`src/lib/server/money-readback.ts`) tento súbor sama LAZY naimportuje a on-the-fly
overí, že pre každý LIVE odpis existuje DLV s `PocetPolozek == počet odoslaných riadkov`
— nesúlad = viditeľný alarm na /odpisy (Money pri neznámom kóde ticho zahodí CELÝ doklad,
verdikt §3 / Dominik). Tento skript do appkinej DB nič nezapisuje.

Beží MIMO appky, tam kde je Money dosiahnuteľné (dev2), ROVNAKÝM kanálom ako
`scripts/ceny-snapshot.py`: `money-ro-thirdparty` SSH tunel + `montalu_ro` SQL účet
(db_datareader + db_denydatawriter — žiadny zápis možný). Credentials žijú LEN na dev2
(`MONEY-READONLY-PRISTUP.md`, mimo git) — NIKDY sem nekopíruj heslo.

Použitie (tunel MUSÍ bežať — tento skript ho sám neotvára):

    ssh -i money-ro-thirdparty -N -L 11433:192.168.1.200:1433 root@<jump-host> &
    export MONEY_SQL_PASSWORD='<z MONEY-READONLY-PRISTUP.md>'
    # zapíš do TMP a atomicky premenuj — `> file.json` by pri páde producera zanechal skrátený/
    # prázdny súbor (appka to prežije cez parse-error + staré dáta, ale radšej write-temp-then-rename):
    python3 scripts/dlv-readback-snapshot.py > /path/dlv-readback.json.tmp && mv /path/dlv-readback.json.tmp /path/dlv-readback.json

Cieľ na VPS (rsync): `/opt/automatizacie-montalu/ceny/dlv-readback.json` (appka číta
`DLV_READBACK_PATH`, default `/data/ceny/dlv-readback.json`). Nasadenie ako cron na dev2
(PO ceny-snapshote) je PROVISIONING krok — viď design komentár tiketu #298.

Okno: číta doklady za posledných `DLV_WINDOW_DAYS` (default 30) — MUSÍ byť ≥ appkino
readback okno (`READBACK_WINDOW_S`, 30 dní), inak by appka pri chýbajúcom (mimo-okno)
doklade hlásila falošný alarm; appka je proti tomu poistená (starší odpis = „neoverené",
nie alarm), ale okná drž zhodné.

⚠️ SCHÉMA NEOVERENÁ (na rozdiel od ceny-snapshot.py, ktorý má stĺpce overené live): presné
Money tabuľky/stĺpce DLV hlavičky + line-level „zakázka" NIE SÚ overené z tohto workera
(nemá Money prístup). `QUERY` nižšie je BEST-EFFORT — pri nasadení POTVRĎ/UPRAV live proti
`montalu_ro` (viď PROVISIONING v #298). Kontrakt výstupného JSON-u (nižšie) je FIXNÝ; ladí
sa len SQL. Skript preskočí riadok bez `dlv`/`zak`/`pocetPolozek` (nezhodí sa).
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone

try:
    import pymssql  # type: ignore
except ImportError:
    print(
        "chýba pymssql — nainštaluj: pip install pymssql (na PEP-668 boxoch "
        "'pip install --break-system-packages pymssql')",
        file=sys.stderr,
    )
    raise

# Účet automatického importu (verdikt §2: Create_ID ' automatic', GUID 467d0e89…). Doklady vytvorené
# ľuďmi (ručný import skladu) NEsú náš odpis — filtrujeme na automat, nech readback nepáruje cudzie DLV.
AUTOMAT_CREATE_ID = os.environ.get("MONEY_AUTOMAT_CREATE_ID", "")  # prázdne = bez filtra na tvorcu

# ✅ LIVE-OVERENÉ 2026-08-24 (montalu_ro, read-only tunel) — pozri PROVISIONING #298. Money je
# Money S5 (Solitea/Seyfor) s table-per-concrete-type modelom: `EconomicBase_Doklad` je PRÁZDNA
# abstraktná báza (0 riadkov); reálne dodacie listy vydané žijú v konkrétnej tabuľke
# `SkladovyDoklad_DodaciListVydany` (1809 riadkov, ~56/30dní, doklady „DLV20251409…", aktívne dnes).
#  - hlavička DLV: `CisloDokladu` (dlv, tvar „DLV…"), `DatumVystaveni` (datum, date-only), `PocetPolozek`
#    (pocetPolozek), `Nazev` (popis; nesie OP, napr. „OP260387 - BT hause fix").
#  - „zakázka" (zak): hlavičkové `Zakazka_ID` je pri AUTOMATICKOM importe NULL (193/195 dokladov) —
#    ZAK žije LINE-LEVEL v `SkladovyDoklad_PolozkaDodacihoListuVydaneho.Zakazka_ID` (FK →
#    `Ciselniky_Zakazka.Kod`, tvar „ZAK2026450"). Line ↔ hlavička cez `Parent_ID = d.ID` (overené:
#    počet riadkov cez Parent_ID == PocetPolozek). Každý DLV má PRÁVE JEDNU zakázku (distinctZak=1),
#    takže OUTER APPLY TOP 1 je presné. Appka páruje LEN po `zak_norm` (`WHERE zak_norm = ?`), preto
#    `zak` MUSÍ byť spoľahlivé — a je (z line zakázky). DLV bez line-zakázky sa v producerovi preskočí.
#  - „OP" (op) = '' (PRÁZDNE, zámerne): appkin `compat` páruje `(!c.opNorm || !o.opNorm || c.opNorm ===
#    o.opNorm)` — NEsprávny op by spravil reálny DLV NEkompatibilným → FALOŠNÝ „chýba doklad" alarm.
#    Nazev nesie OP v nekonzistentnom tvare (OP260387 vs OPDL260182), ktorý sa nedá zaručene zladiť s
#    appkiným `op_norm`, takže prázdny op (= appka ho ignoruje) je bezpečná a správna voľba; párovanie
#    stojí na ZAK + počte-v-pásme + exkluzívnom greedy (OP je len best-effort spresnenie). `popis` (Nazev)
#    nesie OP pre ľudské zobrazenie.
#  - AUTOMAT filter: `Create_ID = 467d0e89-dade-40c7-b0e4-f07adc3afc85` (verdikt §2, LIVE overené:
#    193/195 nedávnych DLV je od tohto účtu; 2 ručné vynechá — cudzí DLV nesmie falošne overiť odpis).
QUERY = """
SELECT
    d.CisloDokladu      AS dlv,
    zak.Kod             AS zak,
    ''                  AS op,
    d.DatumVystaveni    AS datum,
    d.PocetPolozek      AS pocetPolozek,
    d.Nazev             AS popis
FROM SkladovyDoklad_DodaciListVydany d
OUTER APPLY (
    SELECT TOP 1 zk.Kod
    FROM SkladovyDoklad_PolozkaDodacihoListuVydaneho p
    JOIN Ciselniky_Zakazka zk ON zk.ID = p.Zakazka_ID
    WHERE p.Parent_ID = d.ID AND p.Deleted = 0 AND p.Zakazka_ID IS NOT NULL
) zak
WHERE d.Deleted = 0
  AND d.DatumVystaveni >= DATEADD(day, -%(window)s, CAST(GETDATE() AS date))
  AND (%(automat)s = '' OR LOWER(CONVERT(varchar(50), d.Create_ID)) = LOWER(%(automat)s))
"""


def _connect(retries: int = 5, delay_s: float = 20.0):
    """Money bridge vie byť flaky (~25 % — viď deploy skill / dispatch #298). Rovnaká retry
    disciplína ako ceny-snapshot.py (5×, 20 s)."""
    host = os.environ.get("MONEY_SQL_HOST", "127.0.0.1")
    port = int(os.environ.get("MONEY_SQL_PORT", "11433"))
    user = os.environ.get("MONEY_SQL_USER", "montalu_ro")
    password = os.environ.get("MONEY_SQL_PASSWORD", "")
    database = os.environ.get("MONEY_SQL_DATABASE", "S4_Agenda_MONT_ALUSro")
    if not password:
        print(
            "MONEY_SQL_PASSWORD nie je nastavené — heslo je v MONEY-READONLY-PRISTUP.md "
            "(mimo git), nikdy ho sem nezapisuj natvrdo.",
            file=sys.stderr,
        )
        sys.exit(2)
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            return pymssql.connect(
                server=host,
                port=port,
                user=user,
                password=password,
                database=database,
                login_timeout=10,
                timeout=30,
            )
        except Exception as e:  # noqa: BLE001 — chceme retry na AKÚKOĽVEK chybu spojenia
            last_err = e
            print(f"pripojenie na Money zlyhalo (pokus {attempt}/{retries}): {e}", file=sys.stderr)
            if attempt < retries:
                time.sleep(delay_s)
    raise RuntimeError(f"Money nedosiahnuteľné po {retries} pokusoch") from last_err


def _txt(v: object) -> str:
    return "" if v is None else str(v).strip()


def _iso(v: object) -> str | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%dT%H:%M:%S")
    return str(v).strip() or None


def fetch_rows(conn, window_days: int) -> list[dict]:
    cur = conn.cursor(as_dict=True)
    cur.execute(QUERY, {"window": window_days, "automat": AUTOMAT_CREATE_ID})
    rows = []
    for r in cur.fetchall():
        dlv = _txt(r.get("dlv"))
        zak = _txt(r.get("zak"))
        pocet = r.get("pocetPolozek")
        # riadok bez dlv/zak/pocetPolozek je nepoužiteľný na párovanie → preskoč (nezhoď snapshot)
        if not dlv or not zak or pocet is None:
            continue
        try:
            pocet_i = int(pocet)
        except (TypeError, ValueError):
            continue
        rows.append(
            {
                "dlv": dlv,
                "zak": zak,
                "op": _txt(r.get("op")),
                "datum": _iso(r.get("datum")),
                "pocetPolozek": pocet_i,
                "popis": _txt(r.get("popis")),
            }
        )
    rows.sort(key=lambda x: x["dlv"])
    return rows


def main() -> None:
    window_days = int(os.environ.get("DLV_WINDOW_DAYS", "30"))
    conn = _connect()
    try:
        rows = fetch_rows(conn, window_days)
    finally:
        conn.close()
    out = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        # appka si podľa toho zaklampuje readback okno na min(app, producer) — kratšie producer okno
        # inak spôsobí falošné „chýba doklad" (#298 review).
        "windowDays": window_days,
        "rows": rows,
    }
    json.dump(out, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    print(f"dlv-readback: {len(rows)} DLV za posledných {window_days} dní", file=sys.stderr)


if __name__ == "__main__":
    main()
