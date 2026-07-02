# Deploy + post-deploy verifikácia

## Ako sa nasadzuje

- Merge do `main` → CI job `deploy`: rsync zdrojov na VPS `167.233.125.9:/opt/automatizacie-montalu/src`, `docker compose up -d --build` (build beží NA VPS z committed ref), health check musí vrátiť `"ok":true` + SHA nasadeného commitu vo verzii.
- Compose: `/opt/automatizacie-montalu/docker-compose.yml` (kopíruje sa z `deploy/docker-compose.yml`). Kontajner `automatizacie-montalu`, port `127.0.0.1:8090`, sieť `n8n_default` (kvôli Caddy).
- Runtime env: `/opt/automatizacie-montalu/.env` — `SEED_USERS`, `MONEY_LIVE`. NIE v gite; heslá sú v lokálnej memory agenta.
- Verejný prístup: Caddy vhost `app.montalu.cloud` v `/opt/n8n/Caddyfile` → `automatizacie-montalu:3000`. Po zmene Caddyfile: `docker exec n8n-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.
- SSH: `ssh -i ~/.ssh/n8n_montalu_ed25519 root@167.233.125.9`.

## Post-deploy E2E (funkčná verifikácia)

```bash
# tunel — port NAJPRV over (ss -tlnp | grep <port>), 8091 je obsadený presenterom!
ssh -f -N -L 18091:127.0.0.1:8090 -i ~/.ssh/n8n_montalu_ed25519 root@167.233.125.9
BASE_URL=http://localhost:18091 E2E_USER=marek E2E_PASS=<z memory> npx playwright test
```

Gotchy (stáli hodiny, nezabudni):

- **CSRF 403 pri priamom prístupe:** appka má `PROTOCOL_HEADER`/`HOST_HEADER` (beží za Caddy) — priamy POST bez `x-forwarded-proto`/`x-forwarded-host` dostane 403. Playwright config ich pri `BASE_URL` posiela sám (`extraHTTPHeaders`); pri curl teste ich pridaj ručne.
- **Zápisové E2E sa auto-preskočia, keď `/health` hlási `live:true`** — testovací odpis nesmie do ostrého Money. Neobchádzať.
- **`workers: 1` je zámer** — editor test dočasne mení vzorce; paralelné testy by videli cudzie čísla.
- E2E artefakty: testovacie xlsx ostávajú v TEST priečinku (`/data/montalu/.../ODPIS EXPORT/`) a dedup riadky v `odpis_log` (live=0) — neškodné, dajú sa uvoľniť cez /odpisy.

## LIVE prepnutie (LEN na pokyn užívateľa)

`MONEY_LIVE=1` v `/opt/automatizacie-montalu/.env` + `docker compose up -d` (recreate). Od toho momentu ide odpis do `/data/dlv-import` (Money reálne importuje). Pred flipom: skontroluj, že v `odpis_log` nie sú TEST riadky s reálnymi číslami zákaziek (live stĺpec ich aj tak oddeľuje — dedup TEST riadky ostré zákazky NEblokujú).

## E2E hydratačná pasca (stála polhodinu debugovania — nezabudni)

`fill()`/`check()` PRED dokončenou hydratáciou Svelte stráca hodnoty value-bound
inputov (hydratácia ich vráti na serverový stav). Cez pomalý SSH tunel sa JS
načítava neskoro → padá to LEN proti nasadenej appke, v CI nikdy. Riešenie je
zabudované: layout nastavuje `html[data-hydrated="1"]` a E2E používa
`goto()`/`waitHydrated()` z `e2e/helpers.ts` po KAŽDOM full-page load
(navigácia aj POST odpoveď) pred fill/check. Nový spec = použi tie helpery.

## Money katalóg — obrázky/rezy profilov a priamy SQL prístup

Money (Solid S4, MSSQL na 192.168.1.200) je dosiahnuteľný LEN cez most na hoste
**montalu-prod** = `erp.montalu.cloud`. SSH kľúč `~/.ssh/slovnormal_odoo`
(`root@erp.montalu.cloud`) tam má plný shell; `/opt/montalu-sync/venv` +
`moneydb` modul (`/opt/montalu-sync/scripts/import-montalu/moneydb.py`) robia
read-only SQL. `moneydb.connect()` sa pripája na agendu `S4_Agenda_MONT_ALUSro`
(POZOR: bez podčiarkovníka `S4_Agenda_MONTALUSro` je iná/stará agenda).

- **Rezy profilov** = prílohy artiklov: DB `S4_Agenda_MONT_ALUSro_Doc`,
  `System_Attachment.FileImage` (varbinary JPEG/PNG) ⟶ prepojené cez
  `System_ObjectAttachmentLink` (`Object_Name='Artikl'`, `Object_ID` = ID
  artikla) na `Artikly_Artikl` (match podľa `.Kod`). ~752 našich kódov má
  obrázok; rezy sú v „RENDRE PROFILOV PRE SKLAD V REZE".
- **Obnovenie obrázkov v appke:** `scripts/sync-profil-obrazky.sh` (stiahne pre
  kódy z compute modulov, optimalizuje na webp do `static/profil/`, potom ručne
  aktualizuj `PROFIL_S_OBRAZKOM` v `src/lib/profil-obrazky.ts`).
- **Money bridge je flaky** (SQL server 192.168.1.200 občas „Adaptive Server
  unavailable", ~25 % — to je aj nález auditu): VŽDY retry (5×, 20 s) okolo
  každého SQL behu. Ten istý flaky bridge používa n8n „Denný prehľad platieb".
- **paid-orders / order-map** = hotové príkazy mosta (`/opt/money-bridge/dispatch.sh`
  cez `SSH_ORIGINAL_COMMAND`) — n8n ich volá SSH nodom; nové read-only dotazy
  spustíš vlastným .py cez `venv/bin/python`.
