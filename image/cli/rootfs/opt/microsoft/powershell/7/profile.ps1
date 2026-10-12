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

# Prompt : dossier, branche git, contexte Kubernetes
function prompt {
    $ok = $?
    $path = $ExecutionContext.SessionState.Path.CurrentLocation.Path -replace "^$([regex]::Escape($HOME))", '~'
    $git = ''
    $branch = git branch --show-current 2>$null
    if ($LASTEXITCODE -eq 0 -and $branch) { $git = " `e[33m($branch)`e[0m" }
    $kube = ''
    $cfg = if ($env:KUBECONFIG) { ($env:KUBECONFIG -split ':')[0] } else { "$HOME/.kube/config" }
    if (Test-Path $cfg) {
        $ctx = (Select-String -Path $cfg -Pattern '^current-context:\s*(.+)$' | Select-Object -First 1).Matches.Groups[1].Value
        if ($ctx) { $kube = " `e[35m⎈ $($ctx.Trim('"'))`e[0m" }
    }
    $mark = if ($ok) { "`e[32mPS>`e[0m" } else { "`e[31mPS>`e[0m" }
    "`e[36m$([Environment]::UserName)@$(hostname)`e[0m `e[34m$path`e[0m$git$kube`n$mark "
}
