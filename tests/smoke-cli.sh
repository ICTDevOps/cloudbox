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

section "Connect-Cloudbox (-WhatIf, paramètres du workspace)"
# Faux workspace avec tenant, abonnement et ClientId : commandes attendues, rien n'est lancé
connect_ws='New-Item -ItemType Directory -Force ~/.cloudbox/workspaces | Out-Null
@{ id = "demo"; settings = @{ tenant = "contoso.onmicrosoft.com"; subscription = "11111111-2222-3333-4444-555555555555"; clientId = "3f2a8c1e-5b7d-4e9a-a1c2-7d6e5f4b3a21" } } |
    ConvertTo-Json | Set-Content ~/.cloudbox/workspaces/demo.json'
out=$(docker run --rm -e CLOUDBOX_WORKSPACE=demo "$IMAGE" pwsh -NoLogo -Command "$connect_ws
Connect-Cloudbox -Services All -WhatIf" 2>&1 | tr -d '\r')
for want in 'az login --use-device-code --tenant contoso.onmicrosoft.com' \
            'Connect-AzAccount -UseDeviceAuthentication -Tenant contoso.onmicrosoft.com -Subscription 11111111-2222-3333-4444-555555555555' \
            'Connect-MgGraph -UseDeviceCode -Scopes User.Read.All -NoWelcome -TenantId contoso.onmicrosoft.com' \
            'Connect-ExchangeOnline -Device' 'Connect-MicrosoftTeams -UseDeviceAuthentication -TenantId contoso.onmicrosoft.com' \
            'Connect-PnPOnline -Url https://contoso.sharepoint.com -DeviceLogin -ClientId 3f2a8c1e-5b7d-4e9a-a1c2-7d6e5f4b3a21' \
            'm365 login --authType deviceCode --tenant contoso.onmicrosoft.com --appId 3f2a8c1e-5b7d-4e9a-a1c2-7d6e5f4b3a21'; do
    grep -qF -- "$want" <<<"$out" && pass "${want%% *} ${want#* }" || fail "commande absente : $want"
done
grep -qi 'error\|erreur' <<<"$out" && fail "erreurs affichées : $(grep -i 'error\|erreur' <<<"$out" | head -n 3)" || pass "aucune erreur affichée"
out=$(docker run --rm -e CLOUDBOX_WORKSPACE=demo "$IMAGE" pwsh -NoLogo -Command "$connect_ws
Connect-Cloudbox -Services PnP -ClientId '' -WhatIf" 2>&1 | tr -d '\r')
grep -q 'ClientId' <<<"$out" && ! grep -q 'Connect-PnPOnline' <<<"$out" && pass "PnP ignoré sans ClientId" || fail "PnP sans ClientId : $out"
# Teams : appelée depuis le module, Connect-MicrosoftTeams doit être l'enveloppe du profil (compte retenu)
expect "Connect-MicrosoftTeams vue du module : enveloppe du profil" "Function" \
    "$(run pwsh -NoLogo -Command '& (Import-Module Cloudbox.Connect -PassThru) { (Get-Command Connect-MicrosoftTeams).CommandType }' 2>&1 | tr -d '\r' | tail -n 1)"
out=$(run pwsh -NoLogo -Command 'try { Connect-Cloudbox -Tenant "a;b" -WhatIf; "accepted" } catch { "refused" }' 2>&1 | tr -d '\r')
expect "tenant invalide refusé" "refused" "$(tail -n 1 <<<"$out")"

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
