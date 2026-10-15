#!/usr/bin/env bash
# Captures d'écran du README (interface en anglais), prises dans Chromium headless (Playwright)
# sur un container Cloudbox éphémère peuplé de workspaces d'exemple.
#   docs/screenshots/capture.sh [image]
set -euo pipefail
cd "$(dirname "$0")"

IMAGE=${1:-cloudbox:web}
NAME=cloudbox-shots-$$
TOKEN=$(openssl rand -hex 32)
BASE=http://127.0.0.1:8080
# renovate: datasource=docker depName=mcr.microsoft.com/playwright/python
PLAYWRIGHT_VERSION=v1.63.0-noble

cleanup() { docker rm -f "$NAME" "$NAME-pw" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$NAME" -e CLOUDBOX_TOKEN="$TOKEN" "$IMAGE" >/dev/null
for _ in $(seq 1 90); do
    [[ $(docker exec "$NAME" curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE/code/healthz" 2>/dev/null) == 200 ]] && break
    sleep 2
done

# Workspaces d'exemple (noms fictifs) et fichiers du workspace de production
api() { docker exec "$NAME" curl -sf -o /dev/null -X "$1" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "$3" "$BASE/api/workspaces$2"; }
api POST "" '{"id":"contoso-prd","name":"Contoso — production","env":"prd"}'
api POST "" '{"id":"fabrikam-acc","name":"Fabrikam — acceptance","env":"acc"}'
api POST "" '{"id":"lab","name":"Internal lab","env":"dev"}'
api PUT /contoso-prd '{"settings":{"tenant":"contoso.onmicrosoft.com","clientId":"3f2a8c1e-5b7d-4e9a-a1c2-7d6e5f4b3a21"}}'
# Assistant activé avec une clé fictive (la liste des modèles échoue, aucun message n'est envoyé) :
# panneau Assistant et onglet « AI assistant »
docker exec "$NAME" curl -sf -o /dev/null -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"enabled":true,"providers":[{"id":"openrouter","apiKey":"sk-or-demo-0000000000"}],"default":{"provider":"openrouter","model":"openrouter/auto"}}' \
    "$BASE/api/assistant/config"
docker exec -i -u dev "$NAME" bash -c 'cat > /home/dev/workspaces/contoso-prd/deploy.ps1' <<'PS1'
# Deploys the Contoso landing zone
param(
    [string]$Location = 'westeurope',
    [string]$ResourceGroup = 'rg-contoso-prd'
)

$context = Get-AzContext
if ($context.Tenant.Id -ne $env:CONTOSO_TENANT_ID) {
    throw "Wrong tenant: $($context.Tenant.Id)"
}

New-AzResourceGroup -Name $ResourceGroup -Location $Location -Force
New-AzResourceGroupDeployment -ResourceGroupName $ResourceGroup `
    -TemplateFile ./main.bicep -WhatIf
PS1
docker exec -i -u dev "$NAME" bash -c 'cat > /home/dev/workspaces/contoso-prd/main.bicep' <<'BICEP'
param location string = resourceGroup().location

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-contoso-prd'
  location: location
}
BICEP

docker create --name "$NAME-pw" --network "container:$NAME" -w /work \
    "mcr.microsoft.com/playwright/python:$PLAYWRIGHT_VERSION" \
    bash -c "pip install -q --root-user-action=ignore playwright==${PLAYWRIGHT_VERSION%%-*} >/dev/null 2>&1 && mkdir -p /out && python3 /work/capture.py $TOKEN /out" >/dev/null
docker cp capture.py "$NAME-pw:/work/capture.py"
docker start -a "$NAME-pw"
docker cp "$NAME-pw:/out/." .
ls -l ./*.png
