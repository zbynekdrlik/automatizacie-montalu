#!/usr/bin/env bash
set -euo pipefail
# Rollback-safe deploy — beží NA VPS, volaný cez SSH z ci.yml deploy jobu (#254).
#
# Rollback = natívny Docker image re-tag (žiadna custom orchestrácia, žiadna dep):
#   1. odchytí ID práve bežiaceho image (`docker inspect` kontajnera) PRED `up`,
#   2. `docker compose build` (compose ho otaguje na IMAGE:current) + durable IMAGE:<sha7>,
#   3. `up -d` + forward health poll (ok:true + SHA7 vo verzii),
#   4. pri zlyhaní → re-tag odchyteného prev ID späť na IMAGE:current + `up -d` +
#      rollback poll (len liveness) → job padne (exit 1) s logmi.
#
# Rollback SA robí LEN pri zlyhaní health polla (deploy reálne nenabehol).
# Zlyhanie post-deploy E2E (samostatný krok v ci.yml PO úspešnom health) rollback
# NEvyvolá — nová verzia je live a zdravá, E2E zlyhanie je alarm, nie dôvod vrátiť
# zdravý build.
#
# Plne env-riadené kvôli testovateľnosti (tests/deploy-remote.test.ts mockuje
# `docker`/`curl` na PATH): SHA7, APP_VERSION, COMPOSE_DIR, CONTAINER, IMAGE,
# HEALTH_URL, POLL_TRIES, POLL_SLEEP.

: "${SHA7:?SHA7 je povinný (skrátený deployovaný commit)}"
: "${APP_VERSION:?APP_VERSION je povinný}"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/automatizacie-montalu}"
CONTAINER="${CONTAINER:-automatizacie-montalu}"
IMAGE="${IMAGE:-automatizacie-montalu}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8090/health}"
POLL_TRIES="${POLL_TRIES:-20}"
POLL_SLEEP="${POLL_SLEEP:-3}"

cd "$COMPOSE_DIR"

# poll_health <mode>: "sha" = forward deploy (vyžaduje ok:true AND SHA7 vo verzii),
# "live" = rollback (stačí ok:true — starý build má iný SHA). Návrat 0 pri úspechu.
poll_health() {
	local mode="$1" h
	for _ in $(seq 1 "$POLL_TRIES"); do
		sleep "$POLL_SLEEP"
		h="$(curl -s "$HEALTH_URL" || true)"
		echo "health: $h"
		if echo "$h" | grep -q '"ok":true'; then
			if [ "$mode" = "live" ]; then
				return 0
			elif echo "$h" | grep -qF "$SHA7"; then
				return 0
			fi
		fi
	done
	return 1
}

# 1. ID práve bežiaceho image (pre rollback). Prázdne pri prvom deployi.
PREV_IMAGE="$(docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || true)"
echo "predchádzajúci image: ${PREV_IMAGE:-<žiadny>}"

# 2. build nového image (compose ho otaguje na IMAGE:current) + durable SHA tag
APP_VERSION="$APP_VERSION" docker compose build
docker tag "$IMAGE:current" "$IMAGE:$SHA7"

# 3. up nový build
APP_VERSION="$APP_VERSION" docker compose up -d

# 4. forward health poll (ok + SHA sedí)
if poll_health sha; then
	echo "deploy OK — verzia $APP_VERSION beží"
	exit 0
fi

# 5. ZLYHANIE → rollback
echo "::error::health/verzia nesedí po deployi ($APP_VERSION)"
docker logs --tail 50 "$CONTAINER" || true

if [ -z "$PREV_IMAGE" ]; then
	echo "::error::žiadna predchádzajúca verzia (prvý deploy?) — nedá sa rollbacknúť, prod môže byť DOWN"
	exit 1
fi

echo "rollback na predchádzajúci image $PREV_IMAGE"
docker tag "$PREV_IMAGE" "$IMAGE:current"
APP_VERSION="$APP_VERSION" docker compose up -d
if poll_health live; then
	echo "::warning::deploy zlyhal, rollback na predchádzajúcu verziu OK — prod beží (starý build)"
else
	echo "::error::rollback health TIEŽ zlyhal — prod je pravdepodobne DOWN, treba manuálny zásah"
fi
exit 1
