# Deploy + post-deploy verifikácia

## Ako sa nasadzuje

- Merge do `main` → CI job `deploy`: rsync zdrojov na VPS `167.233.125.9:/opt/automatizacie-montalu/src`, `docker compose up -d --build` (build beží NA VPS z committed ref), health check musí vrátiť `"ok":true` + SHA nasadeného commitu vo verzii.
- Compose: `/opt/automatizacie-montalu/docker-compose.yml` (kopíruje sa z `deploy/docker-compose.yml`). Kontajner `automatizacie-montalu`, port `127.0.0.1:8090`, sieť `n8n_default` (kvôli Caddy).
- Runtime env: `/opt/automatizacie-montalu/.env` — `SEED_USERS`, `MONEY_LIVE`. NIE v gite; heslá sú v lokálnej memory agenta.
- Verejný prístup: Caddy vhost `app.montalu.cloud` v `/opt/n8n/Caddyfile` → `automatizacie-montalu:3000`. Po zmene Caddyfile: `docker exec n8n-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.
- SSH: `ssh -i ~/.ssh/n8n_montalu_ed25519 root@167.233.125.9`.

## CIFS „Host is down" — mŕtvy bind-mount = deploy fail-fast (#270)

Deploy (`deploy-remote.sh`) má **pre-flight krok**: pred akýmkoľvek recreate spraví `stat` +
`ls` každého host bind-mount zdroja z compose; pri nedostupnom mounte deploy **HLASNE zlyhá
PRED recreate** a starý kontajner ostáva bežať (prod UP). To znamená: keď CI deploy padne s
`::error::pre-flight … bind-mount zdroj '…' nedostupný`, prod NIE JE dole — treba len oživiť
mount a re-runnúť deploy. (Incident kolo 9: bez pre-flightu recreate zabil bežiaci kontajner a
rollback zlyhal na tom istom mŕtvom mounte → 502 ~12 min.)

**Dotknuté mounty** — táto appka bindne **2 CIFS** host mounty (`/opt/n8n/mounts/dlv-import`,
`/opt/n8n/mounts/montalu`; kontajner `/data/dlv-import`, `/data/montalu`) + lokálny
`/opt/automatizacie-montalu/ceny` (`:ro`, NIE CIFS). Pre-flight kontroluje všetky 3 bind
zdroje, ale „Host is down" sa týka len tých 2 CIFS. **`n8n-n8n-1` bindne tie isté CIFS host
mounty** (+ `dlv-done`, ktorý táto appka nepoužíva) — mŕtvy CIFS mount teda zasiahne aj n8n,
nie len túto appku.

**Diagnostika (na VPS `root@167.233.125.9`):**

```bash
findmnt -rn -o TARGET,SOURCE,FSTYPE | grep cifs     # ktoré CIFS mounty existujú + zdroj
stat /opt/n8n/mounts/dlv-import /opt/n8n/mounts/montalu   # mŕtvy → chyba/„Host is down"/visí
dmesg | tail -30                                    # CIFS reconnect: STATUS_LOGON_FAILURE = prechodný, nie zlé creds
```

**Over, že creds sú platné** (mŕtvy mount ≠ zlé heslo — pri „Host is down" je zvyčajne len
výpadok servera): namontuj TÝM ISTÝM cred súborom do temp adresára:

```bash
mkdir -p /tmp/smbtest
mount -t cifs //192.168.1.200/dlv-import /tmp/smbtest -o credentials=/etc/n8n-smb.cred,ro
ls /tmp/smbtest && umount /tmp/smbtest     # prejde → creds OK, pôvodný mount len treba reconnectnúť
```

**Obnova:**

- **Soft mounty sa reconnectnú SAMY**, keď sa server vráti — často stačí počkať a re-runnúť
  deploy (`gh run rerun --failed` alebo `gh workflow run ci.yml --ref main`).
- Ak je mount **stále mŕtvy** aj po návrate servera: `umount -l /opt/n8n/mounts/<x>` (lazy, aj
  keď je „busy") + `mount -a` (remount z `/etc/fstab`). Až POTOM re-run deploy.
- **NIKDY** neriešiť mŕtvy mount cez rollback/redeploy appky — kým je mount dole, ani nový, ani
  starý image nenaštartuje (to je celý #270). Najprv mount, potom deploy.

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
- **Lokálna PRED-deploy E2E (bez `BASE_URL`) vs post-deploy (s `BASE_URL`):** post-deploy beh hore ide proti ŽIVEJ appke cez tunel → `webServer` je `undefined`, žiadny lokálny build. Lokálne overenie zmeny PRED deployom (`npx playwright test` bez `BASE_URL`) používa `webServer`, ktorý si `build/` **SÁM zbuilduje** pred `preview` (guard `E2E_PREBUILT`, #298 5. kolo) — netreba ručný `npm run build`. Detaily: `.claude/rules/testing.md`.

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

## Záloha DB (`odpis_log` dedup ledger) — #253

DB (`/data/app/app.db`, named volume `appdata`) beží vo **WAL** móde → surová kópia
je nekonzistentná. Záloha ide cez SQLite **online backup API** (better-sqlite3 v
kontajneri) BEZ prerušenia appky.

- Skript: `deploy/backup.sh` (v repo). Na VPS nainštalovaný ako
  `/opt/automatizacie-montalu/backup.sh` (`chmod 700`, root).
- Tok: `flock` (zámok proti súbežnému behu) → `docker exec automatizacie-montalu node -e
  "…better-sqlite3(app.db,{readonly}).backup(/tmp/app-TS.db)"` → `PRAGMA integrity_check`
  (cez node, žiadny host `sqlite3`) → `docker cp` von → `gzip` do `…/app-TS.db.gz.part` →
  `gzip -t` (overenie) → atomický `mv` na finálny `.gz` v `/opt/automatizacie-montalu/backups/`
  (MIMO volume) → rotácia `find -mtime +14 -delete`. Fail loudly (`set -euo pipefail` + trap,
  exit ≠ 0); `.part` + atomický `mv` = na disku nikdy nezostane useknutý „platne vyzerajúci" `.gz`.
- Cron (root): `30 3 * * * /opt/automatizacie-montalu/backup.sh >/dev/null 2>&1`
  (n8n záloha beží o 03:00, táto 03:30). Log: `/var/log/automatizacie-montalu-backup.log`
  (skript loguje sám cez `tee`). **Sledovanie zlyhaní:** skript pri chybe zapíše
  `logger -p user.err -t automatizacie-backup` do journald (nezávislé na cron výstupe) →
  `journalctl -t automatizacie-backup -p err` ukáže zlyhané behy; bohatší alert (MAILTO /
  n8n webhook / healthcheck.io) je voliteľné rozšírenie (viď #253 „voliteľne n8n alert neskôr").
- Ručný beh + dôkaz: `/opt/automatizacie-montalu/backup.sh` → v logu `integrity_check: ok`
  + `Záloha vytvorená`. Env prepíšeš cez `BACKUP_DIR=… BACKUP_RETENTION_DAYS=… …`.

**Aktualizácia skriptu na VPS** (po zmene `deploy/backup.sh` v repo): NIE je súčasťou
CI deployu — treba ho prescp-núť ručne:
```bash
scp -i ~/.ssh/n8n_montalu_ed25519 deploy/backup.sh root@167.233.125.9:/opt/automatizacie-montalu/backup.sh
ssh -i ~/.ssh/n8n_montalu_ed25519 root@167.233.125.9 'chmod 700 /opt/automatizacie-montalu/backup.sh'
```
(CI rsync ho síce prinesie aj do `/opt/automatizacie-montalu/src/deploy/backup.sh`, ale
cron zámerne beží nad koreňovou kópiou, nie nad `src/`.)

### Restore postup (bez host `sqlite3`)

Obnova prepíše ŽIVÚ DB — je to deštruktívna operácia, rob ju len na pokyn a s istotou,
ktorú zálohu chceš. Kroky:
```bash
SSH="ssh -i ~/.ssh/n8n_montalu_ed25519 root@167.233.125.9"
# 1) vyber zálohu a rozbaľ na hoste
$SSH 'ls -la /opt/automatizacie-montalu/backups/'
$SSH 'gunzip -c /opt/automatizacie-montalu/backups/app-YYYYmmdd-HHMM.db.gz > /root/restore.db'
# 2) over integritu rozbaleného súboru (cez node v kontajneri — skopíruj dnu a skontroluj)
$SSH 'docker cp /root/restore.db automatizacie-montalu:/tmp/restore.db'
$SSH 'docker exec automatizacie-montalu node -e "const d=require(\"better-sqlite3\")(\"/tmp/restore.db\",{readonly:true}); console.log(d.pragma(\"integrity_check\",{simple:true})); console.log(\"odpis_log\", d.prepare(\"SELECT count(*) c FROM odpis_log\").get().c); d.close();"'
# 3) STOP app (deštruktívne — pýtaj si súhlas), nahraď súbor vo volume, zmaž WAL/SHM zvyšky
$SSH 'cd /opt/automatizacie-montalu && docker compose stop app'
# named volume je project-prefixovaný (automatizacie-montalu_appdata) — odvoď zdroj z mountov
# kontajnera (funguje aj na zastavenom kontajneri, robustné voči prefixu); `cat >` zachová
# vlastníka existujúceho súboru (na rozdiel od `cp`, keby raz pribudol USER v Dockerfile):
$SSH 'VOL=$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"/data/app\"}}{{.Source}}{{end}}{{end}}" automatizacie-montalu); cat /root/restore.db > "$VOL/app.db"; rm -f "$VOL/app.db-wal" "$VOL/app.db-shm"'
# 4) START app a over /health
$SSH 'cd /opt/automatizacie-montalu && docker compose up -d app'
```
Poznámka: krok 3 (`docker compose stop`) je jediná časť, ktorá appku preruší — bez neho
by bola obnova nekonzistentná; robí sa LEN pri reálnom restore, nie pri zálohovaní.

## Non-root kontajner + non-root deploy user (#256)

Kontajner beží ako **`USER node` (uid 1000)** a **CI deploy sa prihlasuje ako `deploy@`**
(non-root, v skupine `docker`), nie `root@`. (Manuálny admin prístup nižšie — backup scp,
restore — používa admin kľúč `root@` ďalej; menil sa LEN CI deploy účet.)

### Jednorazová provizícia VPS — PREREKVIZITA pred prvým `deploy@` deployom

`deploy/provision-vps.sh` (idempotentný root skript) MUSÍ zbehnúť RAZ na VPS predtým, než
CI po tomto tickete prvýkrát deployne ako `deploy@`:

```bash
ssh -i ~/.ssh/n8n_montalu_ed25519 root@167.233.125.9 'bash -s' < deploy/provision-vps.sh
```

Vytvorí `deploy` usera v skupine `docker`, autorizuje EXISTUJÚCI CI kľúč (kópia
`/root/.ssh/authorized_keys` — **žiadna rotácia `VPS_SSH_KEY`**) a prevlastní
`/opt/automatizacie-montalu` na `deploy`. Ak sa zabudne, CI SSH krok zlyhá HLASNE PRED
dotykom kontajnera → prod ostane na aktuálnej verzii (bezpečné).

### Vlastníctvo volumes (uid 1000) — automatické pri každom deployi

`deploy-remote.sh` volá `migrate_ownership` (`docker compose run --user 0`) PRED `up`:
`appdata` `/data/app` `-R 1000:1000`, `/data/dlv-import` koreň nerekurzívne (dir-write
stačí na create/delete, neprepisuje n8n súbory), `NA ODPIS` podstrom `-R`. `ceny` `:ro` sa
netýka. Idempotentné + self-healing; chyba len `::warning::` (health poll + rollback je
backstop). Detaily a UNVERIFIED (n8n uid = predpoklad 1000; prvý reálny odpis) → `.claude/rules/ci.md`.

**Pridávaš NOVÝ perzistentný volume (app doň zapisuje)? Použi NAMED volume, nie bind mount (#297).**
`deploy-remote.sh preflight_mounty` `stat`-ne KAŽDÝ host bind-mount zdroj PRED recreate — chýbajúci
adresár (napr. prvý deploy) ⇒ deploy sa NEvykoná (prod-down riziko). `mount_sources_from_compose`
berie len zdroje začínajúce `/` (bind-mounty), **named volumes (ľavá strana = meno, bez `/`) PRESKOČÍ**
⇒ named volume je preflight-safe, nemôže zhodiť pipeline. Vzor (money-audit `moneylog:/data/money-log`):
(1) `docker-compose.yml`: `- moneylog:/data/money-log` + top-level `moneylog:`; (2) `Dockerfile`
`RUN mkdir -p /data/money-log && chown node:node /data/money-log` PRED `USER node` — čerstvý prázdny
named volume zdedí owner node:node z image adresára pri prvom mounte (non-root uid 1000 vie zapísať);
(3) obranný `migrate_ownership` riadok `if [ -d /data/... ]; then chown -R 1000:1000 /data/...; fi`.
Bind mount použi LEN keď owner potrebuje súbor priamo na hoste (`/opt/...`) a adresár vytvor
deklaratívne PRED preflightom (nie ručný ssh mkdir).

### Overenie po nasadení (acceptance #256)

```bash
DEPLOY="ssh -i ~/.ssh/n8n_montalu_ed25519 deploy@167.233.125.9"
$DEPLOY 'docker exec automatizacie-montalu id'                 # uid=1000(node)
$DEPLOY 'docker exec -u node automatizacie-montalu sh -c "touch /data/dlv-import/.probe && rm /data/dlv-import/.probe && echo WRITE_OK"'
$DEPLOY 'docker inspect --format "{{.Config.User}}" $(docker ps -qf name=n8n | head -1)'  # over n8n uid (predpoklad node/1000)
```
Prvý reálny produkčný odpis sleduj v `odpis_log` + súbor v `/data/dlv-import`.
