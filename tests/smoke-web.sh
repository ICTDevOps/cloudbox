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

cleanup() { docker rm -f "$NAME" "$NAME-gen" "$NAME-sudo" "$NAME-shell" >/dev/null 2>&1; }
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
# CLOUDBOX_ASSISTANT_ALLOW_HTTP : faux fournisseur d'IA local (section « Assistant IA ») ;
# clé OpenAI fictive : jamais renvoyée par l'API, jamais visible dans un terminal
OPENAI_KEY=sk-proj-smoketest$(openssl rand -hex 12)
docker run -d --name "$NAME" -e CLOUDBOX_TOKEN="$TOKEN" -e CLOUDBOX_ASSISTANT_ALLOW_HTTP=1 -e CLOUDBOX_OPENAI_API_KEY="$OPENAI_KEY" "$IMAGE" >/dev/null
if wait_healthy "$NAME"; then pass "Caddy répond"; else fail "Caddy ne répond pas"; finish; fi

section "Sans jeton : 401"
for p in / /index.html /versions.json /term/pwsh/ /term/bash/ /code/; do
    expect "GET $p" 401 "$(http "$BASE$p")"
done
expect "WebSocket /term/pwsh/ws" "HTTP 401" "$(probe "$BASE/term/pwsh/ws" - "$BASE" | head -n 1)"
expect "WebSocket /term/bash/ws" "HTTP 401" "$(probe "$BASE/term/bash/ws" - "$BASE" | head -n 1)"
expect "WebSocket /code/" "HTTP 401" "$(probe "$BASE/code/?reconnectionToken=x&skipWebSocketFrames=false" - "$BASE" | head -n 1)"
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
expect "page ttyd personnalisée (menu contextuel)" 1 "$(docker exec "$NAME" curl -s --compressed "${AUTH[@]}" "$BASE/term/pwsh/" | grep -c "Cloudbox : le clic droit va à tmux")"
# code-server démarre après l'installation des extensions (premier démarrage) : page d'attente (503)
for _ in $(seq 1 45); do
    code=$(http -L --max-redirs 5 "${AUTH[@]}" "$BASE/code/")
    [[ $code == 503 ]] || break
    sleep 2
done
expect "GET /code/ (redirections suivies)" 200 "$code"
# code-server arrêté : page d'attente qui se recharge seule, affichable dans le panneau du workspace
docker exec "$NAME" /command/s6-svc -d /run/service/code-server
sleep 1
page=$(docker exec "$NAME" curl -s -D - "${AUTH[@]}" "$BASE/code/?folder=/home/dev" | tr -d '\r')
grep -q '^HTTP/1.1 503' <<<"$page" && grep -q 'VS Code démarre' <<<"$page" && grep -q 'http-equiv="refresh"' <<<"$page" \
    && grep -qi '^x-frame-options: SAMEORIGIN' <<<"$page" && ! grep -qi '^server:' <<<"$page" && pass "code-server indisponible : page d'attente (503)" \
    || fail "code-server indisponible : $(head -c 300 <<<"$page")"
expect "autre service indisponible : pas de page d'attente" 0 "$(docker exec "$NAME" curl -s "${AUTH[@]}" "$BASE/api/inconnu" | grep -c 'VS Code démarre')"
docker exec "$NAME" /command/s6-svc -u /run/service/code-server
for _ in $(seq 1 30); do
    [[ $(http "${AUTH[@]}" "$BASE/code/healthz") == 200 ]] && break
    sleep 1
done
expect "code-server relancé" 200 "$(http "${AUTH[@]}" "$BASE/code/healthz")"
expect "GET /code (sans slash, query conservée)" "/code/?folder=/home/dev" \
    "$(docker exec "$NAME" curl -s -o /dev/null -w '%{redirect_url}' "${AUTH[@]}" "$BASE/code?folder=/home/dev" | sed 's#^http://[^/]*##')"
expect "WebSocket /term/pwsh/ws" "HTTP 101" "$(probe "$BASE/term/pwsh/ws" "$TOKEN" "$BASE" | head -n 1)"

versions=$(docker exec "$NAME" curl -s "${AUTH[@]}" "$BASE/versions.json")
expect "versions.json : version de code-server" \
    "$(docker exec "$NAME" code-server --version 2>/dev/null | awk 'NR == 1 { print $1 }')" \
    "$(docker exec -i "$NAME" jq -r '.tools[] | select(.name == "code-server") | .version' <<<"$versions")"
