#!/usr/bin/env bash
set -euo pipefail

# Diff-scope mutačného gate na ZMENENÉ RIADKY (#569). Zo stdin číta
# `git diff -U0 <base>...HEAD -- <súbory>` a vypíše Stryker `--mutate` zoznam:
#   - upravený súbor → jeden záznam `súbor:start-end` na každý hunk (`+c,d` →
#     `c-(c+d-1)`, `+c` bez počtu = 1 riadok), čísla riadkov strany HEAD;
#   - čisté zmazanie (`+c,0`) → žiadny záznam (nie je čo mutovať);
#   - NOVÝ súbor (`--- /dev/null`) → holá cesta = celý súbor;
#   - ZMAZANÝ súbor (`+++ /dev/null`) → nič.
# Stryker 10 (`MUTATION_RANGE_REGEX` v @stryker-mutator/core fs/project-reader)
# podporuje `súbor:startLine-endLine`, viac záznamov toho istého súboru ÚNIUJE.
#
# Prečo (run 36109311931): gate mutoval CELÉ zmenené súbory — pár zmenených
# riadkov v LEAF module `compute-model.ts` vygeneroval stovky mutantov, každý
# spúšťal veľkú časť sady, a shard presiahol tvrdý 20-min strop. Sharding
# (`scripts/mutation-shard.sh`) súbor nerozdelí; náprava je užší scope, NIKDY
# väčší timeout. Mutanty mimo zmenených riadkov pokrýva on-demand full sweep.
#
# Mutant, ktorý presahuje nezmenené riadky (napr. blok okolo jednoriadkovej
# zmeny), Stryker do rozsahu nezaradí; čisté zmazanie sa tiež netestuje — to
# je zámerná cena rýchleho PR gate-u, dohnať ich má on-demand mutation-sweep.
#
# Použitie (argumenty = ALLOWLIST ciest shardu; bez argumentov = všetky súbory):
#   git -c core.quotePath=false diff -U0 -M --no-ext-diff --no-color \
#       --src-prefix=a/ --dst-prefix=b/ origin/main...HEAD -- src/lib \
#     | bash scripts/mutation-lines.sh a.ts b.ts
# Diff sa robí RAZ nad celým `src/lib` (nie `-- <súbory shardu>`): pathspec sa
# aplikuje PRED detekciou premenovaní, takže premenovaný súbor by s pathspecom
# na novú cestu vyzeral ako NOVÝ (`--- /dev/null`) → mutoval by sa celý.
#
# Výstup: čiarkami oddelený zoznam, BEZ koncového newline; prázdny výstup ak
# nie je čo mutovať (mutation.yml na tom stavia „shard končí zelený").

MUTATION_LINES_ALLOW=""
if [ "$#" -gt 0 ]; then
	MUTATION_LINES_ALLOW=$(printf '%s\n' "$@")
fi
export MUTATION_LINES_ALLOW

# POSIX awk (runner Ubuntu = mawk): allowlist cez ENVIRON (nie -v — to by
# interpretovalo escape sekvencie), filter príznak cez počítadlo, nie length(pole).
awk '
BEGIN {
	nallow = split(ENVIRON["MUTATION_LINES_ALLOW"], a, "\n")
	filtered = 0
	for (i = 1; i <= nallow; i++) if (a[i] != "") { ok[a[i]] = 1; filtered = 1 }
}
function wanted(p) {
	return !filtered || (p in ok)
}
function flush_new() {
	if (is_new && path != "" && wanted(path)) emit(path)
}
function emit(s) {
	out = (out == "" ? s : out "," s)
}
/^diff --git / {
	flush_new()
	path = ""; is_new = 0; is_del = 0; in_hdr = 1
	next
}
# ---/+++ sú hlavičky LEN pred prvým hunkom súboru — v tele hunku by pridaný
# riadok `++ x` / zmazaný `-- x` vyzeral rovnako.
in_hdr && /^--- / {
	is_new = ($0 == "--- /dev/null")
	next
}
in_hdr && /^\+\+\+ / {
	p = substr($0, 5)
	sub(/\t$/, "", p)
	if (p == "/dev/null") { is_del = 1; path = ""; next }
	sub(/^b\//, "", p)
	path = p
	next
}
/^@@ / {
	in_hdr = 0
	if (is_new || is_del || path == "" || !wanted(path)) next
	# @@ -a[,b] +c[,d] @@ ...
	if (match($0, /\+[0-9]+(,[0-9]+)?/) == 0) {
		print "mutation-lines: nečitateľná hlavička hunku: " $0 > "/dev/stderr"
		err = 1
		exit 2
	}
	h = substr($0, RSTART + 1, RLENGTH - 1)
	n = split(h, parts, ",")
	start = parts[1] + 0
	count = (n > 1 ? parts[2] + 0 : 1)
	if (count == 0) next
	emit(path ":" start "-" (start + count - 1))
	next
}
END {
	if (err) exit 2
	flush_new()
	printf "%s", out
}
'
