#!/usr/bin/env bash
set -euo pipefail
#
# deploy/backup.sh — konzistentná denná záloha SQLite DB (odpis_log dedup ledger).
#
# PREČO online backup (nie `cp`): DB beží vo WAL móde, takže `-wal` súbor drží
# nezapísané stránky — surová kópia samotného `app.db` je nekonzistentná. SQLite
# online backup API (cez better-sqlite3, ktoré JE v kontajneri) urobí konzistentný
# snapshot vrátane WAL BEZ prerušenia bežiacej appky. Žiadna host závislosť na
# `sqlite3` CLI (na hoste nie je) — všetko cez `docker exec node`.
#
# Mechanizmus (viď #253): online backup do /tmp v kontajneri → integrity_check
# (rovnaký mechanizmus) → docker cp von → gzip do BACKUP_DIR (MIMO volume) →
# rotácia RETENTION_DAYS. Fail loudly: `set -euo pipefail` + trap, non-zero exit
# pri akejkoľvek chybe.
#
# Inštalácia na VPS: scp na /opt/automatizacie-montalu/backup.sh, chmod 700,
# root crontab denne 03:30 (viď .claude/skills/deploy/SKILL.md → Záloha DB).

# --- konfig (env-prepísateľné kvôli testom / prenositeľnosti) ----------------
CONTAINER="${BACKUP_CONTAINER:-automatizacie-montalu}"
DB_PATH="${BACKUP_DB_PATH:-/data/app/app.db}"
BACKUP_DIR="${BACKUP_DIR:-/opt/automatizacie-montalu/backups}"
LOG_FILE="${BACKUP_LOG_FILE:-/var/log/automatizacie-montalu-backup.log}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
LOCK_FILE="${BACKUP_LOCK_FILE:-/var/lock/automatizacie-montalu-backup.lock}"

# --- logovanie: skript je sebestačný (loguje aj bez cron redirectu) ----------
mkdir -p "$BACKUP_DIR"
touch "$LOG_FILE"                      # zlyhá hneď (set -e), ak je log nezapísateľný
exec > >(tee -a "$LOG_FILE") 2>&1      # stdout+stderr do terminálu AJ do logu

log() { printf '%s [backup] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fail() { log "CHYBA: $*"; exit 1; }

# --- zámok proti súbežnému behu (manuálny beh vs cron, alebo beh > 24 h) ------
exec 9>"$LOCK_FILE"
flock -n 9 || { log "Iný beh zálohy už prebieha ($LOCK_FILE) — končím."; exit 1; }

# --- pracovné cesty ----------------------------------------------------------
TS="$(date '+%Y%m%d-%H%M%S')"
NAME="app-${TS}.db"
IN_CONTAINER_PATH="/tmp/${NAME}"       # /tmp v kontajneri — NEdotýka sa volume
HOST_TMP="$(mktemp "${TMPDIR:-/tmp}/${NAME}.XXXXXX")"
FINAL="${BACKUP_DIR}/${NAME}.gz"

cleanup() {
	rm -f "$HOST_TMP" "${FINAL}.part"
	docker exec "$CONTAINER" rm -f "$IN_CONTAINER_PATH" 2>/dev/null || true
}
on_exit() {
	local rc=$?
	cleanup
	if [ "$rc" -ne 0 ]; then
		log "Skript skončil s chybou (exit $rc)"
		# alert nezávislý na cron výstupe (journald) — aby zlyhanie nočnej zálohy nezapadlo
		logger -p user.err -t automatizacie-backup "záloha ZLYHALA (exit $rc) — pozri $LOG_FILE" 2>/dev/null || true
	fi
}
trap 'log "ZLYHANIE: príkaz zlyhal (exit $?, riadok $LINENO)"' ERR
trap on_exit EXIT

log "Štart zálohy: kontajner=$CONTAINER db=$DB_PATH -> $FINAL"

# 1) online backup vnútri kontajnera (better-sqlite3 .backup() = konzistentné pod WAL)
docker exec "$CONTAINER" node -e '
  const src = process.argv[1], dest = process.argv[2];
  const db = require("better-sqlite3")(src, { readonly: true });
  db.backup(dest)
    .then(() => { db.close(); process.exit(0); })
    .catch((e) => { console.error("backup zlyhal:", String(e)); process.exit(1); });
' "$DB_PATH" "$IN_CONTAINER_PATH"

# 2) integrity_check zálohy (rovnaký mechanizmus, žiadna host závislosť)
INTEGRITY="$(docker exec "$CONTAINER" node -e '
  const db = require("better-sqlite3")(process.argv[1], { readonly: true });
  const r = db.pragma("integrity_check", { simple: true });
  db.close();
  process.stdout.write(String(r));
' "$IN_CONTAINER_PATH")"
[ "$INTEGRITY" = "ok" ] || fail "integrity_check zálohy zlyhal: $INTEGRITY"
log "integrity_check: ok"

# 3) skopíruj MIMO volume a zabaľ (gzip) — píš do .part, over gzip -t, až potom atomický mv
docker cp "${CONTAINER}:${IN_CONTAINER_PATH}" "$HOST_TMP"
gzip -c "$HOST_TMP" > "${FINAL}.part"
gzip -t "${FINAL}.part" || fail "gzip verifikácia (gzip -t) zlyhala: ${FINAL}.part"
mv "${FINAL}.part" "$FINAL"            # zverejni finálny .gz až po overení (žiadny useknutý artefakt)
docker exec "$CONTAINER" rm -f "$IN_CONTAINER_PATH"
SIZE="$(du -h "$FINAL" | cut -f1)"
log "Záloha vytvorená: $FINAL ($SIZE)"

# 4) rotácia — zmaž zálohy staršie ako RETENTION_DAYS dní
DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'app-*.db.gz' -mtime +"$RETENTION_DAYS" -print -delete | wc -l)"
log "Rotácia: zmazaných $DELETED záloh starších ako $RETENTION_DAYS dní"

log "Hotovo."
