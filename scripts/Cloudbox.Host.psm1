# Fonctions communes aux scripts côté poste (Install, Update, Enter, Uninstall-Cloudbox.ps1).
# Compatible Windows PowerShell 5.1 (présent sur tout Windows) et PowerShell 7 (Windows, Linux, macOS).

$script:Root = Split-Path -Parent $PSScriptRoot   # dossier qui contient scripts/ et config/
$script:OnWindows = $env:OS -eq 'Windows_NT'
$script:TaskName = 'Cloudbox-Update'

function Test-CloudboxWindows { $script:OnWindows }

# Dossier d'installation des scripts (cible de la tâche planifiée)
function Get-CloudboxInstallDir {
    if ($script:OnWindows) { Join-Path $env:LOCALAPPDATA 'Cloudbox' }
    else { Join-Path $HOME '.local/share/cloudbox' }
}

function Get-CloudboxLocalConfigPath { Join-Path $script:Root 'config/cloudbox.local.psd1' }

# Configuration : config/cloudbox.psd1, complété par config/cloudbox.local.psd1
function Get-CloudboxConfig {
    $config = Import-PowerShellDataFile (Join-Path $script:Root 'config/cloudbox.psd1')
    $local = Get-CloudboxLocalConfigPath
    if (Test-Path $local) {
        $over = Import-PowerShellDataFile $local
        foreach ($k in $over.Keys) { $config[$k] = $over[$k] }
    }
    Assert-CloudboxConfig $config
    $config
}

