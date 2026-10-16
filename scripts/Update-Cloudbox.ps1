<#
.SYNOPSIS
    Met à jour Cloudbox : télécharge l'image et recrée le container si elle a changé.
.DESCRIPTION
    Le volume (/home/dev : sign-ins, clés, workspaces, fichiers) est conservé. Tant qu'un terminal est
    ouvert (terminal du navigateur ou docker exec), le container n'est pas recréé (SkipUpdateWhenBusy) :
    la mise à jour attend le prochain passage, sauf avec -Force.
    Un container créé par Docker Compose est mis à jour par « compose pull » puis « compose up -d ».
    Lancé chaque jour par la tâche planifiée « Cloudbox-Update » (Windows) avec -Quiet.
#>
[CmdletBinding()]
param(
    # Recrée le container même si un terminal est ouvert
    [switch]$Force,
    # Journal dans le dossier d'installation (update.log) plutôt qu'à l'écran
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Cloudbox.Host.psm1') -Force

$log = Join-Path (Split-Path -Parent $PSScriptRoot) 'update.log'
function Write-UpdateLog([string]$Message) {
    $text = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
    if ($Quiet) { Add-Content -Path $log -Value $text -Encoding UTF8 } else { Write-Host $Message }
}

try {
    $config = Get-CloudboxConfig
    $runtime = Get-CloudboxRuntime $config
    $name = $config.ContainerName
    $container = Get-CloudboxContainer $runtime $name
    if (-not $container) { throw "Container « $name » introuvable : lancer Install-Cloudbox.ps1." }

    $labels = $container.Config.Labels
    $project = if ($labels) { $labels.PSObject.Properties['com.docker.compose.project'] } else { $null }
    $image = $container.Config.Image

    $busy = $container.State.Running -and $config.SkipUpdateWhenBusy -and -not $Force -and (Test-CloudboxBusy $runtime $name)

    # Container de Docker Compose : son projet et ses fichiers, pas la configuration des scripts
    if ($project) {
        $files = "$($labels.PSObject.Properties['com.docker.compose.project.config_files'].Value)" -split ','
        $composeArgs = @('compose', '-p', $project.Value)
        foreach ($f in $files) { if ($f) { $composeArgs += '-f', $f } }
        Invoke-CloudboxRuntime $runtime ($composeArgs + 'pull') -Quiet | Out-Null
        $newId = (Invoke-CloudboxRuntime $runtime @('image', 'inspect', '-f', '{{.Id}}', $image) -Quiet) -join ''
        if ($newId -eq $container.Image) { Write-UpdateLog "Cloudbox est à jour ($image)."; return }
        if ($busy) { Write-UpdateLog 'Nouvelle image téléchargée ; terminal ouvert : recréation reportée (-Force pour passer outre).'; return }
        Invoke-CloudboxRuntime $runtime ($composeArgs + @('up', '-d')) -Quiet | Out-Null
        Write-UpdateLog "Cloudbox mis à jour (Docker Compose, projet $($project.Value))."
        return
    }

    Update-CloudboxImage $runtime $config.Image -Quiet
    $newId = (Invoke-CloudboxRuntime $runtime @('image', 'inspect', '-f', '{{.Id}}', $config.Image) -Quiet) -join ''
    if ($newId -eq $container.Image -and $image -eq $config.Image) { Write-UpdateLog "Cloudbox est à jour ($($config.Image))."; return }
    if ($busy) { Write-UpdateLog 'Nouvelle image téléchargée ; terminal ouvert : recréation reportée (-Force pour passer outre).'; return }

    Invoke-CloudboxRuntime $runtime @('rm', '-f', $name) -Quiet | Out-Null
    Invoke-CloudboxRuntime $runtime (Get-CloudboxRunArguments $config '') -Quiet | Out-Null
    Write-UpdateLog "Cloudbox mis à jour : $($config.Image) ($($newId.Substring(0, [Math]::Min(19, $newId.Length))))."
} catch {
    Write-UpdateLog "Échec de la mise à jour : $($_.Exception.Message)"
    exit 1
}
