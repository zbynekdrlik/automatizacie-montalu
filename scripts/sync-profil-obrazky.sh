#!/bin/bash
# Stiahne rezy profilov z Money katalógu a uloží ich ako optimalizované webp
# do static/profil/. Money obrázky sú v DB S4_Agenda_MONT_ALUSro_Doc
# (System_Attachment.FileImage, prepojené cez System_ObjectAttachmentLink na
# Artikly_Artikl podľa kódu). Spusti len keď pribudne/zmení sa profil.
#
# Prístup (#425 — ~/.ssh/slovnormal_odoo na dev boxoch UŽ NEEXISTUJE, odstránený
# old-key-removal sweepom, odoo-erp #1183/#3629): dvojskok cez gatekeeper box.
# Gatekeeper (100.90.94.41) má vo VLASTNOM ~/.ssh/config alias `montalu-prod`,
# ktorý používa dedikovaný `gatekeeper_prod` kľúč na ten istý host
# (erp.montalu.cloud / 178.104.63.220) — dev boxy priamy kľúč na Money bridge
# nemajú a nemajú mať. Preto KAŽDÝ ssh/scp na Money bridge ide cez gatekeeper
# ako autentizovaný prostredník (nie ako holý TCP proxy — jeho vlastný kľúč
# robí druhý hop), nikdy priamo z dev1/dev2.
#
# Použitie:  scripts/sync-profil-obrazky.sh
set -euo pipefail

GATEKEEPER="${MONEY_GATEKEEPER:-gatekeeper@100.90.94.41}"
REMOTE_ALIAS="${MONEY_REMOTE_ALIAS:-montalu-prod}"  # alias v ~/.ssh/config NA gatekeeperovi, nie tu
SSH_OPTS=(-o BatchMode=yes -o LogLevel=ERROR -o ConnectTimeout=15)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/static/profil"

