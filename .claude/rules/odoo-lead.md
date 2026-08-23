---
paths:
  - 'src/lib/server/odoo-lead.ts'
  - 'tests/odoo-lead.test.ts'
  - 'tests/dopyt-action-lead.test.ts'
  - 'tests/deploy-compose-env.test.ts'
  - 'deploy/docker-compose.yml'
---

# Odoo CRM lead z dopytu (#278) — XML-RPC, resilience, escapovanie

Verejný dopyt (#277) → `crm.lead` v Montalu Odoo (`erp.montalu.cloud`, db `odoo`).
**FIRE-AND-FORGET** z `dopyt-action` až po pripravení PDF (`queueLeadCreation`,
synchrónny `void` wrapper) — lead NIKDY nezdrží ani nezhodí zákazníkovo PDF.
Credentials LEN z runtime env (`ODOO_LEAD_URL/DB/LOGIN/API_KEY`, na VPS
`/opt/automatizacie-montalu/.env`), chýba ktorákoľvek zo 4 ⇒ feature TICHO vypnutá
(dopyt ostáva pending na neskorší retry). Stav zrkadlenia = stĺpce
`odoo_lead_id`/`odoo_attempts`/`odoo_last_error` na `dopyt` (migrácia v26).

## Runtime env MUSÍ byť aj v compose `environment:` whiteliste (#278 reopened)

`.env` na VPS NESTAČÍ. Docker Compose neforwarduje hostiteľské env automaticky —
premenná sa dostane do `process.env` kontajnera LEN keď je vymenovaná v
`services.app.environment:` v `deploy/docker-compose.yml`. #278 sa reopol práve
preto: `ODOO_LEAD_*` boli v `/opt/automatizacie-montalu/.env`, ale chýbali vo
whiteliste → v kontajneri `env | grep -c '^ODOO_LEAD_'` = 0 → feature ticho vypnutá
(`odoo_attempts=0`). Tvar riadku: `ODOO_LEAD_URL: ${ODOO_LEAD_URL:-}` (interpolácia
z `.env`, prázdny default = konzistentné s "chýba ktorákoľvek ⇒ vypnuté").

**Pravidlo pre KAŽDÝ nový `process.env.FOO` read v serveri:** pridaj `FOO: ${FOO:-}`
do compose `environment:` v tom istom PR, inak je na prode ticho unset. Chránené
štruktúrnym config-guard testom `tests/deploy-compose-env.test.ts` (vzor
`ci-docker-hardening.test.ts`, žiadna yaml dep) — pri pridaní ďalšej env premennej
pridaj asertciu tam.

## Hand-rolled XML-RPC (žiadna npm závislosť)

Node nemá builtin XML-RPC klienta; hotový balík = Tier-0 bundling riziko pod Vite
SSR + adapter-node (rovnaká disciplína ako `log.ts`/`dejavu.ts`). Encoder pokrýva
int/string/bool/struct/array; decoder LEN skalár (int uid/id) + `<fault>` — presne
čo konzumujeme (`authenticate`→uid, `create`→id). Endpointy: `/xmlrpc/2/common`
metóda `authenticate`, `/xmlrpc/2/object` metóda `execute_kw` (args `[values]` →
int id). Transport je INJEKTOVATEĽNÝ (`_setLeadTransport`) → testy mockujú XML-RPC,
žiadna reálna sieť. Fetch má `AbortController` timeout (fire-and-forget nesmie visieť).

## Dvojité escapovanie popisu — `crm.lead.description` je Html pole

Zákaznícke hodnoty (poznámka/miesto/meno) sa v popise HTML-escapujú (`xmlEscape`),
riadky sa delia LITERÁLNYM `<br>`; encoder potom XML-escapuje celý string na drôte.
Takže zákaznícky `<script>` → `&lt;script&gt;` (hodnota Html poľa) → `&amp;lt;script&amp;gt;`
(na drôte) → Odoo dekóduje späť na `&lt;script&gt;` → vykreslí LITERÁLNE, kým `<br>`
ostane reálny zlom riadka. `name` je Char pole → NEescapuje sa (Odoo ho renderuje
ako text, nie HTML). **C0 riadiace znaky (okrem \t\n\r) `xmlEscape` ODSTRÁNI** —
inak crafted `\x0B` v poznámke rozbije celý XML dokument → Odoo fault → poison-pill,
ktorý zožerie `MAX_ATTEMPTS` a vzdá sa (potrebný `// eslint-disable no-control-regex`).

## Resilience — súbeh + retry trigger (kľúčové review nálezy)

- **Súbeh → duplicitný lead:** kým beží async create, riadok má `odoo_lead_id IS NULL`,
  takže paralelný sweep (spustený iným dopytom) by vzal ten istý riadok a vytvoril
  DRUHÝ lead. Rieši in-process `Set` ID-čiek „vo výrobe" — beh je single-process
  (adapter-node), takže Set spoľahlivo serializuje per-dopyt tvorbu. (Multi-instance
  deploy by potreboval DB-level claim so status/timestamp stĺpcom.)
- **Retry sweep beží LEN po ÚSPEŠNOM submite** (úspech = dôkaz, že Odoo je hore) — nie
  po zlyhaní, inak jeden príchod dopytu zožral 2 pokusy a poison-pill riadok rýchlo
  dosiahol MAX. Plus jednorazový ŠTARTOVÝ sweep (`hooks.server.ts` volá
  `runStartupLeadSweep`) zotaví backlog po deploy/restarte (Odoo ožila / env pribudli).
- **Príloha PDF (`ir.attachment`, `res_model=crm.lead`) je BEST-EFFORT:** pád prílohy
  sa LEN zaloguje, lead ostáva vytvorený. Retry cesta regeneruje PDF z uloženej
  konfigurácie (`generatePonukaPdf`, bez pôvodného 3D renderu).

## Money-neutralita — vlastný guard (auto-guard `dopyt-money-safety` NEpokrýva)

`odoo-lead.ts` NEIMPORTUJE money/pergola, NEZAPISUJE do `/data`, payload má NULA cien
(staví sa z `zhrnutieRiadky`, ktoré je bez cien; tranzitívne aj `ponuka-pdf`). Meno
súboru `odoo-lead` neťahá auto-discovery guard `tests/dopyt-money-safety.test.ts`
(regex `dopyt|ponuka`) → má VLASTNÝ statický + runtime Money-guard v
`tests/odoo-lead.test.ts` (scan zdroja + payloadu na `€|EUR|cena|price`).
