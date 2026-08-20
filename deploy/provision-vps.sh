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
#  1. vytvorí `deploy` usera (/bin/bash) v skupine `docker` — smie spúšťať docker
#     (de-facto container-root, ale NIE host-root: menší blast-radius kompromitácie CI
#     kľúča na zdieľanom hoste + čistejší audit ako priamy root login),
#  2. autorizuje EXISTUJÚCI CI deploy kľúč aj pre `deploy` (kópia root authorized_keys —
#     rovnaký pár, žiadna rotácia secretu `VPS_SSH_KEY`),
#  3. prevlastní /opt/automatizacie-montalu na `deploy` (rsync/scp/compose cieľ +
#     deploy-remote.sh + backups).
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

# 2. autorizuj CI kľúč pre deploy (kópia root authorized_keys — rovnaký pár) --------
DEPLOY_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/.ssh"
if [ -f /root/.ssh/authorized_keys ]; then
	install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
		/root/.ssh/authorized_keys "$DEPLOY_HOME/.ssh/authorized_keys"
	echo "autorizované kľúče skopírované z /root/.ssh/authorized_keys"
else
	echo "VAROVANIE: /root/.ssh/authorized_keys neexistuje — pridaj CI pubkey do" \
		"$DEPLOY_HOME/.ssh/authorized_keys ručne, inak deploy@ SSH zlyhá" >&2
fi

# 3. prevlastni deploy pracovný adresár (rsync/scp/compose/backups cieľ) ------------
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
echo "prevlastnené $APP_DIR na $DEPLOY_USER"

echo "hotovo — VPS pripravený na non-root deploy@ (over: ssh $DEPLOY_USER@VPS 'docker ps')."