# Spusti príkaz NA montalu-prod cez dvojskok (gatekeeper vlastným kľúčom robí
# druhý hop). Argument je jeden reťazec, ktorý bude bežať v shelli na montalu-prod;
# vstavané apostrofy sa bezpečne escapujú (POSIX '\'' idiom), takže argument môže
# obsahovať `'`. Volajúci môže presmerovať stdin/stdout normálne (`remote '...' <
# subor`, `remote '...' | ...`) — funkcia ich len prenesie do ssh.
remote() {
	local escaped=${1//\'/\'\\\'\'}
	ssh "${SSH_OPTS[@]}" "$GATEKEEPER" "ssh ${SSH_OPTS[*]} $REMOTE_ALIAS '$escaped'"
}

# kódy, ku ktorým chceme obrázok = všetky kódy z compute modulov
CODES=$(grep -rhoE "(PRP|BPP|ZASP)[0-9]+" "$ROOT/src/lib/server/pergola.ts" \
	"$ROOT/src/lib/server/bazen.ts" "$ROOT/src/lib/server/cfg_seed.json" | sort -u)
echo "$CODES" | tr '\n' ' ' > /tmp/codes.txt

cat > /tmp/money_img_dump.py <<'PYEOF'
import sys, os
sys.path.insert(0, "/opt/montalu-sync/scripts/import-montalu")
import moneydb
conn = moneydb.connect()
DOC = '[S4_Agenda_MONT_ALUSro_Doc]'
codes = open('/tmp/codes.txt').read().split()
os.makedirs('/tmp/profil-obrazky', exist_ok=True)
miss = []
for kod in codes:
    sql = ("SELECT TOP 1 a.FileImage AS img FROM Artikly_Artikl ar "
           "JOIN " + DOC + ".dbo.System_ObjectAttachmentLink l ON l.Object_ID = ar.ID AND l.Object_Name = N'Artikl' AND l.Deleted = 0 "
           "JOIN " + DOC + ".dbo.System_Attachment a ON a.ID = l.Attachment_ID AND a.Deleted = 0 "
           "WHERE ar.Kod = N'" + kod + "' AND DATALENGTH(a.FileImage) > 1000 "
           "ORDER BY CASE WHEN a.Description LIKE N'%.jpg' THEN 0 ELSE 1 END, DATALENGTH(a.FileImage) DESC")
    rows = moneydb.query(conn, sql)
    if rows and rows[0]['img']:
        img = rows[0]['img']
        ext = 'jpg' if img[:3] == b'\xff\xd8\xff' else ('png' if img[:4] == b'\x89PNG' else 'bin')
        open('/tmp/profil-obrazky/%s.%s' % (kod, ext), 'wb').write(img)
    else:
        miss.append(kod)
print('STIAHNUTE:', len(codes) - len(miss), '/', len(codes))
if miss: print('BEZ OBRAZKA:', ' '.join(miss))
PYEOF

echo "→ sťahujem z Money (retry na flaky bridge)…"
# Nahraj oba súbory na montalu-prod cez dvojskok — obsah ide surovo cez stdin
# (žiadne base64 potrebné, testované 2026-09-02 vrátane binárneho tar prenosu
# naspäť). `remote()` len zloží príkaz — presmerovanie stdin/stdout robí volajúci.
remote 'cat > /tmp/codes.txt' < /tmp/codes.txt
remote 'cat > /tmp/money_img_dump.py' < /tmp/money_img_dump.py
OK=0
for i in 1 2 3 4 5; do
	if remote 'rm -rf /tmp/profil-obrazky; /opt/montalu-sync/venv/bin/python /tmp/money_img_dump.py' 2>/tmp/sync.err; then OK=1; break; fi
	echo "  bridge nedostupný (pokus $i), čakám 20s…"; sleep 20
done
if [ "$OK" -ne 1 ]; then
	echo "→ CHYBA: Money bridge zlyhal aj po 5 pokusoch, viď /tmp/sync.err — nesťahujem stale dáta." >&2
	cat /tmp/sync.err >&2 2>/dev/null || true
	exit 1
fi

TMP=$(mktemp -d)
remote 'tar -czf - -C /tmp profil-obrazky' | tar -xzf - -C "$TMP"

echo "→ optimalizujem na webp…"
mkdir -p "$OUT"
python3 - "$TMP/profil-obrazky" "$OUT" <<'PYEOF'
import sys, os, glob, re
from PIL import Image, ImageChops
src, out = sys.argv[1], sys.argv[2]
kods = []
for f in sorted(glob.glob(src + '/*')):
    kod = os.path.splitext(os.path.basename(f))[0]
    im = Image.open(f).convert('RGB')
    bg = Image.new('RGB', im.size, (255, 255, 255))
    bbox = ImageChops.difference(im, bg).getbbox()
    if bbox:
        l, t, r, b = bbox
        im = im.crop((max(0, l - 12), max(0, t - 12), min(im.width, r + 12), min(im.height, b + 12)))
    im.thumbnail((480, 480), Image.LANCZOS)
    im.save(os.path.join(out, kod + '.webp'), 'WEBP', quality=84, method=6)
    kods.append(kod)
# ZAPÍŠ zoznam do src/lib/profil-obrazky.ts — ručné dopĺňanie bolo príčina
# driftu (Štandard / Štandard + mali stiahnuteľné rezy, ale v zozname neboli
# → dielňa ich nevidela; šéf 2026-07-30). Test tests/profil-obrazky.test.ts
# drží zoznam a súbory v zhode.
ts = os.path.join(os.path.dirname(out), '..', 'src', 'lib', 'profil-obrazky.ts')
ts = os.path.normpath(ts)
riadky, cur = [], []
for k in sorted(kods):
    cur.append("'" + k + "'")
    if len(cur) == 6:
        riadky.append('\t' + ', '.join(cur) + ','); cur = []
if cur: riadky.append('\t' + ', '.join(cur))
src = open(ts).read()
novy = re.sub(r'(export const PROFIL_S_OBRAZKOM = new Set<string>\(\[\n).*?(\n\]\);)',
              lambda m: m.group(1) + '\n'.join(riadky) + m.group(2), src, flags=re.S)
assert novy != src, 'nenasiel som PROFIL_S_OBRAZKOM v ' + ts
open(ts, 'w').write(novy)
print('webp:', len(kods), '→ zapisane do', ts)
PYEOF

echo "→ hotovo. Skontroluj 'git status' (nove .webp + prepisany zoznam) a pusti: npx vitest run tests/profil-obrazky.test.ts"
rm -rf "$TMP"
