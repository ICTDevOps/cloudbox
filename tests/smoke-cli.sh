#!/usr/bin/env bash
# Test de fumée de l'image :cli.
#   tests/smoke-cli.sh [image]      (défaut : cloudbox:cli)
set -uo pipefail
cd "$(dirname "$0")"
. ./lib.sh

IMAGE=${1:-cloudbox:cli}
run() { docker run --rm "$IMAGE" "$@"; }

section "Utilisateur"
expect "utilisateur par défaut" "dev 1000" "$(run bash -c 'echo "$(id -un) $(id -u)"' | tr -d '\r')"
expect "HOME" "/home/dev" "$(run bash -c 'echo $HOME' | tr -d '\r')"

section "Outils (cloudbox-versions --check)"
if out=$(run cloudbox-versions --check 2>&1); then
    echo "$out" | sed 's/^/    /'
    pass "tous les outils répondent"
else
    echo "$out" | sed 's/^/    /'
    fail "au moins un outil ne répond pas"
fi

section "Modules PowerShell (import en dev, un processus par module)"
for m in Az.Accounts Az.Resources Microsoft.Graph.Authentication Microsoft.Graph.Users \
         ExchangeOnlineManagement MicrosoftTeams PnP.PowerShell; do
    if out=$(run pwsh -NoLogo -NoProfile -Command "\$ErrorActionPreference='Stop'; Import-Module $m; (Get-Module $m).Version.ToString()" 2>&1); then
        pass "Import-Module $m ($(echo "$out" | tail -n 1 | tr -d '\r'))"
    else
        fail "Import-Module $m"
        echo "$out" | tail -n 5 | sed 's/^/    /'
    fi
done

section "sudo"
if run bash -c 'sudo -n true' >/dev/null 2>&1; then fail "sudo accepté sans CLOUDBOX_SUDO"; else pass "sudo refusé par défaut"; fi
if docker run --rm -e CLOUDBOX_SUDO=true "$IMAGE" bash -c 'sudo -n true' >/dev/null 2>&1; then
    pass "sudo accepté avec CLOUDBOX_SUDO=true"
else
    fail "sudo refusé avec CLOUDBOX_SUDO=true"
fi
if run bash -c 'CLOUDBOX_SUDO=true sudo -n /usr/local/sbin/cloudbox-root-init; sudo -n true' >/dev/null 2>&1; then
    fail "dev peut s'accorder sudo en changeant sa propre variable"
else
    pass "CLOUDBOX_SUDO lu depuis le PID 1, pas depuis l'appelant"
fi

section "Shells"
expect "bash : alias bat" "alias bat='batcat'" "$(run bash -ic 'alias bat' 2>/dev/null | tr -d '\r')"
expect "bash : complétion az chargée" "ok" "$(run bash -ic 'complete -p az >/dev/null && echo ok' 2>/dev/null | tr -d '\r')"
expect "bash : complétion kubectl chargée" "ok" "$(run bash -ic '_completion_loader kubectl 2>/dev/null; complete -p kubectl >/dev/null && echo ok' 2>/dev/null | tr -d '\r')"
expect "cloudbox-shell (pwsh par défaut)" "pwsh" "$(run cloudbox-shell -NoProfile -Command '(Get-Process -Id $PID).ProcessName' | tr -d '\r')"
expect "cloudbox-shell (CLOUDBOX_SHELL=bash)" "bash" "$(docker run --rm -e CLOUDBOX_SHELL=bash "$IMAGE" cloudbox-shell -c 'basename $0' | tr -d '\r')"

finish