expect "versions.json : aucun outil sans version" 0 "$(docker exec -i "$NAME" jq '[.tools[] | select(.version == "")] | length' <<<"$versions")"

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
grep -qi "^content-security-policy: default-src 'self'; script-src 'self';" <<<"$h" && pass "Content-Security-Policy stricte sur le portail" || fail "Content-Security-Policy du portail"
# ttyd et code-server embarquent du JavaScript inline : la CSP stricte du portail ne doit pas s'y appliquer
h=$(docker exec "$NAME" curl -s -D - -o /dev/null "${AUTH[@]}" "$BASE/term/pwsh/" | tr -d '\r')
expect "une seule CSP sur /term/pwsh/" 1 "$(grep -ci '^content-security-policy:' <<<"$h")"
grep -qi "^content-security-policy:.*script-src 'self' 'unsafe-inline'" <<<"$h" && pass "CSP du terminal (scripts inline de ttyd)" || fail "CSP du terminal"
h=$(docker exec "$NAME" curl -s -D - -o /dev/null "${AUTH[@]}" "$BASE/code/?folder=/home/dev" | tr -d '\r')
grep -qi "^x-frame-options: SAMEORIGIN" <<<"$h" && pass "X-Frame-Options: SAMEORIGIN sur /code/ (webviews)" || fail "X-Frame-Options de /code/"
grep -qi "^content-security-policy: .*script-src 'self';" <<<"$h" && fail "CSP stricte du portail appliquée à /code/" || pass "pas de CSP stricte sur /code/"

section "Cache du portail"
h=$(docker exec "$NAME" curl -s -D - -o /dev/null "${AUTH[@]}" "$BASE/" | tr -d '\r')
grep -qi '^cache-control: no-cache' <<<"$h" && pass "index.html revalidé (no-cache)" || fail "Cache-Control de /"
asset=$(docker exec "$NAME" curl -s "${AUTH[@]}" "$BASE/" | grep -o '/assets/index-[A-Za-z0-9_-]*\.js' | head -n 1)
h=$(docker exec "$NAME" curl -s -D - -o /dev/null "$BASE$asset" | tr -d '\r')
grep -qi '^cache-control: .*immutable' <<<"$h" && pass "fichiers à empreinte immuables ($asset)" || fail "Cache-Control de $asset"