# Valeurs reprises dans des arguments de commande : jeux de caractères stricts
function Assert-CloudboxConfig([hashtable]$Config) {
    $rules = @{
        ContainerName = '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$'
        Volume        = '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$'
        Image         = '^[a-z0-9][a-z0-9._/:@-]{0,254}$'
        TimeZone      = '^[A-Za-z0-9_+/-]{1,64}$'
        Shell         = '^(pwsh|bash)$'
        Mode          = '^(web|shell)$'
        Runtime       = '^(auto|docker|podman)$'
        UpdateTime    = '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    }
    foreach ($k in $rules.Keys) {
        if ("$($Config[$k])" -cnotmatch $rules[$k]) { throw "Configuration : valeur invalide pour $k ($($Config[$k]))" }
    }
    $port = 0
    if (-not [int]::TryParse("$($Config.Port)", [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
        throw "Configuration : port invalide ($($Config.Port))"
    }
}

# Enregistre des valeurs dans config/cloudbox.local.psd1 (en gardant celles déjà présentes)
function Save-CloudboxLocalConfig([hashtable]$Values) {
    $path = Get-CloudboxLocalConfigPath
    $current = if (Test-Path $path) { Import-PowerShellDataFile $path } else { @{} }
    foreach ($k in $Values.Keys) { $current[$k] = $Values[$k] }
    $lines = @('# Configuration propre à ce poste (complète cloudbox.psd1). Écrit par Install-Cloudbox.ps1, modifiable.', '@{')
    foreach ($k in ($current.Keys | Sort-Object)) {
        $v = $current[$k]
        $text = if ($v -is [bool]) { if ($v) { '$true' } else { '$false' } }
                elseif ($v -is [int]) { "$v" }
                else { "'" + ("$v" -replace "'", "''") + "'" }
        $lines += "    $k = $text"
    }
    $lines += '}'
    New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
    Set-Content -Path $path -Value $lines -Encoding UTF8
}

# docker ou podman (même syntaxe)
function Get-CloudboxRuntime([hashtable]$Config) {
    $candidates = if ($Config.Runtime -eq 'auto') { @('docker', 'podman') } else { @($Config.Runtime) }
    foreach ($c in $candidates) {
        if (Get-Command $c -CommandType Application -ErrorAction SilentlyContinue) { return $c }
    }
    throw "Aucun runtime de containers trouvé ($($candidates -join ', ')). Installez Docker Desktop (Windows, macOS) ou Docker Engine / Podman (Linux)."
}

# Lance le runtime ; -Quiet : sortie renvoyée au lieu d'être affichée ; erreur si le code de retour n'est pas 0
function Invoke-CloudboxRuntime {
    param([string]$Runtime, [string[]]$Arguments, [switch]$Quiet, [switch]$AllowFailure)
    if ($Quiet) {
        $out = & $Runtime @Arguments 2>&1
        $code = $LASTEXITCODE
        if ($code -ne 0 -and -not $AllowFailure) { throw "$Runtime $($Arguments[0]) : échec ($code) $($out | Out-String)" }
        return ($out | ForEach-Object { "$_" })
    }
    & $Runtime @Arguments
    if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) { throw "$Runtime $($Arguments[0]) : échec ($LASTEXITCODE)" }
}

# Télécharge l'image ; une image seulement locale (construite sur le poste, tests) est gardée telle quelle
function Update-CloudboxImage([string]$Runtime, [string]$Image, [switch]$Quiet) {
    $out = Invoke-CloudboxRuntime $Runtime @('pull', $Image) -Quiet -AllowFailure
    if ($LASTEXITCODE -eq 0) { if (-not $Quiet) { $out | Select-Object -Last 2 | ForEach-Object { Write-Host $_ } }; return }
    Invoke-CloudboxRuntime $Runtime @('image', 'inspect', $Image) -Quiet -AllowFailure | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Image $Image introuvable : $($out | Out-String)" }
    Write-Warning "Image $Image non téléchargée (locale uniquement ?) : version présente sur le poste utilisée."
}

# État du container : $null s'il n'existe pas
function Get-CloudboxContainer([string]$Runtime, [string]$Name) {
    $json = Invoke-CloudboxRuntime $Runtime @('container', 'inspect', $Name) -Quiet -AllowFailure
    if ($LASTEXITCODE -ne 0) { return $null }
    $info = ($json -join "`n") | ConvertFrom-Json
    if ($info -is [array]) { $info = $info[0] }
    $info
}

# Arguments de « run » : mêmes réglages que compose.yaml (port sur 127.0.0.1 seulement, pas de socket
# Docker, pas de mode privilégié)
function Get-CloudboxRunArguments([hashtable]$Config, [string]$Token) {
    $a = @('run', '-d', '--name', $Config.ContainerName, '--hostname', 'cloudbox', '--restart', 'unless-stopped',
        '-p', "127.0.0.1:$($Config.Port):8080",
        '-v', "$($Config.Volume):/home/dev",
        '-e', "TZ=$($Config.TimeZone)",
        '-e', "CLOUDBOX_SHELL=$($Config.Shell)",
        '-e', "CLOUDBOX_SUDO=$(if ($Config.Sudo) { 'true' } else { 'false' })",
        '-e', "CLOUDBOX_MODE=$($Config.Mode)",
        '--label', 'io.cloudbox.managed=scripts')
    # Jeton imposé : écrit dans le volume au démarrage, conservé ensuite sans la variable
    if ($Token) { $a += '-e', "CLOUDBOX_TOKEN=$Token" }
    $a + $Config.Image
}

# Attend que le portail réponde (401 sans jeton) puis renvoie le jeton lu dans le volume
function Wait-CloudboxReady([string]$Runtime, [string]$Name, [int]$TimeoutSeconds = 180) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $code = Invoke-CloudboxRuntime $Runtime @('exec', $Name, 'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
            'http://127.0.0.1:8080/') -Quiet -AllowFailure
        if ("$code" -match '^(401|200)$') {
            return ((Invoke-CloudboxRuntime $Runtime @('exec', $Name, 'cat', '/home/dev/.cloudbox/token') -Quiet) -join '').Trim()
        }
        Start-Sleep -Seconds 2
    }
    throw "Le portail ne répond pas après $TimeoutSeconds s : voir « $Runtime logs $Name »."
}

