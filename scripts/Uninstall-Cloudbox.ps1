<#
.SYNOPSIS
    Désinstalle Cloudbox : container, tâche planifiée, profils Windows Terminal.
.DESCRIPTION
    Le volume (sign-ins, clés, workspaces, fichiers) et le dossier d'installation sont conservés : une
    nouvelle installation retrouve tout. -RemoveData les supprime aussi, après confirmation.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    # Supprime aussi le volume /home/dev et le dossier d'installation (irréversible)
    [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Cloudbox.Host.psm1') -Force

$config = Get-CloudboxConfig
$runtime = Get-CloudboxRuntime $config
$name = $config.ContainerName

if (Get-CloudboxContainer $runtime $name) {
    Invoke-CloudboxRuntime $runtime @('rm', '-f', $name) -Quiet | Out-Null
    Write-Host "Container « $name » supprimé."
}
if (Test-CloudboxWindows) {
    Uninstall-CloudboxScheduledTask
    $fragments = Get-CloudboxFragmentDir
    if (Test-Path $fragments) { Remove-Item -Recurse -Force $fragments }
    Write-Host 'Tâche planifiée et profils Windows Terminal supprimés.'
}

if (-not $RemoveData) {
    Write-Host "Volume « $($config.Volume) » conservé (sign-ins, workspaces, fichiers) : -RemoveData pour le supprimer."
    return
}
if ($PSCmdlet.ShouldProcess("volume $($config.Volume) (sign-ins, clés, workspaces, fichiers de /home/dev)", 'Supprimer définitivement')) {
    Invoke-CloudboxRuntime $runtime @('volume', 'rm', $config.Volume) -Quiet | Out-Null
    Write-Host "Volume « $($config.Volume) » supprimé."
    $installDir = Get-CloudboxInstallDir
    if (Test-Path $installDir) {
        Remove-Item -Recurse -Force $installDir
        Write-Host "Dossier $installDir supprimé."
    }
}
