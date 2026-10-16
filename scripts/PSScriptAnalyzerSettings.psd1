# Règles de PSScriptAnalyzer pour les scripts côté poste (CI : tests/smoke-scripts.sh)
@{
    Severity     = @('Error', 'Warning')
    ExcludeRules = @(
        'PSAvoidUsingWriteHost'                        # scripts interactifs : messages pour l'utilisateur
        'PSUseShouldProcessForStateChangingFunctions'  # fonctions internes du module, confirmées par les scripts
        'PSUseSingularNouns'
        'PSReviewUnusedParameter'                      # faux positifs : paramètres lus par une fonction imbriquée
    )
    # Windows PowerShell 5.1 (présent sur tout Windows, lance la tâche planifiée) et PowerShell 7
    Rules        = @{
        PSUseCompatibleSyntax = @{ Enable = $true; TargetVersions = @('5.1', '7.4') }
    }
}
