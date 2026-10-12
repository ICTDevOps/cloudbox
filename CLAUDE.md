# Cloudbox — poste d'administration Azure / Microsoft 365 dans un navigateur

Ce fichier cadre le projet pour Claude Code. Le lire en entier avant toute modification.

## Contexte

Cloudbox reprend l'idée du dépôt **WSLC** (https://github.com/CTroessaert/WSLC) : une image
Ubuntu 24.04 contenant tous les outils d'administration Azure et M365, versions épinglées et
mises à jour par Renovate. WSLC s'utilise uniquement comme container `wslc` depuis Windows
Terminal.

Cloudbox ajoute une **interface web locale**, dans l'esprit d'Azure Cloud Shell :
- un **terminal web** (PowerShell et Bash) ;
- une instance **VS Code web** ;
- un **portail** d'accueil qui relie les deux.

L'accès terminal classique (`docker exec`, profil Windows Terminal) reste possible.

## Cible (phase actuelle)

- **Un container par utilisateur, sur son propre PC** (Docker Desktop, Podman, ou wslc).
- Accès depuis le navigateur du même PC uniquement : **http://localhost:8080**.
- **Pas de serveur central, pas de multi-utilisateur, pas d'exposition réseau** dans cette phase.
  Ne pas introduire de dépendance à Azure (ACA, Easy Auth, Azure Files) ni d'oauth2-proxy.
- Postes cibles principaux : Windows 11 + Docker Desktop (WSL2). Linux et macOS doivent
  fonctionner aussi (image multi-arch amd64 + arm64).

## Ce qu'on reprend de WSLC tel quel

- Le Dockerfile des outils CLI : az, azd, Bicep, PowerShell 7 + modules Az, Microsoft.Graph,
  ExchangeOnlineManagement, MicrosoftTeams, PnP.PowerShell, CLI for Microsoft 365, Node.js LTS,
  kubectl, helm, gh, et les outils de base.
- **Versions épinglées** : une ligne `ARG <OUTIL>_VERSION` par outil, précédée d'un commentaire
  `# renovate: datasource=… depName=…`. Ne jamais installer un outil en « latest ».
- **Renovate** : une PR par outil, `minimumReleaseAge` de 3 jours, fusion automatique des
  patch/minor si le build est vert, revue manuelle des majeures.
- **CI GitHub Actions** : build amd64 + arm64 sur runners natifs, test de fumée qui bloque la PR,
  publication sur GHCR, release GitHub avec `versions.json`.
- **`/home/dev` en volume persistant** : jetons, `~/.azure`, clés SSH, modules `CurrentUser`
  survivent à la recréation du container.
- Utilisateur non-root `dev` (uid 1000), télémétrie des CLI désactivée.

## Architecture

### Deux images, une seule chaîne de build

```
image/cli/Dockerfile   → ghcr.io/<owner>/cloudbox:cli   (équivalent WSLC, sans web)
image/web/Dockerfile   → ghcr.io/<owner>/cloudbox:web   (FROM :cli + stack web)
```

- `:cli` reste utilisable seul, y compris avec wslc (mode `sleep infinity`).
- `:web` est reconstruite à chaque changement de `:cli`.
- Tags : `:cli`, `:web`, `:latest` (= `:web`), `:vAAAA.MM.JJ-cli`, `:vAAAA.MM.JJ-web`, `:edge`, `:sha-…`.

### Contenu de l'image `:web`

```
navigateur ──http://localhost:8080──▶ Caddy (reverse proxy + auth)
                                        ├── /        → portail statique
                                        ├── /term/   → ttyd → tmux → pwsh | bash
                                        └── /code/   → code-server
                       s6-overlay supervise Caddy, ttyd (x2) et code-server
                       /home/dev = volume persistant
```

