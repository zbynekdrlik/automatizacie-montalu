---
paths:
  - "src/routes/objednavka-skla/**"
  - "src/lib/server/objednavka-skla.ts"
---

# Objednávka skla — gotchas (#496)

## File upload: server-side extension allowlist + forced MIME

Client-side `accept` attribute on `<input type="file">` is UX only — a forged POST
bypasses it. The server action (`nahratSubor`) enforces `ALLOWED_EXTENSIONS` and ALWAYS
stores `application/octet-stream` as the MIME type. The download endpoint
(`/objednavka-skla/subor/[id]`) serves with `application/octet-stream` regardless of
what was uploaded. This prevents stored XSS from user-uploaded HTML files served from
the app's origin.

**Adding new allowed extensions:** update `ALLOWED_EXTENSIONS` in
`src/routes/objednavka-skla/[zak]/+page.server.ts` AND the `accept` attribute in
`src/routes/objednavka-skla/[zak]/+page.svelte`.

## BODY_SIZE_LIMIT coupling with MAX_SUBOR_VELKOST

`deploy/docker-compose.yml` sets `BODY_SIZE_LIMIT: 1M` (adapter-node). This limits ALL
request bodies including file uploads. `MAX_SUBOR_VELKOST` in `objednavka-skla.ts` is
10 MB. On prod, any upload > 1 MB will get a bare 413 before the action even runs.
**Before enabling glass order file uploads on prod:** raise `BODY_SIZE_LIMIT` in
`docker-compose.yml` to at least `11M`, or lower `MAX_SUBOR_VELKOST` to match.

## Handoff contract for Odoo subdev

The Odoo side reads from two SQLite tables:
- `objednavka_skla` — glass order items (zak, op, modul, dimensions, type, count, rezim)
- `objednavka_skla_subory` — file attachments (polozka_id FK, nazov, data BLOB)

The FK has `ON DELETE CASCADE` — deleting a glass item auto-deletes its files.
`foreign_keys = ON` is set in `db.ts` at connection time.

## Module integration (producers)

The glass order page reads from the `objednavka_skla` table. Items are added via
`pridajSklo()` / `pridajSklaHromadne()` from `src/lib/server/objednavka-skla.ts`.
Each module page (zasklenia, FIX, pergola) needs an action to capture computed glass
into the table after computation. The glass data sources per module:
- Zasklenia: `ComputeResult.sklo: { sirka, vyska, pocet }` + glass type name
- FIX: `FixVykres.polia[]: { sirka, vLavo, vPravo }` + `FixVstup.sklo` + `tvar`
- Pergola: `StrechaSkloVypocet: { sirkaMm, dlzkaMm, pocetTabul, typ }`
