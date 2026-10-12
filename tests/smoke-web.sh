#!/usr/bin/env bash
# Test de fumée de l'image :web.
#   tests/smoke-web.sh [image]      (défaut : cloudbox:web)
# Les requêtes HTTP partent de l'intérieur du container (curl vers 127.0.0.1:8080),
# ce qui ne dépend pas du réseau de l'hôte (Docker Desktop, WSL, runner CI).
set -uo pipefail
cd "$(dirname "$0")"
. ./lib.sh

IMAGE=${1:-cloudbox:web}
NAME=cloudbox-smoke-$$
TOKEN=$(openssl rand -hex 32)
BASE=http://127.0.0.1:8080

cleanup() { docker rm -f "$NAME" "$NAME-gen" "$NAME-shell" >/dev/null 2>&1; }
trap cleanup EXIT

# code HTTP d'une requête faite depuis le container
http() { docker exec "$NAME" curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@" | tr -d '\r'; }
probe() { docker exec -i "$NAME" python3 - "$@" < ws_probe.py | tr -d '\r'; }

wait_healthy() {
    local name=$1
    for _ in $(seq 1 90); do
        [[ $(docker exec "$name" curl -s -o /dev/null -w '%{http_code}' "$BASE/_health" 2>/dev/null) == 200 ]] && return 0
        sleep 2
    done
    docker logs "$name" 2>&1 | tail -n 40
    return 1
}

section "Démarrage (CLOUDBOX_TOKEN imposé)"
docker run -d --name "$NAME" -e CLOUDBOX_TOKEN="$TOKEN" "$IMAGE" >/dev/null
if wait_healthy "$NAME"; then pass "Caddy répond"; else fail "Caddy ne répond pas"; finish; fi

section "Sans jeton : 401"
for p in / /index.html /versions.json /term/pwsh/ /term/bash/ /code/; do
    expect "GET $p" 401 "$(http "$BASE$p")"
done
expect "WebSocket /term/pwsh/ws" "HTTP 401" "$(probe "$BASE/term/pwsh/ws" - "$BASE" | head -n 1)"
expect "page de connexion servie en 401" 1 "$(docker exec "$NAME" curl -s "$BASE/code/" | grep -c 'id="login-form"')"

section "Jetons invalides : 401"
expect "mauvais jeton" 401 "$(http -H "Authorization: Bearer $(openssl rand -hex 32)" "$BASE/")"
expect "jeton + caractères en plus" 401 "$(http -H "Authorization: Bearer ${TOKEN}x" "$BASE/")"
expect "préfixe du jeton" 401 "$(http -H "Authorization: Bearer ${TOKEN:0:32}" "$BASE/")"
expect "Bearer vide" 401 "$(http -H "Authorization: Bearer " "$BASE/")"
expect "cookie vide" 401 "$(http -H "Cookie: cloudbox_session=" "$BASE/")"
expect "jeton en cookie (au lieu de la session)" 401 "$(http -H "Cookie: cloudbox_session=$TOKEN" "$BASE/")"

section "Avec jeton : 200"
AUTH=(-H "Authorization: Bearer $TOKEN")
expect "GET /" 200 "$(http "${AUTH[@]}" "$BASE/")"
expect "GET /versions.json" 200 "$(http "${AUTH[@]}" "$BASE/versions.json")"
expect "GET /term/pwsh/" 200 "$(http "${AUTH[@]}" "$BASE/term/pwsh/")"
expect "GET /term/bash/" 200 "$(http "${AUTH[@]}" "$BASE/term/bash/")"
# code-server démarre après l'installation des extensions (premier démarrage) : 502 en attendant
for _ in $(seq 1 45); do
    code=$(http -L --max-redirs 5 "${AUTH[@]}" "$BASE/code/")
    [[ $code == 502 ]] || break
    sleep 2
done
expect "GET /code/ (redirections suivies)" 200 "$code"
expect "GET /code (sans slash, query conservée)" "/code/?folder=/home/dev" \
    "$(docker exec "$NAME" curl -s -o /dev/null -w '%{redirect_url}' "${AUTH[@]}" "$BASE/code?folder=/home/dev" | sed 's#^http://[^/]*##')"
expect "WebSocket /term/pwsh/ws" "HTTP 101" "$(probe "$BASE/term/pwsh/ws" "$TOKEN" "$BASE" | head -n 1)"

section "Connexion par cookie de session"
headers=$(docker exec "$NAME" curl -s -D - -o /dev/null -X POST -H "Origin: $BASE" "${AUTH[@]}" "$BASE/_auth/login" | tr -d '\r')
expect "POST /_auth/login" 204 "$(awk 'NR == 1 { print $2 }' <<<"$headers")"
cookie=$(sed -n 's/^[Ss]et-[Cc]ookie: \(cloudbox_session=[^;]*\).*/\1/p' <<<"$headers")
flags=$(grep -i '^set-cookie:' <<<"$headers")
[[ $flags == *HttpOnly* && $flags == *SameSite=Strict* ]] && pass "cookie HttpOnly + SameSite=Strict" || fail "attributs du cookie : $flags"
expect "GET / avec le cookie" 200 "$(http -H "Cookie: $cookie" "$BASE/")"
expect "POST /_auth/login, mauvais jeton" 401 "$(http -X POST -H "Origin: $BASE" -H "Authorization: Bearer nope" "$BASE/_auth/login")"

section "Host et Origin"
expect "Host: evil.example (avec jeton)" 403 "$(http "${AUTH[@]}" -H 'Host: evil.example' "$BASE/")"
expect "Host: evil.example:8080 (cookie)" 403 "$(http -H "Cookie: $cookie" -H 'Host: evil.example:8080' "$BASE/")"
expect "Host: localhost (avec jeton)" 200 "$(http "${AUTH[@]}" -H 'Host: localhost:8080' "$BASE/")"
expect "Host: 127.0.0.1 sur un autre port publié" 200 "$(http "${AUTH[@]}" -H 'Host: 127.0.0.1:9090' "$BASE/")"
expect "Origin étrangère (avec jeton)" 403 "$(http "${AUTH[@]}" -H 'Origin: http://evil.example' "$BASE/")"
expect "WebSocket, Origin étrangère + jeton" "HTTP 403" "$(probe "$BASE/term/pwsh/ws" "$TOKEN" http://evil.example | head -n 1)"
expect "WebSocket sans Origin + jeton" "HTTP 403" "$(probe "$BASE/term/pwsh/ws" "$TOKEN" - | head -n 1)"

section "En-têtes de sécurité"
h=$(docker exec "$NAME" curl -s -D - -o /dev/null "${AUTH[@]}" "$BASE/" | tr -d '\r')
grep -qi '^x-frame-options: DENY' <<<"$h" && pass "X-Frame-Options: DENY" || fail "X-Frame-Options"
grep -qi '^referrer-policy: no-referrer' <<<"$h" && pass "Referrer-Policy: no-referrer" || fail "Referrer-Policy"
grep -qi "^content-security-policy: default-src 'self'" <<<"$h" && pass "Content-Security-Policy" || fail "Content-Security-Policy"

section "Terminal web et session tmux"
out=$(probe "$BASE/term/pwsh/ws" "$TOKEN" "$BASE" '$cloudboxProbe = "persistant-42"; "PS=" + $PSVersionTable.PSVersion.Major')
grep -q 'PS=7' <<<"$out" && pass "/term/pwsh/ ouvre PowerShell 7" || fail "/term/pwsh/ : PowerShell 7 non détecté"
out=$(probe "$BASE/term/pwsh/ws" "$TOKEN" "$BASE" '"retrouve=" + $cloudboxProbe')
grep -q 'retrouve=persistant-42' <<<"$out" && pass "reconnexion : même session PowerShell" || fail "reconnexion : session perdue"
out=$(probe "$BASE/term/bash/ws" "$TOKEN" "$BASE" 'echo "shell=$0 bash=${BASH_VERSINFO[0]}"')
grep -q 'bash=5' <<<"$out" && pass "/term/bash/ ouvre Bash" || fail "/term/bash/ : Bash non détecté"
expect "sessions tmux" "bash pwsh" "$(docker exec "$NAME" tmux ls -F '#S' | sort | tr '\n' ' ' | sed 's/ $//')"

section "Processus et ports"
expect "seul le port 8080 en TCP" "8080" "$(docker exec "$NAME" ss -Hltn | awk '{ n = split($4, a, ":"); print a[n] }' | sort -u | tr '\n' ' ' | sed 's/ $//')"
expect "services lancés en dev" "dev" "$(docker exec "$NAME" ps -o user= -C caddy,ttyd,node | sort -u | tr '\n' ' ' | sed 's/ $//')"
if docker exec "$NAME" sudo -n true >/dev/null 2>&1; then fail "sudo accepté par défaut"; else pass "sudo refusé par défaut"; fi
expect "docker exec : pwsh en dev" "dev" "$(docker exec "$NAME" pwsh -NoProfile -Command '[Environment]::UserName' | tr -d '\r')"

section "Jeton généré (sans CLOUDBOX_TOKEN)"
docker run -d --name "$NAME-gen" "$IMAGE" >/dev/null
if wait_healthy "$NAME-gen"; then
    gen=$(docker exec "$NAME-gen" cat /home/dev/.cloudbox/token)
    [[ $gen =~ ^[0-9a-f]{64}$ ]] && pass "jeton généré (64 caractères hexadécimaux)" || fail "jeton généré invalide"
    docker logs "$NAME-gen" 2>&1 | grep -q "Jeton d'accès : $gen" && pass "jeton affiché dans les logs" || fail "jeton absent des logs"
    expect "perms du fichier jeton" "600" "$(docker exec "$NAME-gen" stat -c %a /home/dev/.cloudbox/token)"
    expect "GET / avec le jeton généré" 200 "$(docker exec "$NAME-gen" curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $gen" "$BASE/")"
else
    fail "le container sans CLOUDBOX_TOKEN ne démarre pas"
fi

section "CLOUDBOX_MODE=shell"
docker run -d --name "$NAME-shell" -e CLOUDBOX_MODE=shell "$IMAGE" >/dev/null
sleep 5
expect "container en marche" "true" "$(docker inspect -f '{{.State.Running}}' "$NAME-shell")"
expect "aucun port en écoute" "" "$(docker exec "$NAME-shell" ss -Hltn)"
expect "docker exec pwsh" "dev" "$(docker exec "$NAME-shell" pwsh -NoProfile -Command '[Environment]::UserName' | tr -d '\r')"

finish
