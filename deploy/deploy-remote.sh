#!/usr/bin/env bash
set -euo pipefail
# Rollback-safe deploy — beží NA VPS, volaný cez SSH z ci.yml deploy jobu (#254).
#
# Rollback = natívny Docker image re-tag (žiadna custom orchestrácia, žiadna dep):
#   1. odchytí ID práve bežiaceho image (`docker inspect` kontajnera) PRED `up`,
#   2. `docker compose build` (compose ho otaguje na IMAGE:current) + durable IMAGE:<sha7>,
#   3. `up -d` + forward health poll (ok:true + SHA7 vo verzii),
#   4. pri zlyhaní `up -d` ALEBO health polla → re-tag odchyteného prev ID späť na
#      IMAGE:current + `up -d` + rollback poll (len liveness) → job padne (exit 1) s logmi.
#
# Rollback SA robí LEN pri zlyhaní deployu (`up -d` sa nepodaril, alebo health poll
# nesedí). Zlyhanie post-deploy E2E (samostatný krok v ci.yml PO úspešnom health)
# rollback NEvyvolá — nová verzia je live a zdravá, E2E zlyhanie je alarm, nie dôvod
# vrátiť zdravý build.
#
# Plne env-riadené kvôli testovateľnosti (tests/deploy-remote.test.ts mockuje
# `docker`/`curl` na PATH): SHA7, APP_VERSION, COMPOSE_DIR, CONTAINER, IMAGE,
# HEALTH_URL, POLL_TRIES, POLL_SLEEP, KEEP_IMAGES.

: "${SHA7:?SHA7 je povinný (skrátený deployovaný commit)}"
: "${APP_VERSION:?APP_VERSION je povinný}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/automatizacie-montalu}"
CONTAINER="${CONTAINER:-automatizacie-montalu}"
IMAGE="${IMAGE:-automatizacie-montalu}"
SERVICE="${SERVICE:-app}" # názov compose služby (pre migrate_ownership `compose run`)
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8090/health}"
POLL_TRIES="${POLL_TRIES:-20}"
POLL_SLEEP="${POLL_SLEEP:-3}"
KEEP_IMAGES="${KEEP_IMAGES:-5}" # koľko najnovších :sha7 obrazov ponechať (retencia)
STAT_TIMEOUT="${STAT_TIMEOUT:-10}"                  # bounded timeout na stat/ls host bind-mount zdroja (mŕtvy CIFS visí) — #270
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"  # relatívne k COMPOSE_DIR (po cd) — pre-flight z neho odvodí bind-mount zdroje (#270)
# APP_VERSION/SHA7 exportujeme raz → `docker compose` (child) ich zdedí bez opakovania
# inline prefixu na každom volaní.
export APP_VERSION SHA7

cd "$COMPOSE_DIR"

# poll_health <mode>: "sha" = forward deploy (vyžaduje ok:true AND SHA7 vo verzii),
# "live" = rollback (stačí ok:true — starý build má iný SHA). Návrat 0 pri úspechu.
poll_health() {
	local mode="$1" h
	for _ in $(seq 1 "$POLL_TRIES"); do
		sleep "$POLL_SLEEP"
		h="$(curl -s --max-time 5 "$HEALTH_URL" || true)"
		echo "health: $h"
		# tolerantné na medzeru za dvojbodkou (`"ok": true`) pre prípad zmeny serializéra
		if echo "$h" | grep -qE '"ok":[[:space:]]*true'; then
			if [ "$mode" = "live" ]; then
				return 0
			elif echo "$h" | grep -qF "$SHA7"; then
				return 0
			fi
		fi
	done
	return 1
}

# Bounded retencia :sha7 obrazov — ponechaj IMAGE:current + KEEP_IMAGES najnovších
# :sha7 obrazov, staršie odstráň. SCOPED na náš IMAGE (žiadny system-wide `docker
# image prune`, lebo VPS zdieľa Docker s n8n/Caddy). Nikdy nezlyhá deploy (|| true;
# rmi bežiaceho/`:current` obrazu zlyhá neškodne).
prune_stare_obrazy() {
	docker images "$IMAGE" --format '{{.ID}} {{.Tag}}' 2>/dev/null |
		awk '$2 != "current" && $2 != "<none>" {print $1}' |
		tail -n "+$((KEEP_IMAGES + 1))" |
		xargs -r -n1 docker rmi 2>/dev/null || true
}

