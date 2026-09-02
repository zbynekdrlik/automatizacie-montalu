---
paths:
  - 'src/lib/server/odoo-rpc.ts'
  - 'src/lib/server/odoo-zakazka.ts'
  - 'tests/odoo-rpc.test.ts'
  - 'tests/odoo-zakazka.test.ts'
  - 'tests/odpis-written-hook.test.ts'
---

# Interný zoznam materiálu zákazky → Odoo `sale.order` log-note (#340)

> **#5824 — /json/2 seam:** RPC ide cez `OdooBackend` (`odoo-backend.ts`) — json2 (`ODOO_URL`+
> `ODOO_API_KEY`) prednostne, inak XML-RPC fallback (`ODOO_LEAD_*`, `odoo-rpc.ts` nezmenené). Leak
> kontrakt (`mt_note`/`comment`/`partner_ids=[]`/žiadny `email_from`) je testovaný na OBOCH wire
> (XML-RPC aj json2). XML-RPC odstránenie = go-live follow-up #5891.

## Odoo mapovanie (overené na PROD, read-only handover účtom)

- **Zákazky žijú v `sale.order`** (~22 tis.). Potvrdená objednávka má `name` = číslo
  objednávky z Money: `OP260439` / `OPDL260206`; ponuky sú `PVxxxxxx`.
  `project.project`/`mrp.production` sú prázdne — nie sú kandidáti.
- Odpis appky nesie `zak` (číslo **zákazky**, `ZAK…`) AJ `op` (**objednávka**). Money
  ich drží striktne oddelene (zámena = chyba). **`sale.order.name === normOp(op)`** je
  deterministický match na objednávku (`normOp` dá `OP<číslice>`, zachová `OPDL…`).
- **Účet appky = uid 64, login `support@winknod.sk`, „WEB"** — TEN ISTÝ `ODOO_LEAD_*`
  účet, čo tvorí `crm.lead`. Skupina **„Sales / User: All Documents"** → smie čítať/písať
  `sale.order` a postovať interné log-note. Žiadne extra práva netreba.
- **`mail.mt_note` má `internal=true`** → log-note viditeľná LEN interným Odoo
  používateľom, NIKDY portál/e-mail/tlač/zákazník. To je JEDINÁ dokázateľná
  neúniková garancia — custom pole (napr. `x_interna_poznamka`) NIE (jeho viditeľnosť
  závisí od každého view/reportu). „Interné" = VŠETCI interní (Sales), nie len šéf.

## Customer-leak kontrakt (tvrdá podmienka — pri zmene NEPORUŠ)

`message_post(subtype_xmlid='mail.mt_note', message_type='comment', partner_ids=[])`,
BEZ `email_from`/notif kwargov. `partner_ids=[]` = žiadny follower/notifikácia. Interné
ceny (predaj/nákup) smú ísť LEN do tejto log-note. Test to stráži POZITÍVNE (kwargy sú)
aj NEGATÍVNE (žiadny `email_from`/`subtype_id`/neprázdny `partner_ids`).

## Architektúra

- **`odoo-rpc.ts` = zdieľaný low-level XML-RPC klient** (encoder + scalar/**array**/fault
  decoder + injektovateľný transport + `authenticate`/`executeKw`/`createRecord` +
  `odooConfig` z `ODOO_LEAD_*`). Používa ho `odoo-lead.ts` AJ `odoo-zakazka.ts` — NIKDY
  neduplikuj encoder. `odoo-lead` drží starú plochu cez aliasy (`_setLeadTransport` atď.).
- **Money-neutrálny OBSERVER, nie import-cyklus.** `writeOdpis` (money.ts) po ÚSPEŠNOM
  zápise (`status:'written'`, PO commite + durable rename) zavolá `onOdpisWritten?.(zak,op)`
  cez `setOdpisWrittenHook`. Registruje ho composition root `hooks.server.ts`
  (`setOdpisWrittenHook(queueZakazkaPush)`) — money.ts NEIMPORTUJE Odoo (žiaden cyklus,
  money-neutrálne). Volanie je sync-guarded — observer NIKDY nezhodí zapísaný odpis.
