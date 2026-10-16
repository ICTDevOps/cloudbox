# Configuration des scripts côté poste (scripts/*.ps1). Ne pas modifier ce fichier : mettre les valeurs
# propres au poste dans cloudbox.local.psd1 (même dossier, ignoré par git), qui le complète.
# Install-Cloudbox.ps1 y enregistre aussi les paramètres passés (-Port, -Image…), repris par Update.
@{
    # Container et volume (/home/dev : sign-ins, clés, workspaces, fichiers)
    ContainerName      = 'cloudbox'
    Volume             = 'cloudbox-home'
    Image              = 'ghcr.io/ictdevops/cloudbox:web'

    # Port local, toujours publié sur 127.0.0.1 (jamais 0.0.0.0)
    Port               = 8080

    # Variables du container
    TimeZone           = 'Europe/Paris'
    Shell              = 'pwsh'      # pwsh | bash : shell par défaut (docker exec, terminal de VS Code)
    Sudo               = $false
    Mode               = 'web'       # web | shell (aucun service web, usage docker exec)

    # auto (docker, sinon podman) | docker | podman
    Runtime            = 'auto'

    # Mise à jour quotidienne (tâche planifiée Windows), heure locale HH:mm
    UpdateTime         = '12:30'
    # Pas de recréation du container tant qu'un terminal est ouvert (navigateur ou docker exec)
    SkipUpdateWhenBusy = $true
}
