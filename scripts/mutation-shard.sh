#!/usr/bin/env bash
set -euo pipefail

# LPT (Longest Processing Time) váhová partícia zoznamu súborov (stdin, jeden
# na riadok) do SHARDS shardov mutation.yml matrix jobu — NAHRADILA predch.
# hash-podľa-cesty partíciu po incidente kolo 8 (GH Actions run 32387255712):
# hash je uniformný len v OČAKÁVANÍ, pri ~20 položkách sa vie zhlukovať — shard
# 3 vtedy dostal 9 z 18 zmenených súborov, vrátane VŠETKÝCH najťažších compute
# modulov (compute-odpis, compute-profily, compute-sietka, pergola, kovanie,
# vizual/builder, geo/zasklenia, cfg-editor, b2b-limits), a presiahol 20-min strop.
#
# LPT zoradí súbory podľa VEĽKOSTI (bajty, proxy na počet mutantov) zostupne a
# greedy priraďuje vždy do AKTUÁLNE najmenej zaťaženého shardu — vyrovnáva
# reálnu záťaž, nie len počet položiek. Cena: Stryker incremental lineage per
# shard je MENEJ stabilná naprieč pushmi (súbor môže zmeniť shard, keď sa
# zmení jeho vlastná veľkosť alebo pribudne/ubudne iný súbor v tom istom
# pushi) — je to LEN optimalizácia rýchlosti (incremental cache miss = daný
# shard beží pomalšie ako s cache, nikdy nesprávne); KOREKTNOSŤ (každý súbor
# presne v jednom sharde, zjednotenie == vstup) na stabilite lineage nezávisí.
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

# 1) načítaj vstup, vypočítaj váhu (bajty cez `wc -c`; 0 ak súbor na disku
#    neexistuje — testy vlastností pracujú aj s neexistujúcimi cestami, skript
#    beží v CI AŽ PO checkoute, kedy reálne existuje).
weighted=()
while IFS= read -r f || [ -n "$f" ]; do
	[ -z "$f" ] && continue
	if [ -f "$f" ]; then
		w=$(wc -c <"$f")
		w=${w//[[:space:]]/}
	else
		w=0
	fi
	weighted+=("$w"$'\t'"$f")
done

# Prázdny vstup (žiadny neprázdny riadok) → prázdny výstup, bez ohľadu na SHARD.
if [ "${#weighted[@]}" -eq 0 ]; then
	printf '%s' ""
	exit 0
fi

# 2) zoraď (váha DESC, cesta ASC) — determinizmus nezávislý od poradia
#    vstupných riadkov (LPT musí spracovať najväčšie súbory PRVÉ).
sorted=()
while IFS= read -r line; do
	sorted+=("$line")
done < <(printf '%s\n' "${weighted[@]}" | sort -t $'\t' -k1,1nr -k2,2)

# 3) greedy LPT: každý súbor → aktuálne NAJMENEJ zaťažený shard (remíza =
#    najnižší index); load += váha + 1 (aj nulovo-váhové súbory rotujú medzi
#    shardmi, inak by sa všetky zbalili do shardu 1).
loads=()
for ((i = 1; i <= SHARDS; i++)); do
	loads[i]=0
done

out=()
for line in "${sorted[@]}"; do
	w="${line%%$'\t'*}"
	f="${line#*$'\t'}"

	best=1
	bestload="${loads[1]}"
	for ((i = 2; i <= SHARDS; i++)); do
		if [ "${loads[i]}" -lt "$bestload" ]; then
			best=$i
			bestload="${loads[i]}"
		fi
	done

	loads[best]=$((loads[best] + w + 1))
	if [ "$best" -eq "$SHARD" ]; then
		out+=("$f")
	fi
done

(
	IFS=,
	printf '%s' "${out[*]-}"
)
