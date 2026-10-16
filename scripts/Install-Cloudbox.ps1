<#
.SYNOPSIS
    Installe Cloudbox sur ce poste : volume, container, mise à jour quotidienne, profil Windows Terminal.
.DESCRIPTION
    Depuis un clone :      scripts/Install-Cloudbox.ps1 [-Port 8081] [-Token …]
    Sans clone (Windows) : & ([scriptblock]::Create((irm https://raw.githubusercontent.com/ICTDevOps/cloudbox/main/scripts/Install-Cloudbox.ps1)))

    Les scripts et la configuration sont copiés dans %LOCALAPPDATA%\Cloudbox (~/.local/share/cloudbox
    sous Linux et macOS) ; les paramètres passés sont enregistrés dans config/cloudbox.local.psd1 et
    repris par Update-Cloudbox.ps1. Relancer l'installation sur un poste déjà installé recrée le
    container (le volume, donc les sign-ins et les fichiers, est conservé).
#>
[CmdletBinding()]
param(
    [int]$Port,
    [string]$Image,
    [string]$ContainerName,
    [string]$Volume,
    [string]$TimeZone,
    [ValidateSet('pwsh', 'bash')][string]$Shell,
    [switch]$Sudo,
    # Jeton d'accès imposé (16 caractères minimum) ; sinon généré au premier démarrage et conservé
    [string]$Token,
    [switch]$NoScheduledTask,
    [switch]$NoTerminalProfile
)

$ErrorActionPreference = 'Stop'

# Lancé sans fichier (irm … | scriptblock) : téléchargement des scripts dans le dossier d'installation,
# puis exécution de la copie installée avec les mêmes paramètres
if (-not $PSScriptRoot) {
    $base = 'https://raw.githubusercontent.com/ICTDevOps/cloudbox/main'
    $dir = if ($env:OS -eq 'Windows_NT') { Join-Path $env:LOCALAPPDATA 'Cloudbox' } else { Join-Path $HOME '.local/share/cloudbox' }
    foreach ($f in 'scripts/Cloudbox.Host.psm1', 'scripts/Install-Cloudbox.ps1', 'scripts/Update-Cloudbox.ps1',
        'scripts/Enter-Cloudbox.ps1', 'scripts/Uninstall-Cloudbox.ps1', 'config/cloudbox.psd1') {
        $target = Join-Path $dir $f
        New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
        Invoke-WebRequest -UseBasicParsing "$base/$f" -OutFile $target
    }
    # Politique Restricted (défaut de Windows PowerShell) : scripts autorisés pour ce processus seulement
    if ($env:OS -eq 'Windows_NT') { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force }
    & (Join-Path $dir 'scripts/Install-Cloudbox.ps1') @PSBoundParameters
    return
}

Import-Module (Join-Path $PSScriptRoot 'Cloudbox.Host.psm1') -Force

if ($Token -and ($Token.Length -lt 16 -or $Token -match '\s')) { throw 'Jeton refusé : 16 caractères minimum, sans espace.' }

# Paramètres passés : enregistrés pour les mises à jour
$saved = @{}
foreach ($k in 'Port', 'Image', 'ContainerName', 'Volume', 'TimeZone', 'Shell') {
    if ($PSBoundParameters.ContainsKey($k)) { $saved[$k] = $PSBoundParameters[$k] }
}
if ($PSBoundParameters.ContainsKey('Sudo')) { $saved.Sudo = [bool]$Sudo }
if ($saved.Count) { Save-CloudboxLocalConfig $saved }
$config = Get-CloudboxConfig
$runtime = Get-CloudboxRuntime $config
$name = $config.ContainerName

Write-Host "Runtime : $runtime — image : $($config.Image)"
Update-CloudboxImage $runtime $config.Image
Invoke-CloudboxRuntime $runtime @('volume', 'create', $config.Volume) -Quiet | Out-Null

$existing = Get-CloudboxContainer $runtime $name
if ($existing) {
    Write-Host "Container « $name » existant : recréé (volume $($config.Volume) conservé)."
    Invoke-CloudboxRuntime $runtime @('rm', '-f', $name) -Quiet | Out-Null
}
Invoke-CloudboxRuntime $runtime (Get-CloudboxRunArguments $config $Token) -Quiet | Out-Null

$installDir = Get-CloudboxInstallDir
Copy-CloudboxFiles $installDir

if (Test-CloudboxWindows) {
    if (-not $NoScheduledTask) {
        Install-CloudboxScheduledTask $config $installDir
        Write-Host "Mise à jour quotidienne à $($config.UpdateTime) et à l'ouverture de session (tâche « Cloudbox-Update »)."
    }
    if (-not $NoTerminalProfile) {
        Install-CloudboxTerminalProfile $config $runtime
        Write-Host 'Profils Windows Terminal « Cloudbox (PowerShell) » et « Cloudbox (Bash) » ajoutés.'
    }
} elseif (-not $NoScheduledTask) {
    Write-Host "Mise à jour automatique : ajouter par exemple à crontab -e :"
    Write-Host "  30 12 * * * pwsh -NoProfile -File '$(Join-Path $installDir 'scripts/Update-Cloudbox.ps1')' -Quiet"
}

if ($config.Mode -eq 'shell') {
    Write-Host "`nCloudbox est démarré en mode shell (aucun service web) : scripts/Enter-Cloudbox.ps1 ou « $runtime exec -it $name pwsh »."
    return
}
Write-Host 'Démarrage du portail…'
$readToken = Wait-CloudboxReady $runtime $name
$line = '─' * 66
Write-Host "`n$line"
Write-Host " Cloudbox est prêt : http://localhost:$($config.Port)"
Write-Host " Jeton d'accès : $readToken"
Write-Host " (relisible avec : $runtime exec $name cat /home/dev/.cloudbox/token)"
Write-Host $line
