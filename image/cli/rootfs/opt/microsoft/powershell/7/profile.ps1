# Profil PowerShell commun à tous les utilisateurs (AllUsersAllHosts) — Cloudbox.
# Votre profil personnel reste ~/.config/powershell/Microsoft.PowerShell_profile.ps1 (volume persistant).

if ($Host.Name -eq 'ConsoleHost' -and (Get-Module -ListAvailable PSReadLine)) {
    Set-PSReadLineOption -EditMode Windows -PredictionSource History -HistoryNoDuplicates
    Set-PSReadLineKeyHandler -Key Tab -Function MenuComplete
    Set-PSReadLineKeyHandler -Key UpArrow -Function HistorySearchBackward
    Set-PSReadLineKeyHandler -Key DownArrow -Function HistorySearchForward
}

# Complétion de la commande az dans PowerShell
Register-ArgumentCompleter -Native -CommandName az -ScriptBlock {
    param($commandName, $wordToComplete, $cursorPosition)
    $completionFile = New-TemporaryFile
    $env:ARGCOMPLETE_USE_TEMPFILES = 1
    $env:_ARGCOMPLETE_STDOUT_FILENAME = $completionFile
    $env:COMP_LINE = $wordToComplete
    $env:COMP_POINT = $cursorPosition
    $env:_ARGCOMPLETE = 1
    $env:_ARGCOMPLETE_SUPPRESS_SPACE = 0
    $env:_ARGCOMPLETE_IFS = "`n"
    $env:_ARGCOMPLETE_SHELL = 'powershell'
    az 2>&1 | Out-Null
    Get-Content $completionFile | Sort-Object | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
    Remove-Item $completionFile, Env:\_ARGCOMPLETE_STDOUT_FILENAME, Env:\ARGCOMPLETE_USE_TEMPFILES, Env:\COMP_LINE, Env:\COMP_POINT, Env:\_ARGCOMPLETE, Env:\_ARGCOMPLETE_SUPPRESS_SPACE, Env:\_ARGCOMPLETE_IFS, Env:\_ARGCOMPLETE_SHELL
}

# Prompt : workspace, dossier, branche git, contexte réel (az CLI, Az PowerShell, Kubernetes)
function prompt {
    $ok = $?
    $e = [char]27
    $ws = ''
    if ($env:CLOUDBOX_WORKSPACE) {
        # Environnement relu dans le fichier du workspace à chaque prompt
        $envName = try { (Get-Content -Raw "$HOME/.cloudbox/workspaces/$($env:CLOUDBOX_WORKSPACE).json" | ConvertFrom-Json).env } catch { $null }
        $ws = switch ($envName) {
            'prd' { "$e[1;97;41m PRD $($env:CLOUDBOX_WORKSPACE) $e[0m " }
            'acc' { "$e[1;30;43m ACC $($env:CLOUDBOX_WORKSPACE) $e[0m " }
            'dev' { "$e[1;30;42m DEV $($env:CLOUDBOX_WORKSPACE) $e[0m " }
            default { "$e[7m $($env:CLOUDBOX_WORKSPACE) $e[0m " }
        }
    }
    $path = $ExecutionContext.SessionState.Path.CurrentLocation.Path -replace "^$([regex]::Escape($HOME))", '~'
    $git = ''
    $branch = git branch --show-current 2>$null
    if ($LASTEXITCODE -eq 0 -and $branch) { $git = " $e[33m($branch)$e[0m" }
    # az CLI : abonnement par défaut lu dans azureProfile.json (sans lancer az)
    $az = ''
    $azDir = if ($env:AZURE_CONFIG_DIR) { $env:AZURE_CONFIG_DIR } else { "$HOME/.azure" }
    $profileFile = Join-Path $azDir 'azureProfile.json'
    if ((Test-Path $profileFile) -and (Get-Item $profileFile).Length -gt 10) {
        $sub = try { ((Get-Content -Raw $profileFile).TrimStart([char]0xFEFF) | ConvertFrom-Json).subscriptions | Where-Object isDefault | Select-Object -First 1 } catch { $null }
        if ($sub) { $az = " $e[94maz:$($sub.name)$e[0m" }
    }
    # Az PowerShell : son propre contexte, distinct d'az CLI ; affiché seulement si Az.Accounts est
    # déjà chargé (le charger à chaque prompt coûterait plusieurs secondes)
    $azps = ''
    if (Get-Module Az.Accounts) {
        $ctx = Get-AzContext -ErrorAction SilentlyContinue
        if ($ctx -and $ctx.Subscription) { $azps = " $e[96mAzPS:$($ctx.Subscription.Name)$e[0m" }
    }
    $kube = ''
    $cfg = if ($env:KUBECONFIG) { ($env:KUBECONFIG -split ':')[0] } else { "$HOME/.kube/config" }
    if (Test-Path $cfg) {
        $kctx = (Select-String -Path $cfg -Pattern '^current-context:\s*(.+)$' | Select-Object -First 1).Matches.Groups[1].Value
        if ($kctx) { $kube = " $e[35m⎈ $($kctx.Trim('"'))$e[0m" }
    }
    $mark = if ($ok) { "$e[32mPS>$e[0m" } else { "$e[31mPS>$e[0m" }
    "$ws$e[36m$([Environment]::UserName)@$(hostname)$e[0m $e[34m$path$e[0m$git$az$azps$kube`n$mark "
}
