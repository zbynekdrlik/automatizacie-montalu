#!/usr/bin/env python3
"""Cenový zoznam materiálu — fáza 1 (#154): READ-ONLY denný snapshot z Money.

Vypíše JSON `{generatedAt, rows:[{kod, nakupCennik, nakupPoslednaFaktura,
predajVo, mena, sklad}]}` pre všetky ZASP*/ZASK*/TS* Money kódy (profily +
komponenty/kovanie zasklenia + izolačné sklá, #235). Appka tento
súbor sama LAZY naimportuje (`src/lib/server/ceny.ts`) — tento skript do
appkinej DB nič nezapisuje a do appky sa nijako nenapája.

Beží MIMO appky, tam kde je Money dosiahnuteľné (dev1, alebo hocijaký box,
odkiaľ sa dá otvoriť read-only tunel). Money access = `money-ro-thirdparty`
SSH kľúč + `montalu_ro` SQL účet (db_datareader, žiadny zápis možný) — plný
návod v montalu/n8n repe: `.claude/skills/money-readonly-sql/SKILL.md` +
`MONEY-READONLY-PRISTUP.md` (obe mimo git, nikdy sem nekopíruj heslo).

Použitie (tunel MUSÍ bežať — tento skript ho sám neotvára):

    ssh -i money-ro-thirdparty -N -L 11433:192.168.1.200:1433 root@<jump-host> &
    export MONEY_SQL_PASSWORD='<z MONEY-READONLY-PRISTUP.md>'
    python3 scripts/ceny-snapshot.py > /path/na/rsync/ceny.json

Stĺpcové mapovanie (overené live 2026-08-13, TOP 5 smoke query — presne sedí so
šéfovým príkladom "5,80 € dohodnutý cenník vs 7,02 € posledná faktúra", viď
design komentár na tikete #154):

  nakupCennik            Ceniky_PolozkaCeniku.Cena, Cenik_ID = NC "Nákupný cenník";
                          pre TS* (sklá, MJ = m²) z cenníka IZOS — sklá v NC vôbec
                          nie sú (overené live 2026-08-19, 0 TS riadkov v NC,
                          141 v IZOS; IZOS je EUR), viď tiket #235
  nakupPoslednaFaktura   Artikly_ArtiklDodavatel.PosledniCena (cez HlavniDodavatel_ID)
  predajVo               Ceniky_PolozkaCeniku.Cena, Cenik_ID = PRF_VO "Profily a
                          príslušenstvo - VO" (appka sama vynúti null pre ZASK*
                          kódy — defense in depth, viď ceny.ts)
  sklad                  S5_Artikl_CelkoveMnozstviNaSkladech.CelkoveDostupneMnozstviNaSkladech

`Cena = 0` v Money reálne znamená "nikdy zadané" (overené na viacerých aktívnych
ZASP kódoch) — appka (ceny.ts) preto 0 aj tak číta ako "neznáma"; tento skript
posiela SUROVÚ hodnotu z Money (0 alebo číslo), interpretáciu robí appka.
"""
from __future__ import annotations

import decimal
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

# Price-book GUID-y (Ceniky_Cenik.ID) — overené live 2026-08-13. Nikdy neodvodzuj
# nanovo z Kod/Nazev pri behu (mohli by pribudnúť podobne pomenované price-booky) —
# tieto ID-čka sú overené presne proti šéfovým príkladovým číslam.
CENIK_NC = "BA7DA0F8-8086-4963-AAE1-09D2C1C7266C"  # Nákupný cenník
CENIK_PRF_VO = "AEEF5C92-5B44-4755-8680-F01CE6E4D5C2"  # Profily a príslušenstvo - VO
CENIK_IZOS = "F4A1DFEE-9298-45D2-9891-1548741B2063"  # IZOS (izolačné sklá TS*, ceny/m²)

