#!/usr/bin/env bash
set -euo pipefail
# Idempotentný applier branch protection pre `main` (#267 — produkcia, deploy na
# každý merge, dnes 404 „Branch not protected"). Beží s owner `gh` auth.
#
# Dva ČISTO oddelené zdroje pravdy (žiadny drift):
#   1. deploy/branch-protection.json — VŠETKY nastavenia + PEVNÉ contexts
#      (version-check, test). Payload template, číta ho aj test.
#   2. .github/workflows/mutation.yml `SHARDS: N` — počet mutačných shardov.
#      Skript z neho vygeneruje required contexts `mutation-diff (1..N)`, takže
#      protection sa NIKDY nerozíde s workflowom. Po KAŽDEJ zmene SHARDS
#      (napr. 4→6) stačí re-spustiť: `bash scripts/branch-protection.sh`.
#
# NEzahŕňa `deploy` (beží len na main → na PR head z dev nikdy nezíska success →
# zablokoval by každý merge) ani `mutation-sweep` (workflow_dispatch, skipped).
#
# Idempotentné: PUT nahrádza CELÚ protection konfiguráciu (nie patch); `gh repo
# edit` flagy sú tiež idempotentné → re-apply-safe, self-healing pri drifte.
#
# Env override (pre testy / iné repo): REPO, BRANCH_PROTECTION_JSON,
# MUTATION_WORKFLOW.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

REPO="${REPO:-zbynekdrlik/automatizacie-montalu}"
TEMPLATE="${BRANCH_PROTECTION_JSON:-$REPO_ROOT/deploy/branch-protection.json}"
MUTATION_WORKFLOW="${MUTATION_WORKFLOW:-$REPO_ROOT/.github/workflows/mutation.yml}"

command -v gh >/dev/null 2>&1 || {
	echo "CHYBA: gh CLI nie je na PATH" >&2
	exit 1
}
command -v jq >/dev/null 2>&1 || {
	echo "CHYBA: jq nie je na PATH" >&2
	exit 1
}
[ -f "$TEMPLATE" ] || {
	echo "CHYBA: chýba payload template $TEMPLATE" >&2
	exit 1
}
[ -f "$MUTATION_WORKFLOW" ] || {
	echo "CHYBA: chýba $MUTATION_WORKFLOW" >&2
	exit 1
}

# Počet mutačných shardov = job-level `SHARDS: N` v mutation.yml. Grep vráti
# max 1 riadok (jediný match); `|| true` ošetrí no-match pod set -e, potom
# vyžadujeme kladné celé číslo (fail-loud, no-timeout-band-aids: nikdy tichý default).
SHARDS_MATCH="$(grep -oE 'SHARDS: *[0-9]+' "$MUTATION_WORKFLOW" | head -n1 || true)"
SHARDS="${SHARDS_MATCH##*[!0-9]}"
case "$SHARDS" in
'' | *[!0-9]*)
	echo "CHYBA: nenašiel som 'SHARDS: N' v $MUTATION_WORKFLOW — nedokážem odvodiť mutation contexts" >&2
	exit 1
	;;
esac

# Vygeneruj mutation-diff (1..N) ako JSON pole a pridaj k pevným contexts z template.
MUT_JSON="$(jq -cn --argjson n "$SHARDS" '[range(1; $n + 1) | "mutation-diff (\(.))"]')"
PAYLOAD="$(jq \
	--argjson mut "$MUT_JSON" \
	'.required_status_checks.contexts += $mut' \
	"$TEMPLATE")"

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
printf '%s\n' "$PAYLOAD" >"$TMP"

echo "== Branch protection → $REPO (main), SHARDS=$SHARDS =="
printf '%s\n' "$PAYLOAD" | jq '.required_status_checks.contexts'

# Nahradí CELÚ protection konfiguráciu na main.
gh api -X PUT "repos/$REPO/branches/main/protection" \
	-H "Accept: application/vnd.github+json" \
	--input "$TMP"

# Merge commits only (two-branch-workflow: žiadny squash/rebase merge).
gh repo edit "$REPO" \
	--enable-squash-merge=false \
	--enable-rebase-merge=false \
	--enable-merge-commit=true

echo "== Hotovo. Over: gh api repos/$REPO/branches/main/protection =="
