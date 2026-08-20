#!/usr/bin/env bash
set -euo pipefail

# Deterministicky rozdelí zoznam súborov (stdin, jeden na riadok) do SHARDS
# shardov mutation.yml matrix jobu. Príslušnosť súboru do shardu sa počíta
# z HASHU JEHO CESTY (cksum), nie z poradia riadkov ani z počtu súborov —
# vďaka tomu je Stryker incremental lineage per shard STABILNÁ naprieč
# pushmi: ten istý súbor padne vždy do toho istého shardu, aj keď sa
# zmenená množina súborov medzi pushmi zmenší/zväčší (inak by incremental
# cache pre daný shard priebežne strácala platnosť a mutation-diff by
# strácal zrýchlenie, ktoré incremental dáva).
#
# Použitie:
#   printf '%s\n' file1 file2 ... | SHARD=<1..SHARDS> SHARDS=<N> \
#     bash scripts/mutation-shard.sh
#
# Výstup: čiarkami oddelený zoznam súborov patriacich do SHARDu, BEZ
# koncového newline; prázdny výstup ak do shardu nepatrí žiadny súbor
# (mutation.yml gate na tom stavia "shard nemá čo mutovať, končím zelený").

: "${SHARD:?SHARD (1..SHARDS) je povinný}"
: "${SHARDS:?SHARDS (>=1) je povinný}"

out=()
while IFS= read -r f || [ -n "$f" ]; do
	[ -z "$f" ] && continue
	h=$(printf '%s' "$f" | cksum | cut -d' ' -f1)
	if [ "$((h % SHARDS + 1))" -eq "$SHARD" ]; then
		out+=("$f")
	fi
done

(
	IFS=,
	printf '%s' "${out[*]-}"
)