| Composant | Choix | Raison |
|---|---|---|
| Supervision | **s6-overlay** | PID 1 propre, gestion des signaux, dépendances entre services, scripts d'init. Remplace `tini`. |
| Terminal web | **ttyd** | Binaire unique, xterm.js, WebSocket, multi-arch, maintenu. |
| Persistance des sessions | **tmux** | Fermer l'onglet ne tue pas la session (comportement Cloud Shell). |
| VS Code web | **code-server** | Le plus mature en container, gère le sous-chemin, licence MIT. Extensions via Open VSX. |
| Reverse proxy | **Caddy** | Config courte, auth intégrée, sert aussi le portail statique. |

Deux entrées terminal : `/term/pwsh/` (session tmux `pwsh`) et `/term/bash/` (session tmux `bash`),
chacune lancée par `tmux new -A -s <nom> <shell>` pour se rattacher à la session existante.

Seul Caddy écoute sur le réseau du container (port 8080). ttyd et code-server écoutent sur
`127.0.0.1` à l'intérieur du container, sans authentification propre : Caddy est la seule porte.

### Init

Le `devbox-init` de WSLC devient un script `cont-init.d` de s6 (`cloudbox-init`) :
initialisation du volume `/home/dev` depuis `/etc/skel` au premier démarrage, fuseau horaire,
génération du jeton d'accès (voir Sécurité).