# Terminal ouvert dans le container : client tmux attaché (terminal du navigateur) ou processus lancé par
# « docker exec » (parent 0 dans le container, hors PID 1 et la commande ps de ce test)
function Test-CloudboxBusy([string]$Runtime, [string]$Name) {
    $clients = Invoke-CloudboxRuntime $Runtime @('exec', $Name, 'tmux', 'list-clients') -Quiet -AllowFailure
    if ($LASTEXITCODE -eq 0 -and ($clients | Where-Object { "$_".Trim() })) { return $true }
    $procs = Invoke-CloudboxRuntime $Runtime @('exec', $Name, 'ps', '-eo', 'pid=,ppid=,comm=') -Quiet -AllowFailure
    foreach ($line in $procs) {
        $f = "$line".Trim() -split '\s+'
        if ($f.Count -ge 3 -and $f[1] -eq '0' -and $f[0] -ne '1' -and $f[2] -ne 'ps') { return $true }
    }
    $false
}

# Profil Windows Terminal : fragment JSON, sans toucher au settings.json de l'utilisateur
function Get-CloudboxFragmentDir { Join-Path $env:LOCALAPPDATA 'Microsoft\Windows Terminal\Fragments\Cloudbox' }

function Install-CloudboxTerminalProfile([hashtable]$Config, [string]$Runtime) {
    $dir = Get-CloudboxFragmentDir
    New-Item -ItemType Directory -Force $dir | Out-Null
    $profiles = @(
        @{ name = 'Cloudbox (PowerShell)'; guid = '{7c3b1f5e-2a4d-4e8b-9c61-0d5a3e7f2b11}'
           commandline = "$Runtime exec -it $($Config.ContainerName) pwsh -NoLogo -Login" },
        @{ name = 'Cloudbox (Bash)'; guid = '{7c3b1f5e-2a4d-4e8b-9c61-0d5a3e7f2b12}'
           commandline = "$Runtime exec -it $($Config.ContainerName) bash -l" }
    )
    $json = @{ profiles = $profiles } | ConvertTo-Json -Depth 4
    # UTF-8 sans BOM (Set-Content -Encoding UTF8 en ajoute un sous Windows PowerShell 5.1)
    [IO.File]::WriteAllText((Join-Path $dir 'cloudbox.json'), $json, [Text.UTF8Encoding]::new($false))
}

function Install-CloudboxScheduledTask([hashtable]$Config, [string]$InstallDir) {
    $script = Join-Path $InstallDir 'scripts\Update-Cloudbox.ps1'
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Quiet"
    $at = [datetime]::ParseExact($Config.UpdateTime, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
    $triggers = @((New-ScheduledTaskTrigger -Daily -At $at), (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME))
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Hours 1)
    Register-ScheduledTask -TaskName $script:TaskName -Action $action -Trigger $triggers -Settings $settings `
        -Description 'Met à jour Cloudbox (docker pull, recréation du container si aucun terminal n''est ouvert).' -Force | Out-Null
}

function Uninstall-CloudboxScheduledTask {
    if (Get-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false
    }
}

# Copie des scripts et de la configuration dans le dossier d'installation (cible de la tâche planifiée),
# sauf s'ils y sont déjà (installation lancée par téléchargement, voir Install-Cloudbox.ps1)
function Copy-CloudboxFiles([string]$InstallDir) {
    $files = @('scripts/Cloudbox.Host.psm1', 'scripts/Install-Cloudbox.ps1', 'scripts/Update-Cloudbox.ps1',
        'scripts/Enter-Cloudbox.ps1', 'scripts/Uninstall-Cloudbox.ps1', 'config/cloudbox.psd1')
    if ((Resolve-Path $script:Root).Path -eq (Resolve-Path -LiteralPath $InstallDir -ErrorAction SilentlyContinue).Path) { return }
    foreach ($f in $files) {
        $target = Join-Path $InstallDir $f
        New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
        Copy-Item -Force (Join-Path $script:Root $f) $target
    }
    $local = Get-CloudboxLocalConfigPath
    if (Test-Path $local) { Copy-Item -Force $local (Join-Path $InstallDir 'config/cloudbox.local.psd1') }
}

Export-ModuleMember -Function *-Cloudbox*