# migrate_ownership: jednorazová (idempotentná) migrácia vlastníctva volumes na uid
# 1000 (node) PRE non-root kontajner (#256). Po prepnutí na `USER node` musí kontajner
# ďalej zapísať do:
#  - appdata volume `/data/app` (SQLite DB + WAL/SHM) — app-EXKLUZÍVNe → `chown -R 1000:1000`
#    (owner AJ group na 1000, žiadny zdieľaný spotrebiteľ).
#  - `moneylog` volume `/data/money-log` (#297, forenzný money-audit súbor) — app-EXKLUZÍVNe
#    → `chown -R 1000:1000`. Čerstvý volume zdedí node:node z image (Dockerfile mkdir+chown),
#    toto je obranný idempotentný backstop (napr. pre-existujúci root-vlastnený volume).
#  - `/data/dlv-import` KOREŇ (zdieľaný s n8n Money watcherom) — dir-write STAČÍ na
#    create/delete odpis súborov, preto NErekurzívne (neprepíšeme n8n súbory) a
#    **OWNER-ONLY `chown 1000`** — ZACHOVÁ existujúcu GROUP. Ak n8n závisel na zdieľanej
#    group-write na tomto adresári, zostane mu zachovaná (defense-in-depth k UNVERIFIED
#    predpokladu n8n uid=1000; review 🟡 #1). Ak je n8n uid=1000, je owner (píše); ak
#    root, obchádza práva. Zvyšné riziko (n8n na treťom non-root uid BEZ group-write) sa
#    overí na VPS (`docker inspect --format '{{.Config.User}}' <n8n>` + `stat`) — viď ci.md.
#  - `/data/dlv-import/NA ODPIS` podstrom (naše odkladacie priečinky pre čaká-odpis, n8n
#    ich NEČÍTA — Money importuje LEN koreň) → `chown -R 1000:1000` (naše).
#  - `/data/montalu/.../ODPIS EXPORT` (TEST export, `money.ts` testDir) — na prode
#    MONEY_LIVE=1 sa doň NEpíše, ale pri prepnutí na MONEY_LIVE=0 (sankčný test-switch na
#    tom istom boxe) by non-root app dostala EACCES (review 🔵 #2). Owner-only `chown 1000`
#    listu (zachová group na zdieľanom montalu mounte); `mkdir -p` je náš vlastný export
#    adresár, idempotentný.
# `/data/ceny` sa NETÝKA (`:ro` mount — číta sa, chown by aj tak zlyhal).
# Beží ako ROOT v jednorazovom app-image kontajneri (`docker compose run --user 0`),
# takže funguje AJ keď CI deployuje ako non-root `deploy` user (skupina docker ==
# root-v-kontajneri) — a `compose run` vyrieši prefixovaný názov named volume aj
# bind-mounty presne ako `up`. `-T` = bez TTY (beh cez SSH bez terminálu).
# Idempotentné (opakovaný chown = no-op). Chyba NIE je fatálna: health poll + rollback
# nižšie je záchranná sieť (root-vlastnený volume → app nenabehne → rollback na starý
# image, prod žije), preto len hlasné `::warning::`. POZOR: health/rollback pokrýva LEN
# appdata (app nenabehne) — chybný chown ZDIEĽANÝCH mountov je pre health neviditeľný,
# preto owner-only + VPS overenie n8n uid (ci.md UNVERIFIED) + sledovanie prvého odpisu.
migrate_ownership() {
	docker compose run --rm --no-deps -T --user 0 --entrypoint sh "$SERVICE" -c \
		'set -e; chown -R 1000:1000 /data/app; if [ -d /data/money-log ]; then chown -R 1000:1000 /data/money-log; fi; if [ -d /data/dlv-import ]; then chown 1000 /data/dlv-import; mkdir -p "/data/dlv-import/NA ODPIS"; chown -R 1000:1000 "/data/dlv-import/NA ODPIS"; fi; if [ -d /data/montalu ]; then mkdir -p "/data/montalu/konstrukcia/AUTOMATIZACIA ODPIS MATERIALU/ODPIS EXPORT"; chown 1000 "/data/montalu/konstrukcia/AUTOMATIZACIA ODPIS MATERIALU/ODPIS EXPORT"; fi' ||
		echo "::warning::migrate_ownership: chown vlastníctva volumes zlyhal — over práva/vlastníctvo mountov na VPS (health poll + rollback je backstop LEN pre appdata)"
}

