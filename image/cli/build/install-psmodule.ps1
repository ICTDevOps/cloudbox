# Installe un module PowerShell depuis PowerShell Gallery, à une version exacte,
# dans le scope AllUsers (/usr/local/share/powershell/Modules).
param(
    [Parameter(Mandatory)] [string] $Name,
    [Parameter(Mandatory)] [string] $Version
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Install-PSResource -Name $Name -Version "[$Version]" -Scope AllUsers -TrustRepository -AcceptLicense -Quiet

$installed = Get-InstalledPSResource -Name $Name -Scope AllUsers | Where-Object { $_.Version -eq [version]$Version }
if (-not $installed) {
    throw "Module $Name $Version introuvable après installation"
}
Write-Host "Module $Name $Version installé"

# Certains modules (ExchangeOnlineManagement) déclarent PowerShellGet et PackageManagement comme
# dépendances : PSResourceGet installe alors les versions 1.1.0.0, qui masquent celles fournies avec
# PowerShell 7 ($PSHOME/Modules, plus récentes) et échouent à l'import en non-root.
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue `
    /usr/local/share/powershell/Modules/PowerShellGet, /usr/local/share/powershell/Modules/PackageManagement

# Les caches de PSResourceGet ne servent qu'au build
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue /root/.cache, /tmp/*
