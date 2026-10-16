#!/usr/bin/env bash
# Test des scripts côté poste (scripts/*.ps1) sur une image :web locale : installation, mise à jour (à jour,
# terminal ouvert, -Force), désinstallation, plus PSScriptAnalyzer. Demande pwsh et docker sur l'hôte.
# La tâche planifiée et le profil Windows Terminal (Windows uniquement) ne sont pas testés ici.
#   tests/smoke-scripts.sh [image]      (défaut : cloudbox:web)
set -uo pipefail
cd "$(dirname "$0")"
. ./lib.sh

IMAGE=${1:-cloudbox:web}
ID=cloudbox-scripts-$$
WORK=$(mktemp -d)
PORT=$(( 20000 + $$ % 20000 ))

cleanup() {
    docker rm -f "$ID" >/dev/null 2>&1
    docker volume rm "$ID" >/dev/null 2>&1
    docker rmi "$ID-alt:test" >/dev/null 2>&1
    rm -rf "$WORK"
}
trap cleanup EXIT

# Copie des scripts (la configuration locale écrite par Install reste dans la copie) ; HOME temporaire :
# dossier d'installation (~/.local/share/cloudbox) jetable
mkdir -p "$WORK/repo" "$WORK/home"
cp -r ../scripts ../config "$WORK/repo/"
ps() { HOME="$WORK/home" pwsh -NoLogo -NoProfile -NonInteractive -File "$WORK/repo/scripts/$1" "${@:2}" 2>&1 | tr -d '\r'; }
cid() { docker container inspect -f '{{.Id}}' "$ID" 2>/dev/null; }

section "PSScriptAnalyzer"
if pwsh -NoProfile -Command 'exit [int](-not (Get-Module -ListAvailable PSScriptAnalyzer))'; then
    out=$(pwsh -NoProfile -Command "Invoke-ScriptAnalyzer -Path ../scripts -Recurse -Settings ../scripts/PSScriptAnalyzerSettings.psd1 | Format-Table RuleName, ScriptName, Line, Message -AutoSize | Out-String -Width 200")
    [[ -z ${out//[[:space:]]/} ]] && pass "aucun avertissement" || { fail "avertissements"; echo "$out"; }
else
    pass "PSScriptAnalyzer absent : analyse sautée"
fi
for f in ../scripts/*.ps1 ../scripts/*.psm1 ../config/cloudbox.psd1; do
    [[ $(head -c 3 "$f" | od -An -tx1 | tr -d ' ') == efbbbf ]] || fail "BOM UTF-8 absent (accents illisibles sous Windows PowerShell 5.1) : $f"
done
pass "BOM UTF-8 sur les scripts"

section "Install-Cloudbox.ps1"
# Container du même nom créé ailleurs (docker run, Docker Compose) : jamais remplacé sans -Force
docker create --name "$ID" "$IMAGE" >/dev/null
foreign=$(cid)
out=$(ps Install-Cloudbox.ps1 -Image "$IMAGE" -ContainerName "$ID" -Volume "$ID" -Port "$PORT" -NoScheduledTask -NoTerminalProfile)
grep -q 'Installation arrêtée' <<<"$out" && [[ $(cid) == "$foreign" ]] &&
    pass "container créé ailleurs : installation refusée, container intact" || fail "container créé ailleurs : $out"
docker rm -f "$ID" >/dev/null
out=$(ps Install-Cloudbox.ps1 -Image "$IMAGE" -ContainerName "$ID" -Volume "$ID" -Port "$PORT" -NoScheduledTask -NoTerminalProfile)
token=$(sed -n "s/^ Jeton d'accès : //p" <<<"$out")
if grep -q "Cloudbox est prêt : http://localhost:$PORT" <<<"$out" && [[ ${#token} -ge 16 ]]; then
    pass "installé, URL et jeton affichés"
else
    fail "installation"; echo "$out" | tail -n 20; finish
fi
expect "port publié sur 127.0.0.1 uniquement" "127.0.0.1:$PORT" \
    "$(docker inspect -f '{{range (index .HostConfig.PortBindings "8080/tcp")}}{{.HostIp}}:{{.HostPort}}{{end}}' "$ID")"
expect "volume /home/dev" "$ID" "$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/home/dev"}}{{.Name}}{{end}}{{end}}' "$ID")"
expect "pas de mode privilégié" "false" "$(docker inspect -f '{{.HostConfig.Privileged}}' "$ID")"
http() { docker exec "$ID" curl -s -o /dev/null -w '%{http_code}' "$@" http://127.0.0.1:8080/ | tr -d '\r'; }
expect "sans jeton : 401" "401" "$(http)"
expect "avec le jeton affiché : 200" "200" "$(http -H "Authorization: Bearer $token")"
grep -q "Port = $PORT" "$WORK/repo/config/cloudbox.local.psd1" && pass "paramètres enregistrés (cloudbox.local.psd1)" || fail "cloudbox.local.psd1"
[[ -f $WORK/home/.local/share/cloudbox/scripts/Update-Cloudbox.ps1 && -f $WORK/home/.local/share/cloudbox/config/cloudbox.local.psd1 ]] &&
    pass "scripts et configuration copiés dans le dossier d'installation" || fail "dossier d'installation"

section "Update-Cloudbox.ps1"
before=$(cid)
out=$(ps Update-Cloudbox.ps1)
grep -q 'à jour' <<<"$out" && [[ $(cid) == "$before" ]] && pass "image inchangée : container conservé" || fail "à jour : $out"

# Autre nom d'image (même contenu) : recréation demandée ; terminal ouvert par docker exec : reportée
docker tag "$IMAGE" "$ID-alt:test"
sed -i "s|Image = .*|Image = '$ID-alt:test'|" "$WORK/repo/config/cloudbox.local.psd1"
docker exec -d "$ID" sleep 120
out=$(ps Update-Cloudbox.ps1)
grep -q 'reportée' <<<"$out" && [[ $(cid) == "$before" ]] && pass "terminal ouvert (docker exec) : recréation reportée" || fail "occupé : $out"
out=$(ps Update-Cloudbox.ps1 -Force)
if grep -q 'mis à jour' <<<"$out" && [[ $(cid) != "$before" ]]; then
    pass "-Force : container recréé"
else
    fail "-Force : $out"
fi
expect "image de la configuration" "$ID-alt:test" "$(docker inspect -f '{{.Config.Image}}' "$ID")"
for _ in $(seq 1 60); do [[ $(http) == 401 ]] && break; sleep 2; done
expect "jeton conservé par le volume après recréation" "200" "$(http -H "Authorization: Bearer $token")"

section "Uninstall-Cloudbox.ps1"
out=$(ps Uninstall-Cloudbox.ps1)
docker container inspect "$ID" >/dev/null 2>&1 && fail "container toujours là : $out" || pass "container supprimé"
docker volume inspect "$ID" >/dev/null 2>&1 && pass "volume conservé sans -RemoveData" || fail "volume supprimé sans -RemoveData"
out=$(ps Uninstall-Cloudbox.ps1 -RemoveData -Confirm:\$false)
docker volume inspect "$ID" >/dev/null 2>&1 && fail "volume toujours là : $out" || pass "-RemoveData : volume supprimé"
[[ -d $WORK/home/.local/share/cloudbox ]] && fail "dossier d'installation toujours là" || pass "-RemoveData : dossier d'installation supprimé"

finish
