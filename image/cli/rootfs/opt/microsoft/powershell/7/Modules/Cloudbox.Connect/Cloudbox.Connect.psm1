# Cloudbox.Connect : connexion en une commande aux services du tenant d'un workspace (device code).
#   Connect-Cloudbox                         Az PowerShell et Graph, avec les paramètres du workspace
#   Connect-Cloudbox -Services All           tous les services
#   Connect-Cloudbox -Services EXO -WhatIf   commandes affichées, rien n'est lancé
#
# Les paramètres par défaut (tenant, abonnement, URL SharePoint, ClientId) viennent du workspace du
# terminal ($env:CLOUDBOX_WORKSPACE), déclarés dans ⚙ du workspace ; un paramètre explicite les remplace.
# Mêmes commandes que l'aide-mémoire du portail (connections.tsx). Les valeurs suivent les mêmes règles
# que cloudbox-api (SETTINGS_RULES de lib.ts) et sont passées en arguments, jamais interpolées dans une
# commande à exécuter.

$script:Order = @('AzCli', 'Az', 'Graph', 'EXO', 'Teams', 'PnP', 'M365')
$script:GuidRe = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$script:Rules = @{
    Tenant        = '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9]([a-z0-9-]{0,62}\.)+[a-z]{2,63})$'
    Subscription  = $script:GuidRe
    SharePointUrl = '^https://[a-z0-9][a-z0-9-]{0,62}\.sharepoint\.(com|us|de|cn)(/[A-Za-z0-9._~%/-]*)?$'
    ClientId      = $script:GuidRe
}

function Get-CloudboxText([string]$Fr, [string]$En) {
    $lang = if ($env:LC_ALL) { $env:LC_ALL } elseif ($env:LANG) { $env:LANG } else { (Get-Culture).Name }
    if ($lang -like 'fr*') { $Fr } else { $En }
}

# Réglages du workspace du terminal (champ settings de ~/.cloudbox/workspaces/<id>.json)
function Get-CloudboxWorkspaceSettings {
    $id = $env:CLOUDBOX_WORKSPACE
    if (-not $id -or $id -notmatch '^[a-z0-9][a-z0-9-]{0,31}$') { return @{} }
    $file = Join-Path $HOME ".cloudbox/workspaces/$id.json"
    $ws = try { Get-Content -Raw $file -ErrorAction Stop | ConvertFrom-Json } catch { $null }
    $out = @{}
    if ($ws -and $ws.settings) {
        foreach ($p in $ws.settings.PSObject.Properties) { $out[$p.Name] = "$($p.Value)" }
    }
    $out
}

# Abonnement par défaut d'az CLI, lu dans azureProfile.json (sans lancer az)
function Get-CloudboxAzCliAccount {
    $dir = if ($env:AZURE_CONFIG_DIR) { $env:AZURE_CONFIG_DIR } else { Join-Path $HOME '.azure' }
    $file = Join-Path $dir 'azureProfile.json'
    if (-not (Test-Path $file)) { return $null }
    $azProfile = try { (Get-Content -Raw $file -ErrorAction Stop).TrimStart([char]0xFEFF) | ConvertFrom-Json } catch { $null }
    $sub = $azProfile.subscriptions | Where-Object isDefault | Select-Object -First 1
    if ($sub) { @{ user = "$($sub.user.name)"; tenantId = "$($sub.tenantId)"; domain = "$($sub.tenantDefaultDomain)" } }
}

# Connexion de CLI for Microsoft 365 (fichier commun, jamais les jetons)
function Get-CloudboxM365Account {
    $c = try { Get-Content -Raw (Join-Path $HOME '.cli-m365-connection.json') -ErrorAction Stop | ConvertFrom-Json } catch { $null }
    if ($c -and $c.active -eq $true) { @{ user = "$($c.identityName)"; tenantId = "$($c.identityTenantId)" } }
}

# Session déjà ouverte sur le bon tenant ? Un tenant déclaré sous forme de domaine n'est comparable qu'au
# domaine par défaut (az) : sinon toute session ouverte compte.
function Test-CloudboxTenant($Account, [string]$Tenant) {
    if (-not $Account) { return $false }
    if (-not $Tenant) { return $true }
    if ($Tenant -match $script:GuidRe) { return "$($Account.tenantId)" -eq $Tenant }
    if ($Account.domain) { return "$($Account.domain)" -eq $Tenant }
    $true
}

function Get-CloudboxCurrent([string]$Service) {
    # Sessions de ce terminal : Get-CloudboxConnections vient du profil (absent avec -NoProfile)
    $conn = if (Get-Command Get-CloudboxConnections -ErrorAction SilentlyContinue) { Get-CloudboxConnections } else { @{} }
    switch ($Service) {
        'AzCli' { Get-CloudboxAzCliAccount }
        'Az' { $conn.azps }
        'Graph' { $conn.graph }
        'EXO' { $conn.exo }
        'Teams' { $conn.teams }
        'PnP' { $conn.pnp }
        'M365' { Get-CloudboxM365Account }
    }
}