- **Dvojvrstvové escapovanie HTML tela** (rovnako ako `crm.lead.description`): dynamické
  HODNOTY `xmlEscape`-ni (→ `&lt;script&gt;`), ŠTRUKTÚRNE tagy nechaj literálne; encoder
  celé telo raz XML-escapuje na drôte, Odoo raz dekóduje → tagy prežijú, hodnoty text.
- **Rozšíriteľnosť:** `ZakazkaNote.sekcie[]` (typované). Sklá z nárezákov = ĎALŠIA sekcia,
  bez zmeny štruktúry.
## Durable retry + startup sweep (#349 — nadväzuje na #340)

`#340` bol fire-and-forget: prechodný výpadok Odoo sa self-heal-ne na ĎALŠOM odpise
zákazky, no výpadok pri POSLEDNOM odpise = note sa nikdy nedopostol (len zalogoval).
`#349` to spravil DURABLE:

- **Tabuľka `odoo_zakazka_push`** (migrácia v34), PK `(zak_norm, op_norm)`: `pending`,
  `attempts`, `last_error`, `posted_at`, `created_at`, `updated_at`. DB vrstva je
  `odoo-zakazka-store.ts` (vzor `dopyt-store.ts`, importuje LEN `db` + čisté
  `normZak/normOp` → Money-neutrálne, vlastný guard test).
- **Retry NEUKLADÁ telo note — RE-DERIVUJE** aktuálny snapshot cez `pushZakazkaToOdoo`
  (note je re-derivovateľný → „posledný vyhráva" je inherentné; uložené telo by postlo
  STARŠÍ stav). Tá istá cesta = jediné `message_post` (`mt_note`), takže retry NEMÔŽE
  rozbiť leak-kontrakt.
- **Stavový automat:** `posted` → pending=0, attempts=0, posted_at; `failed` (Odoo/sieť)
  → pending=1, attempts+1 (poison-pill `MAX_ATTEMPTS=5`); `no-order` (objednávka ešte nie
  je v Odoo) → pending=1 ale attempts sa NEZVYŠUJE; `missing` (odpis medzitým uvoľnený)
  → terminálny pending=0.
- **`created_at` = začiatok AKTUÁLNEJ pending epizódy, nie prvý-ever insert** (review 🟡):
  upsert ho resetuje LEN pri prechode 0→1 (`CASE WHEN pending = 0 THEN datetime('now')
  ELSE created_at END`). Bez toho by `expireStaleZakazkaPushes` na starom riadku hneď
  „expiroval" čerstvé zlyhanie zákazky bežiacej mesiace.
- **Časový strop (90 dní), nie attempts, pre no-order zombie:** arrival sweep beží podľa
  nesúvisiacej aktivity, takže attempts by nemeral čas; `expireStaleZakazkaPushes` po
  strope prepne pending=0 (label neutrálny `expired`).
- **Súbeh (zadanie bod 4):** per-kľúč promise-chain `serializeByKey` (`Map<key,tail>`,
  tail-compare cleanup, `then(task,task)` handluje rejection predchodcu). Skip-in-flight
  (#278) je tu NEBEZPEČNÝ (stratí dáta neskoršieho odpisu). Sweep aj arrival idú cez ten
  istý serializer + `sweepInFlight` guard + re-check `isPendingZakazkaPush` v tasku.
- **Sweep triggers:** arrival po ÚSPEŠNOM pushi (dôkaz že Odoo je hore, #278) +
  `runStartupZakazkaSweep()` v `hooks.server.ts` (po migráciách, no-op keď chýba env).
  Accepted residual: bez periodického timera pending riadok čaká na ďalší deploy/úspešný
  push (deploy = reštart, per-ticket; interná log-note = nízka cena zastarania).

## Odoo 19 XML-RPC pasce (pri prieskume handover účtom)

- `res.users` pole je **`group_ids`**, nie `groups_id` (Odoo 19 premenované).
- Handover účet NEČÍTA `ir.model.access` ani `ir.model.data` (treba „Access Rights") —
  skupinovú príslušnosť over cez `res.users.group_ids` → `res.groups.full_name`.
- `search` vracia pole intov → decoder MUSÍ vedieť `<array>` (0 zhôd = `[]` → preskoč,
  nie pád); `message_post`/`create` vracajú skalár.