QUERY = """
SELECT
    a.Kod AS kod,
    CASE WHEN a.Kod LIKE 'TS%' THEN iz.Cena ELSE nc.Cena END AS nakupCennik,
    ad.PosledniCena AS nakupPoslednaFaktura,
    vo.Cena AS predajVo,
    ISNULL(m.Kod, 'EUR') AS mena,
    s.CelkoveDostupneMnozstviNaSkladech AS sklad
FROM Artikly_Artikl a
LEFT JOIN Artikly_ArtiklDodavatel ad ON ad.ID = a.HlavniDodavatel_ID
LEFT JOIN Ceniky_PolozkaCeniku nc ON nc.Artikl_ID = a.ID AND nc.Cenik_ID = %(nc)s AND nc.Deleted = 0
LEFT JOIN Ceniky_Cenik ncc ON ncc.ID = nc.Cenik_ID
LEFT JOIN Ceniky_PolozkaCeniku vo ON vo.Artikl_ID = a.ID AND vo.Cenik_ID = %(vo)s AND vo.Deleted = 0
LEFT JOIN Ceniky_Cenik voc ON voc.ID = vo.Cenik_ID
LEFT JOIN Ceniky_PolozkaCeniku iz ON iz.Artikl_ID = a.ID AND iz.Cenik_ID = %(iz)s AND iz.Deleted = 0
LEFT JOIN Ceniky_Cenik izc ON izc.ID = iz.Cenik_ID
LEFT JOIN Meny_Mena m ON m.ID = COALESCE(ncc.Mena_ID, voc.Mena_ID, izc.Mena_ID)
LEFT JOIN S5_Artikl_CelkoveMnozstviNaSkladech s ON s.Artikl_ID = a.ID
WHERE a.Deleted = 0 AND (a.Kod LIKE 'ZASP%' OR a.Kod LIKE 'ZASK%' OR a.Kod LIKE 'TS%')
"""


def _connect(retries: int = 5, delay_s: float = 20.0):
    """Money bridge vie byť flaky (viď deploy skill) — rovnaká retry disciplína
    ako `sync-profil-obrazky.sh` (5×, 20s)."""
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


def _num(v: object) -> float | None:
    if v is None:
        return None
    if isinstance(v, decimal.Decimal):
        return float(v)
    return float(v)  # type: ignore[arg-type]


def fetch_rows(conn) -> list[dict]:
    cur = conn.cursor(as_dict=True)
    cur.execute(QUERY, {"nc": CENIK_NC, "vo": CENIK_PRF_VO, "iz": CENIK_IZOS})
    rows = []
    for r in cur.fetchall():
        kod = (r.get("kod") or "").strip()
        if not kod:
            continue
        rows.append(
            {
                "kod": kod,
                "nakupCennik": _num(r.get("nakupCennik")),
                "nakupPoslednaFaktura": _num(r.get("nakupPoslednaFaktura")),
                "predajVo": _num(r.get("predajVo")),
                "mena": (r.get("mena") or "EUR").strip() or "EUR",
                # #154 review nález: `None` (LEFT JOIN na S5_Artikl_... bez zhody —
                # Money pre tento kód vôbec nemá skladovú kartu) MUSÍ ostať `null` v
                # JSON-e, nie skolabovať na 0.0 — appka 0 zobrazuje ako reálnu (aj
                # keď nulovú) dostupnosť, nie ako "neznáme". `or 0.0` by tieto dva
                # stavy nerozoznateľne zmiešalo.
                "sklad": _num(r.get("sklad")),
            }
        )
    rows.sort(key=lambda x: x["kod"])
    return rows


def main() -> None:
    conn = _connect()
    try:
        rows = fetch_rows(conn)
    finally:
        conn.close()
    out = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rows": rows,
    }
    json.dump(out, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    print(f"ceny-snapshot: {len(rows)} riadkov (ZASP*/ZASK*/TS*)", file=sys.stderr)


if __name__ == "__main__":
    main()