# URL SharePoint déduite d'un tenant <nom>.onmicrosoft.com (même règle que le portail)
function Get-CloudboxSharePointUrl([string]$Url, [string]$Tenant) {
    if ($Url) { return $Url }
    if ($Tenant -match '^([a-z0-9-]+)\.onmicrosoft\.com$') { return "https://$($Matches[1].ToLower()).sharepoint.com" }
    $null
}

# Texte d'une commande (affichage, -WhatIf) : les valeurs validées ne contiennent ni espace ni guillemet
function Format-CloudboxCommand([string]$Name, [object[]]$Arguments) {
    (@($Name) + ($Arguments | ForEach-Object { if ("$_" -match '[\s,"]') { "`"$_`"" } else { "$_" } })) -join ' '
}

function Connect-Cloudbox {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [ValidateSet('All', 'AzCli', 'Az', 'Graph', 'EXO', 'Teams', 'PnP', 'M365')]
        [string[]]$Services = @('Az', 'Graph'),
        [string]$Tenant,
        [string]$Subscription,
        [string]$SharePointUrl,
        [string]$ClientId,
        [string[]]$GraphScopes = @('User.Read.All'),
        # Reconnecte même si une session est déjà ouverte sur le tenant
        [switch]$Force
    )

    $settings = Get-CloudboxWorkspaceSettings
    $values = @{
        Tenant        = if ($PSBoundParameters.ContainsKey('Tenant')) { $Tenant } else { $settings.tenant }
        Subscription  = if ($PSBoundParameters.ContainsKey('Subscription')) { $Subscription } else { $settings.subscription }
        SharePointUrl = if ($PSBoundParameters.ContainsKey('SharePointUrl')) { $SharePointUrl } else { $settings.sharepointUrl }
        ClientId      = if ($PSBoundParameters.ContainsKey('ClientId')) { $ClientId } else { $settings.clientId }
    }
    foreach ($k in @($values.Keys)) {
        if ($values[$k] -and $values[$k] -notmatch $script:Rules[$k]) {
            throw (Get-CloudboxText "Valeur invalide pour -$k : $($values[$k])" "Invalid value for -$k`: $($values[$k])")
        }
    }
    foreach ($s in $GraphScopes) {
        if ($s -notmatch '^[A-Za-z0-9._-]{1,100}$') { throw (Get-CloudboxText "Permission Graph invalide : $s" "Invalid Graph scope: $s") }
    }
    $t = $values.Tenant
    $spo = Get-CloudboxSharePointUrl $values.SharePointUrl $t
    $wanted = if ($Services -contains 'All') { $script:Order } else { $script:Order | Where-Object { $_ -in $Services } }

    # Connexions partagées : Az.Accounts n'est pas importé au démarrage, son contexte enregistré n'est lu
    # qu'à l'import (dans la portée globale, pour que le prompt le voie aussi)
    if ($wanted -contains 'Az' -and -not (Get-Module Az.Accounts)) { Import-Module Az.Accounts -Global -ErrorAction SilentlyContinue }

    $results = [System.Collections.Generic.List[object]]::new()
    foreach ($svc in $wanted) {
        $plan = switch ($svc) {
            'AzCli' {
                $a = @('login', '--use-device-code'); if ($t) { $a += '--tenant', $t }
                @{ Name = 'Azure CLI'; Command = 'az'; Arguments = $a }
            }
            'Az' {
                $p = [ordered]@{ UseDeviceAuthentication = $true }
                if ($t) { $p.Tenant = $t }
                if ($values.Subscription) { $p.Subscription = $values.Subscription }
                @{ Name = 'Az PowerShell'; Command = 'Connect-AzAccount'; Parameters = $p }
            }
            'Graph' {
                $p = [ordered]@{ UseDeviceCode = $true; Scopes = $GraphScopes; NoWelcome = $true }
                if ($t) { $p.TenantId = $t }
                @{ Name = 'Microsoft Graph'; Command = 'Connect-MgGraph'; Parameters = $p }
            }
            'EXO' {
                @{ Name = 'Exchange Online'; Command = 'Connect-ExchangeOnline'; Parameters = [ordered]@{ Device = $true; ShowBanner = $false } }
            }
            'Teams' {
                $p = [ordered]@{ UseDeviceAuthentication = $true }
                if ($t) { $p.TenantId = $t }
                @{ Name = 'Microsoft Teams'; Command = 'Connect-MicrosoftTeams'; Parameters = $p }
            }
            'PnP' {
                # PnP n'a plus d'application multi-tenant : sans ClientId (inscription d'application du tenant),
                # pas de connexion possible
                $skip = if (-not $values.ClientId) {
                    Get-CloudboxText 'ClientId manquant (⚙ du workspace ou -ClientId)' 'ClientId missing (workspace ⚙ or -ClientId)'
                } elseif (-not $spo) {
                    Get-CloudboxText 'URL SharePoint manquante (⚙ du workspace ou -SharePointUrl)' 'SharePoint URL missing (workspace ⚙ or -SharePointUrl)'
                }
                $p = [ordered]@{ Url = $spo; DeviceLogin = $true; ClientId = $values.ClientId }
                if ($t) { $p.Tenant = $t }
                @{ Name = 'PnP PowerShell'; Command = 'Connect-PnPOnline'; Parameters = $p; Skip = $skip }
            }
            'M365' {
                $a = @('login', '--authType', 'deviceCode')
                if ($t) { $a += '--tenant', $t }
                if ($values.ClientId) { $a += '--appId', $values.ClientId }
                @{ Name = 'CLI for Microsoft 365'; Command = 'm365'; Arguments = $a }
            }
        }
        $text = if ($plan.Arguments) {
            Format-CloudboxCommand $plan.Command $plan.Arguments
        } else {
            Format-CloudboxCommand $plan.Command ($plan.Parameters.GetEnumerator() | ForEach-Object {
                if ($_.Value -is [bool]) { if ($_.Value) { "-$($_.Key)" } else { "-$($_.Key):`$false" } }
                else { "-$($_.Key)"; $_.Value -join ',' }
            })
        }

        if ($plan.Skip) {
            Write-Warning "$($plan.Name) : $($plan.Skip)"
            $results.Add([pscustomobject]@{ Service = $svc; Name = $plan.Name; Status = 'Skipped'; Detail = $plan.Skip })
            continue
        }
        $current = Get-CloudboxCurrent $svc
        # PnP : la session vaut pour un site, comparé à l'URL demandée
        $same = if ($svc -eq 'PnP') { $current -and "$($current.url)".TrimEnd('/') -eq $spo.TrimEnd('/') } else { Test-CloudboxTenant $current $t }
        if (-not $Force -and $same) {
            $who = if ($current.user) { $current.user } else { $current.url }
            $results.Add([pscustomobject]@{ Service = $svc; Name = $plan.Name; Status = 'Connected'; Detail = $who })
            continue
        }
        if (-not $PSCmdlet.ShouldProcess($plan.Name, $text)) {
            $results.Add([pscustomobject]@{ Service = $svc; Name = $plan.Name; Status = 'WhatIf'; Detail = $text })
            continue
        }

        Write-Host "`n── $($plan.Name) ──" -ForegroundColor Cyan
        Write-Host "   $text" -ForegroundColor DarkGray
        try {
            if ($plan.Arguments) {
                & $plan.Command @($plan.Arguments)
                if ($LASTEXITCODE -ne 0) { throw "$($plan.Command) : exit $LASTEXITCODE" }
                if ($svc -eq 'AzCli' -and $values.Subscription) {
                    & az account set --subscription $values.Subscription
                    if ($LASTEXITCODE -ne 0) { throw "az account set : exit $LASTEXITCODE" }
                }
            } else {
                $p = $plan.Parameters
                # Résolu dans la portée globale : l'enveloppe Connect-MicrosoftTeams du profil retient le compte
                # Out-Host et non Out-Null : Connect-MgGraph écrit son code device dans le flux de sortie
                & $plan.Command @p -ErrorAction Stop | Out-Host
            }
            $results.Add([pscustomobject]@{ Service = $svc; Name = $plan.Name; Status = 'Done'; Detail = '' })
        } catch {
            Write-Host "   $($_.Exception.Message)" -ForegroundColor Red
            $results.Add([pscustomobject]@{ Service = $svc; Name = $plan.Name; Status = 'Failed'; Detail = $_.Exception.Message })
        }
    }

    # Résumé : un service en échec n'a pas arrêté les suivants (avec -WhatIf : les commandes, déjà affichées)
    if ($WhatIfPreference) { return }
    Write-Host ''
    foreach ($r in $results) {
        $mark, $color, $label = switch ($r.Status) {
            'Done' { '✔', 'Green', (Get-CloudboxText 'connecté' 'connected') }
            'Connected' { '✔', 'Green', (Get-CloudboxText "déjà connecté ($($r.Detail))" "already connected ($($r.Detail))") }
            'Failed' { '✖', 'Red', (Get-CloudboxText 'échec' 'failed') }
            'Skipped' { '–', 'Yellow', (Get-CloudboxText "ignoré : $($r.Detail)" "skipped: $($r.Detail)") }
        }
        Write-Host ("  {0} {1,-22} {2}" -f $mark, $r.Name, $label) -ForegroundColor $color
    }
}

Export-ModuleMember -Function Connect-Cloudbox
