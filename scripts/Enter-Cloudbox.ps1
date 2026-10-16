<#
.SYNOPSIS
    Ouvre un shell dans le container Cloudbox (le démarre s'il est arrêté).
.EXAMPLE
    scripts/Enter-Cloudbox.ps1            # shell par défaut de la configuration (pwsh)
    scripts/Enter-Cloudbox.ps1 -Shell bash
#>
[CmdletBinding()]
param([ValidateSet('pwsh', 'bash')][string]$Shell)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Cloudbox.Host.psm1') -Force

$config = Get-CloudboxConfig
$runtime = Get-CloudboxRuntime $config
$name = $config.ContainerName
$container = Get-CloudboxContainer $runtime $name
if (-not $container) { throw "Container « $name » introuvable : lancer Install-Cloudbox.ps1." }
if (-not $container.State.Running) { Invoke-CloudboxRuntime $runtime @('start', $name) -Quiet | Out-Null }

if (-not $Shell) { $Shell = $config.Shell }
$command = if ($Shell -eq 'bash') { @('bash', '-l') } else { @('pwsh', '-NoLogo', '-Login') }
& $runtime exec -it $name @command
