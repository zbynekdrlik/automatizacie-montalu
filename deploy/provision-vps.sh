#!/usr/bin/env bash
set -euo pipefail
#
# deploy/provision-vps.sh — JEDNORAZOVÁ (idempotentná) provizícia VPS pre non-root
# deploy (#256). Spusti RAZ ako ROOT na VPS 167.233.125.9 PRED prvým `deploy@`
# deployom (CI `ci.yml` sa po tomto tickete prihlasuje ako `deploy@`, nie `root@`):
#
#   ssh root@167.233.125.9 'bash -s' < deploy/provision-vps.sh
#
# Idempotentné: opakované spustenie je no-op (user existuje, kľúče sedia, práva sedia).
#
# Robí:
#  1. vytvorí `deploy` usera (/bin/bash) v skupine `docker` — smie spúšťať docker.
#     POZOR (úprimne, review 🔵 #4): členstvo v skupine `docker` je TRIVIÁLNE
#     eskalovateľné na plný host-root (`docker run --user 0 -v /:/host …`), takže toto
#     NIE je skutočná privilege-boundary. Reálny prínos je (a) audit/prehľadnosť a
#     (b) že CI sa neprihlasuje PRIAMO ako root — menšia expozícia root shellu na
#     zdieľanom hoste. Nie „menší blast-radius roota".
#  2. autorizuje EXISTUJÚCI CI deploy kľúč aj pre `deploy` (kópia root authorized_keys —
#     rovnaký pár, žiadna rotácia secretu `VPS_SSH_KEY`),
#  3. prevlastní /opt/automatizacie-montalu na `deploy` (rsync/scp/compose cieľ +
#     deploy-remote.sh + backups).
#  4. povolí `deploy` traverz parent adresára Money CIFS mountov (/opt/n8n/mounts
#     root:deploy 750) — bez toho pre-flight z #270 (stat/ls ako deploy@) zlyhá
#     EACCES na KAŽDOM deployi a javí sa ako „mount nedostupný" (incident 20.8.
#     večer: 700 root:root blokoval deploy@, root proby prechádzali). „Others"
#     zámerne bez prístupu (Money dáta); deploy má VNÚTRI mountov plný prístup
#     už cez mount opts uid=1000.
#
# Vlastníctvo appdata volume + zdieľaných Money mountov (uid 1000 = node) tento skript
# NErieši — rieši ho idempotentne `migrate_ownership` v `deploy-remote.sh` pri KAŽDOM
# deployi (a po prvom deployi je stav ustálený). Záložný cron (#253) beží ďalej ako root
# a `docker exec`-om nie je dotknutý (root obchádza práva na deploy-vlastnených súboroch).

DEPLOY_USER="${DEPLOY_USER:-deploy}"
APP_DIR="${APP_DIR:-/opt/automatizacie-montalu}"

if [ "$(id -u)" -ne 0 ]; then
	echo "Spusti ako root (potrebné na useradd/usermod/chown)." >&2
	exit 1
fi

# 1. deploy user + docker skupina --------------------------------------------------
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
	useradd --create-home --shell /bin/bash "$DEPLOY_USER"
	echo "vytvorený user $DEPLOY_USER"
else
	echo "user $DEPLOY_USER už existuje"
fi
usermod -aG docker "$DEPLOY_USER" # idempotentné (opakované pridanie do skupiny je no-op)
echo "$DEPLOY_USER v skupinách: $(id -nG "$DEPLOY_USER")"

# 2. autorizuj CI kľúč pre deploy — MERGE (dedup) root authorized_keys do deploy ----
# Skript nepozná, KTORÝ z root kľúčov je CI kľúč (VPS_SSH_KEY má len CI, tu ho nevidíme),
# tak zoberie CELÚ root sadu — deploy tak akceptuje ten istý pár bez rotácie secretu.
# MERGE + `sort -u` (nie prepis): re-run NEPREPÍŠE ručne pridané deploy kľúče a
# neduplikuje (review 🔵 #3 — pôvodný `install` prepisoval a klobroval deploy kľúče).
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
DEPLOY_AK="$DEPLOY_HOME/.ssh/authorized_keys"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
if [ -f /root/.ssh/authorized_keys ]; then
	# prvý beh na čerstvom hoste — deploy authorized_keys ešte neexistuje (install -d
	# vytvoril len adresár); pod `set -euo pipefail` by chýbajúci súbor v `cat` (exit 1,
	# stderr potlačený) cez pipefail zhodil celý skript. Založ ho (prázdny) vopred.
	[ -f "$DEPLOY_AK" ] || install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /dev/null "$DEPLOY_AK"
	TMP_AK="$(mktemp)"
	cat /root/.ssh/authorized_keys "$DEPLOY_AK" 2>/dev/null | sort -u >"$TMP_AK"
	install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$TMP_AK" "$DEPLOY_AK"
	rm -f "$TMP_AK"
	echo "autorizované kľúče zmergované z /root/.ssh/authorized_keys (dedup, bez prepisu)"
else
	echo "VAROVANIE: /root/.ssh/authorized_keys neexistuje — pridaj CI pubkey do" \
		"$DEPLOY_AK ručne, inak deploy@ SSH zlyhá" >&2
fi

# 3. prevlastni deploy pracovný adresár (rsync/scp/compose/backups cieľ) ------------
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
echo "prevlastnené $APP_DIR na $DEPLOY_USER"

# 4. traverz parentu Money CIFS mountov pre pre-flight (#270) ----------------------
MOUNTS_PARENT="${MOUNTS_PARENT:-/opt/n8n/mounts}"
if [ -d "$MOUNTS_PARENT" ]; then
	chgrp "$DEPLOY_USER" "$MOUNTS_PARENT"
	chmod 750 "$MOUNTS_PARENT"
	echo "traverz $MOUNTS_PARENT: root:$DEPLOY_USER 750 (pre-flight stat/ls ako $DEPLOY_USER)"
else
	echo "VAROVANIE: $MOUNTS_PARENT neexistuje — Money CIFS mounty nie sú nastavené?" >&2
fi

echo "hotovo — VPS pripravený na non-root deploy@ (over: ssh $DEPLOY_USER@VPS 'docker ps')."