# mount_sources_from_compose <compose>: vypíše (jeden na riadok) host bind-mount ZDROJE z
# compose súboru. Podporuje OBA syntaxy (review 🟡-2 — inak by dlhý syntax dal 0 zdrojov a
# pre-flight by sa TICHO vypol, čo znovu otvára #270):
#   - krátky:  `- /host/src:/kontajner/cieľ[:ro]`      → `/host/src`
#   - dlhý:    `- type: bind` + `  source: /host/src`  → `/host/src`
# Named volumes (ľavá strana = meno, napr. `appdata:`) nezačínajú `/` → preskočené. Zoznam sa
# ODVODZUJE z compose (žiadna druhá hardcoded kópia, ktorá by driftla od toho, čo `docker
# compose up` naozaj mountuje). #270.
# POZOR (review 🔵-2): grep nie je scopnutý na `volumes:` blok — spolieha sa, že jediné
# `- /...` / `source: /...` riadky sú volume zdroje (dnes platí). `command:`/`devices:` s
# absolútnou cestou by dali falošný zdroj; pri rozšírení compose to over.
mount_sources_from_compose() {
	{
		grep -E '^[[:space:]]*-[[:space:]]*/' "$1" 2>/dev/null |
			sed -E 's/^[[:space:]]*-[[:space:]]*//; s/:.*$//'
		grep -E '^[[:space:]]*source:[[:space:]]*/' "$1" 2>/dev/null |
			sed -E 's/^[[:space:]]*source:[[:space:]]*//; s/[[:space:]]*$//'
	} || true
}

# preflight_mounty: PRED akýmkoľvek recreate over, že každý host bind-mount ZDROJ z compose
# je dostupný (`stat` + `ls` s bounded `timeout` — mŕtvy CIFS/host mount inak visí). Návrat
# 0 = všetky OK (alebo compose bez bind-mountov / nenájdený), 1 = aspoň jeden nedostupný. #270.
preflight_mounty() {
	local sources src rc=0
	if [ ! -f "$COMPOSE_FILE" ]; then
		echo "::warning::pre-flight: compose súbor '$COMPOSE_FILE' nenájdený — kontrola bind-mount zdrojov PRESKOČENÁ (docker compose build nižšie zlyhá hlasno, ak naozaj chýba)"
		return 0
	fi
	sources="$(mount_sources_from_compose "$COMPOSE_FILE")"
	if [ -z "$sources" ]; then
		echo "pre-flight: compose nedeklaruje žiadny host bind-mount (len named volumes) — nič na kontrolu"
		return 0
	fi
	echo "pre-flight: kontrolujem dostupnosť host bind-mount zdrojov z $COMPOSE_FILE:"
	# `timeout` ohraničí ČAKANIE; predpoklad SOFT mountov (CIFS „Host is down" → stat vráti
	# EHOSTDOWN a je killnuteľný). HARD mount v uninterruptible D-state by `timeout` nemusel
	# prerušiť (SIGKILL nezabije D-state) — naše CIFS mounty sú soft (viď .claude/skills/deploy). 🔵-3
	while IFS= read -r src; do
		[ -n "$src" ] || continue
		if timeout "$STAT_TIMEOUT" stat "$src" >/dev/null 2>&1 &&
			timeout "$STAT_TIMEOUT" ls "$src" >/dev/null 2>&1; then
			echo "  OK  $src"
		else
			echo "::error::pre-flight: bind-mount zdroj '$src' nedostupný — deploy sa NEvykoná, bežiaci kontajner ostáva"
			rc=1
		fi
	done <<<"$sources"
	return "$rc"
}

# 0. PRE-FLIGHT: over dostupnosť host bind-mount zdrojov (z compose) PRED akýmkoľvek recreate.
# Mŕtvy CIFS/host mount = `docker compose up -d` zlyhá pri bind-mounte, ale recreate UŽ zabil
# bežiaci kontajner → prod DOWN a rollback (#254) zlyhá na tom istom mounte (#270). Preto
# fail-fast TU, kým starý kontajner ešte beží → prod ostáva UP na starej verzii.
# migrate_ownership (#256, prvý dotyk mountov cez `compose run` len s warningom) beží AŽ PO tomto.
if ! preflight_mounty; then
	echo "::error::pre-flight zlyhal — aspoň jeden host bind-mount zdroj je nedostupný. Deploy sa NEVYKONAL, bežiaci kontajner ($CONTAINER) ostáva na aktuálnej verzii. Oprav mount (CIFS 'Host is down' obnova → .claude/skills/deploy) a re-run deploy."
	exit 1
