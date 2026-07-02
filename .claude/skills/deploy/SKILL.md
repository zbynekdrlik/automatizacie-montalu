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
