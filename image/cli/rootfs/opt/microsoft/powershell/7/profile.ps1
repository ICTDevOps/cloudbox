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

# Az PowerShell isolé par workspace (CLOUDBOX_AZPS_HOME, posé par cloudbox-term) : Az.Accounts n'a pas
# de réglage de dossier, il calcule ses chemins (contexte AzureRmContext.json, PSConfig.json, cache MSAL
# sous .local/share) depuis HOME une seule fois, à son import. On l'importe donc ici, avant toute commande,
# avec HOME pointé sur le dossier du workspace, puis on rétablit HOME (~ reste /home/dev). Ne pas
# « isoler » avec Clear-AzContext : il viderait le contexte commun.
if ($env:CLOUDBOX_AZPS_HOME -and -not (Get-Module Az.Accounts)) {
    $cloudboxHome = $env:HOME
    $env:HOME = $env:CLOUDBOX_AZPS_HOME
    try { Import-Module Az.Accounts -ErrorAction SilentlyContinue } finally { $env:HOME = $cloudboxHome }
    Remove-Variable cloudboxHome
}

# Prompt : workspace, dossier, branche git, contexte réel (az CLI, Az PowerShell, Kubernetes)
function prompt {
    $ok = $?
    $lastExit = $global:LASTEXITCODE
    # Fin de commande signalée à tmux (option du panneau @cloudbox_prompt = <n>:<0|1>) : l'assistant
    # du portail sait ainsi quand une commande validée est terminée, et si elle a réussi
    if ($env:TMUX_PANE) {
        $global:CloudboxPromptSeq = 1 + [int]$global:CloudboxPromptSeq
        tmux set-option -p -t $env:TMUX_PANE '@cloudbox_prompt' "$($global:CloudboxPromptSeq):$(if ($ok) { 0 } else { 1 })" 2>$null
    }
    # Set-Location ne change pas le dossier du processus : on l'aligne, pour que tmux le voie
    # (barre de chemin du portail, découpage d'un panneau tmux dans le même dossier)
    if ($PWD.Provider.Name -eq 'FileSystem') {
        try { [Environment]::CurrentDirectory = $PWD.ProviderPath } catch { }
    }
    $e = [char]27
    $ws = ''
    if ($env:CLOUDBOX_WORKSPACE) {
        # Environnement relu dans le fichier du workspace à chaque prompt ; les connexions (isolées ou
        # partagées) sont fixées à l'ouverture du terminal : un changement de mode demande de le rouvrir
        $wsData = try { Get-Content -Raw "$HOME/.cloudbox/workspaces/$($env:CLOUDBOX_WORKSPACE).json" | ConvertFrom-Json } catch { $null }
        $ws = switch ($wsData.env) {
            'prd' { "$e[1;97;41m PRD $($env:CLOUDBOX_WORKSPACE) $e[0m " }
            'acc' { "$e[1;30;43m ACC $($env:CLOUDBOX_WORKSPACE) $e[0m " }
            'dev' { "$e[1;30;42m DEV $($env:CLOUDBOX_WORKSPACE) $e[0m " }
            default { "$e[7m $($env:CLOUDBOX_WORKSPACE) $e[0m " }
        }
        if ($wsData) {
            $mode = if ($wsData.identities) { $wsData.identities } else { 'isolated' }
            $own = if ($env:CLOUDBOX_IDENTITIES) { $env:CLOUDBOX_IDENTITIES } else { 'shared' }
            if ($mode -ne $own) { $ws += "$e[1;31m⚠ rouvrir ce terminal / reopen this terminal (connexions / sign-ins)$e[0m " }
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
    # déjà chargé (toujours le cas dans un workspace isolé ; sinon, le charger coûterait à chaque prompt)
    $azps = ''
    if (Get-Module Az.Accounts) {
        $ctx = Get-AzContext -ErrorAction SilentlyContinue
        if ($ctx -and $ctx.Subscription) { $azps = " $e[96mAzPS:$($ctx.Subscription.Name)$e[0m" }
    }
    # Contexte Kubernetes : premier fichier de KUBECONFIG qui en définit un (règle de kubectl ; un
    # workspace isolé a son fichier devant ~/.kube/config)
    $kube = ''
    $kubeFiles = if ($env:KUBECONFIG) { $env:KUBECONFIG -split ':' } else { @("$HOME/.kube/config") }
    foreach ($cfg in $kubeFiles) {
        if (-not $cfg -or -not (Test-Path $cfg)) { continue }
        # Fichier sans contexte courant (kubeconfig neuf d'un workspace) : fichier suivant
        $found = Select-String -Path $cfg -Pattern '^current-context:\s*(.+)$' | Select-Object -First 1
        $kctx = if ($found) { $found.Matches[0].Groups[1].Value.Trim('"') } else { '' }
        if ($kctx) { $kube = " $e[35m⎈ $kctx$e[0m"; break }
    }
    $mark = if ($ok) { "$e[32mPS>$e[0m" } else { "$e[31mPS>$e[0m" }
    # Les commandes externes du prompt (tmux, git) ne doivent pas masquer le code de sortie de l'utilisateur
    $global:LASTEXITCODE = $lastExit
    "$ws$e[36m$([Environment]::UserName)@$(hostname)$e[0m $e[34m$path$e[0m$git$az$azps$kube`n$mark "
}
