#!/usr/bin/env bash
# Test navigateur du portail (Chromium headless via Playwright).
#   tests/smoke-browser.sh [image] [dossier de captures]
# Le navigateur tourne dans un container qui partage le réseau du container Cloudbox :
# il voit http://127.0.0.1:8080 exactement comme le navigateur du poste.
set -uo pipefail
cd "$(dirname "$0")"
. ./lib.sh

IMAGE=${1:-cloudbox:web}
OUT=${2:-browser-out}
NAME=cloudbox-browser-$$
TOKEN=$(openssl rand -hex 32)
# renovate: datasource=docker depName=mcr.microsoft.com/playwright/python
PLAYWRIGHT_VERSION=v1.63.0-noble

cleanup() { docker rm -f "$NAME" "$NAME-pw" >/dev/null 2>&1; }
trap cleanup EXIT

section "Démarrage"
docker run -d --name "$NAME" -e CLOUDBOX_TOKEN="$TOKEN" "$IMAGE" >/dev/null
for _ in $(seq 1 90); do
    [[ $(docker exec "$NAME" curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/_health 2>/dev/null) == 200 ]] && break
    sleep 2
done
pass "Cloudbox démarré"
# code-server : prêt une fois les extensions installées (premier démarrage)
for _ in $(seq 1 90); do
    [[ $(docker exec "$NAME" curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8080/code/healthz 2>/dev/null) == 200 ]] && break
    sleep 2
done
pass "code-server prêt"

section "Navigateur"
docker create --name "$NAME-pw" --network "container:$NAME" -w /work \
    "mcr.microsoft.com/playwright/python:$PLAYWRIGHT_VERSION" \
    bash -c "pip install -q --root-user-action=ignore playwright==${PLAYWRIGHT_VERSION%%-*} >/dev/null 2>&1 && mkdir -p /out && python3 /work/browser_check.py $TOKEN /out" >/dev/null
docker cp browser_check.py "$NAME-pw:/work/browser_check.py"
docker start -a "$NAME-pw" || FAILED=1
rm -rf "$OUT" && docker cp "$NAME-pw:/out" "$OUT" >/dev/null 2>&1 && echo "  Captures : tests/$OUT/"

finish
