#!/bin/bash
# Stiahne rezy profilov z Money katalógu a uloží ich ako optimalizované webp
# do static/profil/. Money obrázky sú v DB S4_Agenda_MONT_ALUSro_Doc
# (System_Attachment.FileImage, prepojené cez System_ObjectAttachmentLink na
# Artikly_Artikl podľa kódu). Spusti len keď pribudne/zmení sa profil.
#
# Prístup: SSH kľúč ~/.ssh/slovnormal_odoo na root@erp.montalu.cloud
# (host montalu-prod, má read-only most na Money S4 cez /opt/montalu-sync/venv).
#
# Použitie:  scripts/sync-profil-obrazky.sh
set -euo pipefail

KEY="${MONEY_SSH_KEY:-$HOME/.ssh/slovnormal_odoo}"
HOST="${MONEY_SSH_HOST:-root@erp.montalu.cloud}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/static/profil"

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
scp -q -i "$KEY" /tmp/codes.txt /tmp/money_img_dump.py "$HOST":/tmp/
for i in 1 2 3 4 5; do
	if ssh -o BatchMode=yes -i "$KEY" "$HOST" 'rm -rf /tmp/profil-obrazky; /opt/montalu-sync/venv/bin/python /tmp/money_img_dump.py' 2>/tmp/sync.err; then break; fi
	echo "  bridge nedostupný (pokus $i), čakám 20s…"; sleep 20
done
ssh -o BatchMode=yes -i "$KEY" "$HOST" 'cat /tmp/profil-obrazky/../<(true)' >/dev/null 2>&1 || true

TMP=$(mktemp -d)
scp -q -i "$KEY" -r "$HOST":/tmp/profil-obrazky "$TMP/"

echo "→ optimalizujem na webp…"
mkdir -p "$OUT"
python3 - "$TMP/profil-obrazky" "$OUT" <<'PYEOF'
import sys, os, glob
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
# aktualizuj zoznam v src/lib/profil-obrazky.ts
setlit = ',\n\t'.join("'" + k + "'" for k in sorted(kods))
print('webp:', len(kods))
PYEOF

echo "→ hotovo. Skontroluj static/profil/ a aktualizuj PROFIL_S_OBRAZKOM v src/lib/profil-obrazky.ts (ls static/profil | sed 's/.webp//')."
rm -rf "$TMP"