section "API et workspaces"
api() { docker exec "$NAME" curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${AUTH[@]}" "$@" | tr -d '\r'; }
JSON=(-H 'Content-Type: application/json' -H "Origin: $BASE")
expect "GET /api/workspaces sans jeton" 401 "$(http "$BASE/api/workspaces")"
expect "GET /api/context" 200 "$(api "$BASE/api/context")"
expect "POST sans Content-Type JSON (CSRF)" 415 "$(api -X POST -H 'Content-Type: text/plain' -d '{"id":"x","name":"x","env":"dev"}' "$BASE/api/workspaces")"
expect "POST identifiant invalide" 400 "$(api -X POST "${JSON[@]}" -d '{"id":"../x","name":"x","env":"dev"}' "$BASE/api/workspaces")"
expect "POST dossier hors /home/dev" 400 "$(api -X POST "${JSON[@]}" -d '{"id":"evil","name":"x","env":"dev","folder":"/etc"}' "$BASE/api/workspaces")"
expect "POST dossier ../../etc" 400 "$(api -X POST "${JSON[@]}" -d '{"id":"evil","name":"x","env":"dev","folder":"../../etc"}' "$BASE/api/workspaces")"
expect "message d'erreur en anglais (Accept-Language)" "Invalid environment (dev, acc or prd)" \
    "$(docker exec "$NAME" curl -s -X POST "${AUTH[@]}" "${JSON[@]}" -H 'Accept-Language: en' -d '{"id":"evil","name":"x","env":"prod"}' "$BASE/api/workspaces" | docker exec -i "$NAME" jq -r .error)"
expect "POST environnement invalide" 400 "$(api -X POST "${JSON[@]}" -d '{"id":"evil","name":"x","env":"prod"}' "$BASE/api/workspaces")"
expect "POST workspace client" 201 "$(api -X POST "${JSON[@]}" -d '{"id":"client","name":"Client","env":"dev"}' "$BASE/api/workspaces")"
expect "POST workspace client-prd" 201 "$(api -X POST "${JSON[@]}" -d '{"id":"client-prd","name":"Client PRD","env":"prd"}' "$BASE/api/workspaces")"
expect "POST doublon" 409 "$(api -X POST "${JSON[@]}" -d '{"id":"client","name":"Client","env":"dev"}' "$BASE/api/workspaces")"
expect "dossier créé" "dev" "$(docker exec "$NAME" stat -c %U /home/dev/workspaces/client)"
expect "liste des workspaces" "client client-prd" "$(docker exec "$NAME" curl -s "${AUTH[@]}" "$BASE/api/workspaces" | docker exec -i "$NAME" jq -r '[.[].id] | sort | join(" ")')"
expect "PUT disposition" 200 "$(api -X PUT "${JSON[@]}" -d '{"layout":{"grid":{}}}' "$BASE/api/workspaces/client")"
alloc() { docker exec "$NAME" curl -s -X POST "${AUTH[@]}" "${JSON[@]}" "$BASE/api/workspaces/$1/panels" | docker exec -i "$NAME" jq -r .n; }
expect "numéro de panneau attribué par le serveur" "1 2" "$(alloc client) $(alloc client)"
# 8 attributions simultanées : 8 numéros distincts (verrou par workspace dans l'API)
nums=$(docker exec "$NAME" bash -c "for i in \$(seq 8); do curl -s -X POST -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' -H 'Origin: $BASE' $BASE/api/workspaces/client/panels & done; wait" | grep -o '[0-9]\+' | sort -n | uniq | wc -l)
expect "attributions simultanées distinctes" 8 "$nums"
expect "compteur enregistré" 11 "$(docker exec "$NAME" jq .nextPanel /home/dev/.cloudbox/workspaces/client.json)"

out=$(probe "$BASE/term/pwsh/ws?arg=client~1" "$TOKEN" "$BASE" '"cwd=" + (Get-Location) + " ws=" + $env:CLOUDBOX_WORKSPACE')
grep -q 'cwd=/home/dev/workspaces/client ws=client' <<<"$out" && pass "panneau de workspace : dossier et variable" || fail "panneau de workspace : $(tail -c 300 <<<"$out")"
probe "$BASE/term/bash/ws?arg=client-prd~2" "$TOKEN" "$BASE" 'echo ok' >/dev/null
for bad in '../x~1' 'client~1&arg=other~2' 'inconnu~1' 'client' 'Client~1'; do
    out=$(probe "$BASE/term/pwsh/ws?arg=$bad" "$TOKEN" "$BASE" 'echo should-not-run')
    grep -q 'Cloudbox :' <<<"$out" && pass "argument refusé : $bad" || fail "argument accepté : $bad"
done
expect "sessions tmux des workspaces" "client-prd_bash_2 client_pwsh_1" "$(docker exec "$NAME" tmux ls -F '#S' | grep _ | sort | tr '\n' ' ' | sed 's/ $//')"
expect "GET workspace : sessions" "client_pwsh_1" "$(docker exec "$NAME" curl -s "${AUTH[@]}" "$BASE/api/workspaces/client" | docker exec -i "$NAME" jq -r '.sessions | join(" ")')"
# Paramètres de connexion : jeux de caractères stricts (les valeurs sont saisies dans un terminal)
S="$BASE/api/workspaces/client"
expect "PUT paramètres valides" 200 "$(api -X PUT "${JSON[@]}" -d '{"settings":{"tenant":"contoso.onmicrosoft.com","subscription":"11111111-2222-3333-4444-555555555555","sharepointUrl":"https://contoso.sharepoint.com/sites/it","clientId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}}' "$S")"
expect "paramètres enregistrés" "contoso.onmicrosoft.com" "$(docker exec "$NAME" jq -r .settings.tenant /home/dev/.cloudbox/workspaces/client.json)"
for bad in '{"tenant":"x;id"}' '{"tenant":"$(id).com"}' '{"subscription":"prod"}' '{"sharepointUrl":"https://evil.example.com"}' '{"sharepointUrl":"https://c.sharepoint.com/\"x"}' '{"clientId":"1 2"}' '{"autre":"x"}'; do
    expect "PUT paramètres refusés : $bad" 400 "$(api -X PUT "${JSON[@]}" -d "{\"settings\":$bad}" "$S")"
done
expect "paramètre vidé" "null" "$(api -X PUT "${JSON[@]}" -d '{"settings":{"tenant":"contoso.onmicrosoft.com","clientId":""}}' "$S" >/dev/null; docker exec "$NAME" jq -c .settings.clientId /home/dev/.cloudbox/workspaces/client.json)"

# Saisie dans un terminal : texte littéral, sans Entrée
expect "POST saisie dans un terminal" 204 "$(api -X POST "${JSON[@]}" -d '{"text":"echo cloudbox-saisie $HOME"}' "$S/sessions/client_pwsh_1/input")"
sleep 1
expect "texte saisi, non exécuté" 1 "$(docker exec "$NAME" tmux capture-pane -p -t '=client_pwsh_1:' | grep -c 'cloudbox-saisie')"
docker exec "$NAME" tmux send-keys -t '=client_pwsh_1:' C-u
expect "saisie avec retour à la ligne refusée" 400 "$(api -X POST "${JSON[@]}" -d '{"text":"id\nid"}' "$S/sessions/client_pwsh_1/input")"
expect "saisie avec séquence d'échappement refusée" 400 "$(api -X POST "${JSON[@]}" -d '{"text":"\u001b[201~id"}' "$S/sessions/client_pwsh_1/input")"
expect "saisie dans un autre workspace refusée" 400 "$(api -X POST "${JSON[@]}" -d '{"text":"id"}' "$S/sessions/client-prd_bash_2/input")"
expect "saisie dans une session absente" 404 "$(api -X POST "${JSON[@]}" -d '{"text":"id"}' "$S/sessions/client_pwsh_9/input")"
expect "saisie sans Content-Type JSON (CSRF)" 415 "$(api -X POST -H 'Content-Type: text/plain' -d '{"text":"id"}' "$S/sessions/client_pwsh_1/input")"
expect "DELETE session d'un autre workspace" 400 "$(api -X DELETE "${JSON[@]}" "$BASE/api/workspaces/client/sessions/client-prd_bash_2")"
expect "DELETE workspace client" 204 "$(api -X DELETE "${JSON[@]}" "$BASE/api/workspaces/client")"
expect "sessions restantes (client-prd intact)" "client-prd_bash_2" "$(docker exec "$NAME" tmux ls -F '#S' | grep _ | sort | tr '\n' ' ' | sed 's/ $//')"
expect "dossier conservé après suppression" "yes" "$(docker exec "$NAME" test -d /home/dev/workspaces/client && echo yes)"
expect "DELETE session client-prd_bash_2" 204 "$(api -X DELETE "${JSON[@]}" "$BASE/api/workspaces/client-prd/sessions/client-prd_bash_2")"
h=$(docker exec "$NAME" curl -s -D - -o /dev/null "${AUTH[@]}" "$BASE/term/pwsh/" | tr -d '\r')
grep -qi '^x-frame-options: SAMEORIGIN' <<<"$h" && pass "terminal affichable en iframe de même origine" || fail "X-Frame-Options du terminal"

section "Assistant IA"
A="$BASE/api/assistant"
cfg=$(docker exec "$NAME" curl -s "${AUTH[@]}" "$A/config")
expect "assistant désactivé par défaut" "true false" "$(docker exec -i "$NAME" jq -r '"\(.allowed) \(.enabled)"' <<<"$cfg")"
expect "clé fournie par l'environnement" "true true" "$(docker exec -i "$NAME" jq -r '.providers[] | select(.id == "openai") | "\(.configured) \(.keyFromEnv)"' <<<"$cfg")"
expect "clé jamais renvoyée" 0 "$(grep -c "$OPENAI_KEY" <<<"$cfg")"
expect "assistant désactivé : 403" 403 "$(api "$BASE/api/workspaces/client-prd/assistant")"
expect "PUT config sans Content-Type JSON (CSRF)" 415 "$(api -X PUT -H 'Content-Type: text/plain' -d '{"enabled":true}' "$A/config")"
expect "URL http d'un autre hôte refusée" 400 "$(api -X PUT "${JSON[@]}" -d '{"providers":[{"id":"x","baseUrl":"http://example.com/v1","apiKey":"abcdefgh12"}]}' "$A/config")"
expect "URL avec identifiants refusée" 400 "$(api -X PUT "${JSON[@]}" -d '{"providers":[{"id":"x","baseUrl":"https://u:p@example.com/v1","apiKey":"abcdefgh12"}]}' "$A/config")"
docker exec -d "$NAME" node /usr/lib/cloudbox-api/test/fake-provider.ts 18089 /tmp/fake-provider.jsonl
sleep 1
expect "PUT config : fournisseur, clé, modèle par défaut" 200 "$(api -X PUT "${JSON[@]}" -d '{"enabled":true,"providers":[{"id":"fake","label":"Faux","type":"openai-compatible","baseUrl":"http://127.0.0.1:18089/v1","auth":"bearer","apiKey":"test-key-123456"}],"default":{"provider":"fake","model":"fake/model-a"}}' "$A/config")"
expect "config de l'assistant en 0600" 600 "$(docker exec "$NAME" stat -c %a /home/dev/.cloudbox/assistant/config.json)"
expect "clé saisie jamais renvoyée" 0 "$(docker exec "$NAME" curl -s "${AUTH[@]}" "$A/config" | grep -c test-key-123456)"
expect "modèles du fournisseur" "fake/model-a fake/model-b" "$(docker exec "$NAME" curl -s "${AUTH[@]}" "$A/models?provider=fake" | docker exec -i "$NAME" jq -r '.models | join(" ")')"
expect "POST workspace ia" 201 "$(api -X POST "${JSON[@]}" -d '{"id":"ia","name":"IA","env":"dev"}' "$BASE/api/workspaces")"
probe "$BASE/term/pwsh/ws?arg=ia~1" "$TOKEN" "$BASE" 'echo ok' >/dev/null
W="$BASE/api/workspaces/ia/assistant"
conv=$(docker exec "$NAME" curl -s -X POST "${AUTH[@]}" "${JSON[@]}" "$W/conversations" | docker exec -i "$NAME" jq -r .id)
[[ $conv =~ ^[a-z0-9]{8,32}$ ]] && pass "conversation créée" || fail "conversation : $conv"
expect "AGENTS.md créé dans le dossier du workspace" "dev" "$(docker exec "$NAME" stat -c %U /home/dev/workspaces/ia/AGENTS.md)"
sse=$(docker exec "$NAME" curl -sN --max-time 30 "${AUTH[@]}" "${JSON[@]}" -d '{"text":"Test avec password=Sup3rSecret99","activeSession":"ia_pwsh_1"}' "$W/conversations/$conv/messages")
grep -q '^event: proposal' <<<"$sse" && grep -q '"reason":"awaiting"' <<<"$sse" && pass "flux SSE : proposition en attente" || fail "flux SSE : $(head -c 400 <<<"$sse")"
expect "commande non exécutée avant validation" 0 "$(docker exec "$NAME" tmux capture-pane -p -t '=ia_pwsh_1:' | grep -c 'cloudbox-fake-ok')"
expect "secret masqué avant envoi au fournisseur" 0 "$(docker exec "$NAME" grep -c Sup3rSecret99 /tmp/fake-provider.jsonl)"
expect "secret masqué dans la conversation" 0 "$(docker exec "$NAME" grep -rc Sup3rSecret99 /home/dev/.cloudbox/assistant/workspaces/ia | awk -F: '{ n += $2 } END { print n + 0 }')"
pid=$(docker exec "$NAME" jq -r '.proposals[0].id' "/home/dev/.cloudbox/assistant/workspaces/ia/conversations/$conv.json")
P="$W/conversations/$conv/proposals/$pid"
expect "validation : session d'un autre workspace refusée" 400 "$(api -X POST "${JSON[@]}" -d '{"session":"client-prd_bash_2","command":"echo x"}' "$P/approve")"
expect "validation : retour à la ligne refusé" 400 "$(api -X POST "${JSON[@]}" -d '{"session":"ia_pwsh_1","command":"echo x\nid"}' "$P/approve")"
expect "validation sans Content-Type JSON (CSRF)" 415 "$(api -X POST -H 'Content-Type: text/plain' -d '{"session":"ia_pwsh_1","command":"echo x"}' "$P/approve")"
# Texte déjà saisi (panneau Connexions, frappe en cours) : il serait exécuté avec la commande
api -X POST "${JSON[@]}" -d '{"text":"echo deja-saisi"}' "$BASE/api/workspaces/ia/sessions/ia_pwsh_1/input" >/dev/null
sleep 1
expect "validation refusée si la ligne n'est pas vide" 409 "$(api -X POST "${JSON[@]}" -d '{"session":"ia_pwsh_1","command":"echo x"}' "$P/approve")"
docker exec "$NAME" tmux send-keys -t '=ia_pwsh_1:' C-u
sleep 1
sse=$(docker exec "$NAME" curl -sN --max-time 60 "${AUTH[@]}" "${JSON[@]}" -d '{"session":"ia_pwsh_1","command":"echo cloudbox-fake-ok"}' "$P/approve")
if grep -q '^event: executed' <<<"$sse" && grep -q 'Résultat : ' <<<"$sse"; then
    pass "commande validée : exécutée, sortie relue"
else
    fail "validation : $(head -c 400 <<<"$sse")"
    # Diagnostic : état du panneau tmux et journal de l'API
    docker exec "$NAME" tmux display-message -p -t '=ia_pwsh_1:' 'cmd=#{pane_current_command} x=#{cursor_x} y=#{cursor_y} signal=#{@cloudbox_prompt}'
    docker exec "$NAME" tmux capture-pane -p -t '=ia_pwsh_1:' | cat -A | tail -n 8
    docker logs "$NAME" 2>&1 | grep 'cloudbox-api' | tail -n 5
fi
expect "commande exécutée dans le terminal" 1 "$(docker exec "$NAME" tmux capture-pane -p -t '=ia_pwsh_1:' | grep -c '^cloudbox-fake-ok')"
grep -q '"exitCode":0' <<<"$sse" && pass "fin de commande signalée par le prompt (code de sortie)" || fail "signal du prompt absent : $(grep executed -A1 <<<"$sse" | tail -c 300)"
expect "seconde validation refusée" 409 "$(api -X POST "${JSON[@]}" -d '{"session":"ia_pwsh_1","command":"echo x"}' "$P/approve")"
expect "clés API absentes de l'environnement des terminaux" 0 "$(docker exec "$NAME" tmux show-environment -g | grep -c '_API_KEY')"
expect "DELETE workspace ia" 204 "$(api -X DELETE "${JSON[@]}" "$BASE/api/workspaces/ia")"
expect "conversations supprimées avec le workspace" "absent" "$(docker exec "$NAME" test -e /home/dev/.cloudbox/assistant/workspaces/ia && echo present || echo absent)"
docker exec "$NAME" pkill -f fake-provider.ts

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
docker run -d --name "$NAME-gen" -e CLOUDBOX_ASSISTANT=off "$IMAGE" >/dev/null
if wait_healthy "$NAME-gen"; then
    gen=$(docker exec "$NAME-gen" cat /home/dev/.cloudbox/token)
    [[ $gen =~ ^[0-9a-f]{64}$ ]] && pass "jeton généré (64 caractères hexadécimaux)" || fail "jeton généré invalide"
    # grep sans -q : avec pipefail, -q s'arrête au premier résultat et docker logs reçoit SIGPIPE
    docker logs "$NAME-gen" 2>&1 | grep "Jeton d'accès : $gen" >/dev/null && pass "jeton affiché dans les logs" || fail "jeton absent des logs"
    expect "perms du fichier jeton" "600" "$(docker exec "$NAME-gen" stat -c %a /home/dev/.cloudbox/token)"
    expect "GET / avec le jeton généré" 200 "$(docker exec "$NAME-gen" curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $gen" "$BASE/")"
    expect "CLOUDBOX_ASSISTANT=off : assistant interdit" 403 "$(docker exec "$NAME-gen" curl -s -o /dev/null -w '%{http_code}' -X PUT -H "Authorization: Bearer $gen" -H 'Content-Type: application/json' -d '{"enabled":true}' "$BASE/api/assistant/config")"
else
    fail "le container sans CLOUDBOX_TOKEN ne démarre pas"
fi

section "CLOUDBOX_SUDO=true"
docker run -d --name "$NAME-sudo" -e CLOUDBOX_SUDO=true "$IMAGE" >/dev/null
if wait_healthy "$NAME-sudo"; then
    expect "sudo accepté" "root" "$(docker exec "$NAME-sudo" sudo -n whoami 2>&1 | tr -d '\r')"
else
    fail "le container avec CLOUDBOX_SUDO=true ne démarre pas"
fi

section "CLOUDBOX_MODE=shell"
docker run -d --name "$NAME-shell" -e CLOUDBOX_MODE=shell "$IMAGE" >/dev/null
sleep 5
expect "container en marche" "true" "$(docker inspect -f '{{.State.Running}}' "$NAME-shell")"
expect "aucun port en écoute" "" "$(docker exec "$NAME-shell" ss -Hltn)"
expect "docker exec pwsh" "dev" "$(docker exec "$NAME-shell" pwsh -NoProfile -Command '[Environment]::UserName' | tr -d '\r')"

finish