fi

# 1. ID práve bežiaceho image (pre rollback). Prázdne pri prvom deployi.
PREV_IMAGE="$(docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || true)"
echo "predchádzajúci image: ${PREV_IMAGE:-<žiadny>}"

# 2. build nového image (compose ho otaguje na IMAGE:current) + durable SHA tag
docker compose build
docker tag "$IMAGE:current" "$IMAGE:$SHA7"

# 2b. migrácia vlastníctva volumes na uid 1000 PRED up (aby non-root `USER node`
# kontajner zapísal do appdata/Money mountov). Beží po build (image existuje pre
# `compose run`), pred up. Idempotentné.
migrate_ownership

# 3. up nový build + forward health poll (ok + SHA sedí). Zachytíme EXIT KÓD `up -d` (UP_RC)
# — je to SPOĽAHLIVÝ signál VRSTVY zlyhania pre rollback (#270 🟡-1): mŕtvy/chybný mount,
# chýbajúca sieť či obsadený port → `up -d` padne (UP_RC≠0); app-health zlyhanie → `up -d`
# prejde (UP_RC=0), nesedí len health. `|| UP_RC=$?` drží zlyhanie mimo `set -e` (žiadny
# tichý abort — prepadne do rollbacku). Predtým re-probe mountu v rollbacku vedel MYLNE
# klasifikovať app-health zlyhanie ako mŕtvy mount, ak mount v okne re-checku preblikol.
UP_RC=0
docker compose up -d || UP_RC=$?
if [ "$UP_RC" -eq 0 ] && poll_health sha; then
	echo "deploy OK — verzia $APP_VERSION beží"
	prune_stare_obrazy
	exit 0
fi

# 4. ZLYHANIE (up -d alebo health) → rollback
echo "::error::deploy zlyhal (up -d alebo health/verzia nesedí) — $APP_VERSION"
docker logs --tail 50 "$CONTAINER" 2>/dev/null || true

# 4a. Zisti VRSTVU zlyhania: mŕtvy host bind-mount vs. app health (#270). Pre-flight beží
# pred recreate, ale mount môže padnúť aj v okne medzi pre-flightom a `up`; re-check dá
# operátorovi jasný signál, ktorú obnovu robiť (mount reconnect vs. app debug), a zabráni
# slepému re-tagu do mŕtveho mountu (rollback `up -d` by na ňom zlyhal rovnako).
if [ "$UP_RC" -ne 0 ] && ! preflight_mounty; then
	echo "::error::rollback: príčina je MŔTVY HOST BIND-MOUNT (nie app health) — ani rollback image nenaštartuje, kým je mount dole. Skúšam oživiť pôvodný kontajner cez 'docker start' (recreate ho mohol nechať v stave Created)…"
	# `docker start` oživí pôvodný kontajner bez ďalšieho recreate, ktorý by na mŕtvom mounte
	# znovu zlyhal. Ak pôvodný kontajner ešte beží, `start` je no-op a health prejde.
	if docker start "$CONTAINER" >/dev/null 2>&1 && poll_health live; then
		echo "::warning::rollback cez 'docker start' OK — mount sa medzitým obnovil, kontajner beží (nový build)"
	else
		echo "::error::rollback TIEŽ zlyhal (mŕtvy mount) — prod je pravdepodobne DOWN, treba manuálny zásah na mounte (.claude/skills/deploy 'Host is down' obnova)"
	fi
	exit 1
fi

# 4b. Mounty OK → príčina je app health. Pôvodná #254 image-tag rollback sémantika.
if [ -z "$PREV_IMAGE" ]; then
	echo "::error::žiadna predchádzajúca verzia (prvý deploy?) — nedá sa rollbacknúť, prod môže byť DOWN"
	exit 1
fi

echo "rollback na predchádzajúci image $PREV_IMAGE (príčina: app health / nie mŕtvy mount)"
docker tag "$PREV_IMAGE" "$IMAGE:current"
if docker compose up -d && poll_health live; then
	echo "::warning::deploy zlyhal, rollback na predchádzajúcu verziu OK — prod beží (starý build)"
else
	echo "::error::rollback TIEŽ zlyhal — prod je pravdepodobne DOWN, treba manuálny zásah"
fi
exit 1
