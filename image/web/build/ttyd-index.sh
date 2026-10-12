#!/usr/bin/env bash
# Produit la page d'accueil de ttyd utilisée par Cloudbox (option --index) :
# la page d'origine, extraite du binaire installé, complétée par ttyd-index-addon.html.
# Elle suit donc automatiquement les mises à jour de ttyd.
set -euo pipefail

out=$1
addon=$(dirname "$0")/ttyd-index-addon.html
socket=$(mktemp -u /tmp/ttyd-XXXXXX.sock)

ttyd --interface "$socket" true >/dev/null 2>&1 &
pid=$!
trap 'kill "$pid" 2>/dev/null || true; rm -f "$socket"' EXIT
for _ in $(seq 1 50); do [[ -S $socket ]] && break; sleep 0.1; done

page=$(mktemp)
curl -fsS --compressed --unix-socket "$socket" http://localhost/ -o "$page"
if [[ $(grep -c '</head>' "$page") -ne 1 ]]; then
    echo "Page de ttyd inattendue : une seule balise </head> attendue" >&2
    exit 1
fi

install -d "$(dirname "$out")"
python3 -I - "$page" "$addon" "$out" <<'PY'
import sys
page, addon, out = (open(p, encoding="utf-8").read() if i < 2 else p for i, p in enumerate(sys.argv[1:]))
open(out, "w", encoding="utf-8").write(page.replace("</head>", addon + "</head>", 1))
PY
rm -f "$page"
echo "Page ttyd personnalisée : $out ($(wc -c < "$out") octets)"