Variable `CLOUDBOX_MODE` :
- `web` (défaut de l'image `:web`) : démarre les services ;
- `shell` : ne démarre aucun service web, attend (`sleep infinity`), pour un usage wslc ou `docker exec`.

## Sécurité (même en local)

Un terminal web sur `localhost` reste attaquable : n'importe quelle page ouverte dans le
navigateur peut tenter de joindre `localhost:8080` (CSRF, DNS rebinding sur le WebSocket).
Les caches de jetons MSAL sont en clair dans `/home/dev`. Règles :

1. **Publier le port sur `127.0.0.1` uniquement** dans le compose et les scripts
   (`127.0.0.1:8080:8080`), jamais sur `0.0.0.0`.
2. **Authentification obligatoire dans Caddy** : un jeton (ou mot de passe) généré au premier
   démarrage s'il n'est pas fourni par `CLOUDBOX_TOKEN`, stocké dans `/home/dev/.cloudbox/token`,
   affiché dans les logs du container et par le script d'installation. Session par cookie
   `HttpOnly`, `SameSite=Strict`.
3. **Vérification de l'en-tête `Host`** (`localhost` / `127.0.0.1` uniquement) et de l'`Origin`
   sur les WebSocket.
4. **sudo désactivé par défaut**, activable avec `CLOUDBOX_SUDO=true`.
5. Pas de socket Docker monté, pas de `--privileged`.
6. En-têtes de sécurité dans Caddy (`X-Frame-Options: DENY`, `Content-Security-Policy` adaptée,
   `Referrer-Policy: no-referrer`).

## Authentification vers Azure / M365

Inchangée par rapport à WSLC : **device code flow** (`az login --use-device-code`,
`Connect-MgGraph -UseDeviceCode`, `Connect-ExchangeOnline -Device`, etc.). Le portail affiche un
aide-mémoire de ces commandes.

Étape ultérieure : un module PowerShell `Cloudbox.Connect` avec
`Connect-Cloudbox -Tenant <tenant> -Services Az,Graph,EXO,Teams,PnP` et un fichier de config
par tenant dans `/home/dev/.cloudbox/tenants/` (notamment le `ClientId` PnP).

## Côté poste (scripts)

- `compose.yaml` à la racine : image `:web`, volume `cloudbox-home:/home/dev`,
  port `127.0.0.1:8080:8080`, `restart: unless-stopped`, variables `TZ`, `CLOUDBOX_TOKEN`,
  `CLOUDBOX_SUDO`.
- Scripts PowerShell repris de WSLC et adaptés à `docker` (avec détection de `wslc` en option) :
  `Install-Cloudbox.ps1`, `Update-Cloudbox.ps1`, `Enter-Cloudbox.ps1`, `Uninstall-Cloudbox.ps1`.
  - Install : crée le volume et le container, la tâche planifiée de mise à jour, le profil
    Windows Terminal (`docker exec -it cloudbox pwsh`), affiche l'URL et le jeton.
  - Update : `docker pull`, recrée le container si l'image a changé, ne le fait pas si une session
    est active (tmux attaché ou terminal ouvert) — reprendre la logique `SkipUpdateWhenBusy`.
- `config/cloudbox.psd1` + `config/cloudbox.local.psd1` (ignoré par git), comme dans WSLC.

## Structure cible du dépôt

```
image/cli/Dockerfile
image/cli/build/                       # lib.sh, install-psmodule.sh (repris de WSLC)
image/cli/rootfs/usr/local/bin/        # cloudbox-versions
image/web/Dockerfile
image/web/rootfs/etc/s6-overlay/s6-rc.d/   # caddy, ttyd-pwsh, ttyd-bash, code-server, cloudbox-init
image/web/rootfs/etc/caddy/Caddyfile
image/web/rootfs/srv/portal/           # portail statique (HTML/CSS, sans framework)
compose.yaml
config/cloudbox.psd1
scripts/*.ps1
.github/workflows/build.yml
renovate.json
README.md
```

## Feuille de route

### Étape 1 — PoC local (à faire en premier)

1. Reprendre l'image WSLC dans `image/cli/` (renommer devbox → cloudbox).
2. Créer `image/web/Dockerfile` : s6-overlay, ttyd, tmux, code-server, Caddy, tous épinglés
   avec commentaires Renovate.
3. Services s6 + `cloudbox-init` + Caddyfile avec auth par jeton et vérification `Host`/`Origin`.
4. Portail minimal : trois tuiles (PowerShell, Bash, VS Code), versions des outils (JSON produit
   au build par `cloudbox-versions`), aide-mémoire des connexions.
5. Extensions code-server préinstallées : PowerShell, Bicep, Terraform/OpenTofu, YAML,
   Kubernetes. **Vérifier leur disponibilité sur Open VSX** et signaler celles qui manquent
   au lieu de les contourner.
6. `compose.yaml`.
7. CI : build des deux images, test de fumée étendu (voir critères ci-dessous).

**Critères d'acceptation de l'étape 1**
- `docker compose up` puis http://localhost:8080 : le portail demande le jeton, puis s'affiche.
- Sans jeton : 401 sur `/`, `/term/*` et `/code/*` (WebSocket compris).
- `/term/pwsh/` ouvre PowerShell 7 ; fermer l'onglet puis rouvrir retrouve la même session.
- `/code/` ouvre VS Code web sur `/home/dev`, terminal intégré fonctionnel.
- `az login --use-device-code` puis `docker compose down && docker compose up` : toujours connecté.
- `docker exec -it cloudbox pwsh` fonctionne.
- `CLOUDBOX_MODE=shell` : aucun port en écoute.
- `sudo` refusé par défaut, accepté avec `CLOUDBOX_SUDO=true`.
- Le test de fumée CI vérifie : `cloudbox-versions`, import des modules PowerShell en `dev`,
  réponse HTTP 401 puis 200 (avec jeton) de Caddy sur `/`, `/term/pwsh/`, `/code/`.

### Étape 2 — Confort et durcissement

Scripts PowerShell côté poste, module `Cloudbox.Connect`, upload/download de fichiers depuis le
portail, état des connexions (az / Graph / EXO) dans le portail.

### Hors périmètre pour l'instant

Hébergement central, multi-utilisateur, Azure Container Apps, oauth2-proxy / Entra ID en frontal,
Managed Identity. Ne pas les implémenter sans demande explicite.

## Conventions

- Documentation et commentaires en français (comme WSLC).
- Chaque outil ajouté : `ARG` épinglé + commentaire Renovate + entrée dans `cloudbox-versions`
  + vérification dans le test de fumée.
- Ne jamais écrire un numéro de version de mémoire : vérifier la dernière version stable
  (release GitHub, registre) au moment de l'ajout.
