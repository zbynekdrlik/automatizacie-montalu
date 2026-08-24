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

# ⚠️ BEST-EFFORT — potvrď názvy tabuliek/stĺpcov live (montalu_ro). Kontrakt aliasov (dlv/zak/op/
# datum/pocetPolozek/popis) je fixný; menia sa len zdrojové tabuľky/stĺpce.
#  - hlavička DLV: číslo dokladu (dlv), DatumVystaveni (datum), PocetPolozek (pocetPolozek),
#    Nazev/Popis (popis) — z verdiktu §0/§2 vieme, že tieto polia na Money DLV existujú.
#  - line-level „zakázka" (zak) + „OP" (op): naša xlsx dáva do stĺpca A „číslo zakázky" (job.zak) na
#    KAŽDÝ riadok a „Popis dokladu" (job.popis, nesie OP) do 1. riadku — v Money to sedí na
#    line-level zakázkovom poli, resp. na hlavičkovom popise. Appka páruje primárne po ZAK (OP je
#    best-effort spresnenie), takže `zak` MUSÍ byť spoľahlivé; ak Money zak nedrží per-line, vytiahni
#    ho z popisu / iného poľa a UPRAV QUERY.
QUERY = """
SELECT
    d.Cislo            AS dlv,
    z.Zakazka          AS zak,
    d.CisloObjednavky  AS op,
    d.DatumVystaveni    AS datum,
    d.PocetPolozek      AS pocetPolozek,
    d.Nazev             AS popis
FROM Sklad_Doklad d
OUTER APPLY (
    SELECT TOP 1 p.Zakazka
    FROM Sklad_PolozkaDokladu p
    WHERE p.Doklad_ID = d.ID AND p.Zakazka IS NOT NULL AND LTRIM(RTRIM(p.Zakazka)) <> ''
) z
WHERE d.Deleted = 0
  AND d.TypDokladu = 'DLV'
  AND d.DatumVystaveni >= DATEADD(day, -%(window)s, CAST(GETDATE() AS date))
  AND (%(automat)s = '' OR d.Create_ID = %(automat)s)
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
