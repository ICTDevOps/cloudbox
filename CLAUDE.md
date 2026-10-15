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
  fonctionner aussi. Image **amd64 uniquement** (choix assumé : pas de besoin arm64 ; les
  Dockerfile gardent la gestion d'arm64 pour pouvoir la réactiver dans le workflow).

## Ce qu'on reprend de WSLC (les principes, pas le code)

> **Licence.** Le dépôt WSLC n'a pas de licence : son code reste la propriété de son auteur.
> On reprend ses **principes** (listés ci-dessous), mais **on ne copie aucun fichier** de WSLC
> (Dockerfile, scripts PowerShell, workflow, `renovate.json`, scripts de build). Tout est écrit
> pour Cloudbox. Cette règle sera levée si l'auteur ajoute une licence permissive ou donne son
> accord ; ce fichier sera alors mis à jour.

- Le Dockerfile des outils CLI : az, azd, Bicep, PowerShell 7 + modules Az, Microsoft.Graph,
  ExchangeOnlineManagement, MicrosoftTeams, PnP.PowerShell, CLI for Microsoft 365, Node.js LTS,
  kubectl, helm, gh, et les outils de base (détail dans « Outils de base » ci-dessous).
- **Versions épinglées** : une ligne `ARG <OUTIL>_VERSION` par outil, précédée d'un commentaire
  `# renovate: datasource=… depName=…`. Ne jamais installer un outil en « latest ».
- **Renovate** : une PR par outil, `minimumReleaseAge` de 3 jours, fusion automatique des
  patch/minor si le build est vert, revue manuelle des majeures.
- **CI GitHub Actions** : build amd64, test de fumée qui bloque la PR,
  publication sur GHCR, release GitHub avec `versions.json`.
- **`/home/dev` en volume persistant** : jetons, `~/.azure`, clés SSH, modules `CurrentUser`
  survivent à la recréation du container.
- Utilisateur non-root `dev` (uid 1000), télémétrie des CLI désactivée.

## Outils de base (paquets Ubuntu, image `:cli`)

Bash est un shell de premier plan, au même niveau que PowerShell : entrée `/term/bash/` dans le
portail, complétion (`bash-completion`) activée pour az, kubectl, helm, gh, et un `.bashrc` par
défaut soigné (prompt avec contexte git et kube, alias courants). `CLOUDBOX_SHELL=pwsh|bash`
choisit le shell par défaut de `docker exec` et du terminal intégré de VS Code.

Paquets Ubuntu à installer (suivis par l'`apt upgrade` du build hebdomadaire, pas d'épinglage) :

| Catégorie | Paquets |
|---|---|
| Shell et confort | `bash`, `bash-completion`, `tmux`, `less`, `vim`, `nano`, `tree`, `fzf`, `ripgrep`, `bat`, `htop` |
| Certificats et crypto | `openssl`, `ca-certificates`, `gnupg` |
| Réseau | `curl`, `wget`, `bind9-dnsutils` (dig, nslookup), `iputils-ping`, `traceroute`, `mtr-tiny`, `netcat-openbsd`, `whois`, `iproute2`, `openssh-client` |
| Données | `jq`, `unzip`, `zip`, `rsync` (yq : voir « Outils complémentaires ») |
| Dev | `git`, `git-lfs`, `python3`, `python3-pip`, `pipx`, `make` |
| Système | `sudo`, `tzdata`, `locales` |

Sur Ubuntu, `bat` s'appelle `batcat` : ajouter un alias.

`openssl` sert notamment à inspecter et convertir les certificats (PEM / PFX / CER) pour les
App Registrations, Key Vault et les connexions PowerShell par certificat.

## Outils complémentaires (binaires épinglés, image `:cli`)

Installés depuis les releases officielles (binaire ou archive, variante amd64 ; garder la sélection d'architecture dans les Dockerfile), **épinglés
et suivis par Renovate** exactement comme az, kubectl ou helm : `ARG` + commentaire
`# renovate:`, une PR par outil, fusion automatique des patch/minor si le build est vert.

| Outil | Usage | Commentaire Renovate |
|---|---|---|
| OpenTofu (`tofu`) | IaC | `datasource=github-releases depName=opentofu/opentofu extractVersion=^v(?<version>.+)$` |
| Terraform | IaC (projets qui l'imposent) | `datasource=github-releases depName=hashicorp/terraform extractVersion=^v(?<version>.+)$` |
| kubelogin | Authentification Entra ID sur AKS | `datasource=github-releases depName=Azure/kubelogin extractVersion=^v(?<version>.+)$` |
| k9s | Interface terminal Kubernetes | `datasource=github-releases depName=derailed/k9s extractVersion=^v(?<version>.+)$` |
| kubectx / kubens | Changement de contexte et de namespace | `datasource=github-releases depName=ahmetb/kubectx extractVersion=^v(?<version>.+)$` |
| azcopy | Transferts vers Azure Storage | `datasource=github-releases depName=Azure/azure-storage-azcopy extractVersion=^v(?<version>.+)$` |
| sqlcmd (go-sqlcmd) | Azure SQL / SQL Server | `datasource=github-releases depName=microsoft/go-sqlcmd extractVersion=^v(?<version>.+)$` |
| yq (mikefarah) | YAML en ligne de commande | `datasource=github-releases depName=mikefarah/yq extractVersion=^v(?<version>.+)$` |

Règles :
- **Vérifier le format exact des tags et des noms d'archives** de chaque projet avant d'écrire
  l'URL et l'`extractVersion` (les conventions diffèrent : préfixe `v` ou non, nom de l'archive
  par architecture). Les commentaires ci-dessus sont un point de départ, pas une vérité.
- **Vérifier la somme de contrôle** (SHA-256) publiée avec la release quand le projet en fournit une.
- Ajouter la complétion Bash quand l'outil la génère (`tofu`, `kubectl`, `k9s`, `yq`…).
- Chaque outil est ajouté à `cloudbox-versions` et vérifié dans le test de fumée
  (`<outil> --version` ou équivalent) : une mise à jour qui casse un binaire bloque la PR Renovate.
- Terraform est sous licence BSL : acceptable pour un usage d'administration, à mentionner
  dans le README.
- `yq` vient d'ici (version mikefarah), pas du paquet Ubuntu.

## Architecture

### Deux images, une seule chaîne de build

```
image/cli/Dockerfile   → ghcr.io/<owner>/cloudbox:cli   (équivalent WSLC, sans web)
image/web/Dockerfile   → ghcr.io/<owner>/cloudbox:web   (FROM :cli + stack web)
```

- `:cli` reste utilisable seul, y compris avec wslc (mode `sleep infinity`).
- `:web` est reconstruite à chaque changement de `:cli`.
- Tags : `:cli`, `:web`, `:latest` (= `:web`), `:vAAAA.MM.JJ-cli`, `:vAAAA.MM.JJ-web`, `:edge`, `:sha-…`.
- Release GitHub `vAAAA.MM.JJ` (puis `.2`, `.3`… le même jour) à chaque fusion sur `main` qui change
  l'image (version d'un outil, paquet Ubuntu, commit dans `image/`), et au rebuild du lundi seulement
  si quelque chose a changé. Elle déplace `:cli`, `:web`, `:latest` ; sa description (en anglais,
  `.github/scripts/release-notes.py`) liste les outils mis à jour (avant / après), les commits de
  l'image, les paquets Ubuntu mis à jour et toutes les versions.

### Contenu de l'image `:web`

```
navigateur ──http://localhost:8080──▶ Caddy (reverse proxy + auth)
                                        ├── /        → portail (application statique, workspaces)
                                        ├── /api/    → cloudbox-api (Node, socket UNIX)
                                        ├── /term/   → ttyd → tmux → pwsh | bash
                                        └── /code/   → code-server
                       s6-overlay supervise Caddy, cloudbox-api, ttyd (x2) et code-server
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

### Portail et workspaces

Le portail est une application statique construite au build (étape Node dans
`image/web/Dockerfile`, rien de Node n'est ajouté à l'image finale en dehors de ce que `:cli`
contient déjà) :

| Couche | Choix |
|---|---|
| Langage | TypeScript |
| Build | Vite |
| Composants (panneaux riches : accueil, palette, assistant) | Preact |
| Disposition en panneaux (docking) | Dockview (`dockview-core`, sans React) |
| API | `cloudbox-api` : Node (TypeScript exécuté directement, sans dépendance), socket UNIX derrière Caddy |

Dépendances npm épinglées (`package-lock.json`) et suivies par Renovate comme le reste.

Un **workspace** (un client, un projet, un environnement) regroupe des panneaux PowerShell,
Bash et VS Code dans une disposition redimensionnable, sauvegardée dans le volume
(`/home/dev/.cloudbox/workspaces/<id>.json`). Chaque panneau terminal a sa session tmux
(`<workspace>-<shell>[-n]`), VS Code s'ouvre sur le dossier du workspace.
Charte : thème sombre bleu nuit (maquettes de l'utilisateur) et thème clair dérivé, couleurs en
variables CSS (`styles.css`), icônes SVG intégrées (`icons.tsx`, évocations simplifiées des marques,
jamais les logos officiels ni de ressource externe), illustration de l'accueil en SVG (`hero.tsx`).
VS Code suit le thème du système (`window.autoDetectColorScheme`, réglage « machine »).
Le formulaire de création propose un sélecteur de dossier (`GET /api/folders?path=`, dossiers non
cachés de `/home/dev`, liens résolus, jamais au-dessus). Les onglets Dockview ont « + » (terminal du
même type dans le groupe), « ouvrir dans un onglet du navigateur » et « agrandir ».
La fenêtre « ⚙ Paramètres » de la barre latérale (onglets Général, Workspaces, Assistant IA)
enregistre les préférences du portail dans `/home/dev/.cloudbox/preferences.json` (`GET/PUT
/api/preferences`) : thème (auto / clair / sombre, mis en cache dans `localStorage` pour le premier
rendu), environnement et panneaux proposés à la création, apparence des terminaux (onglet Terminal :
police du poste, taille, interligne, curseur, couleurs, barre de chemin). L'apparence est appliquée
par la page ttyd (`image/web/build/ttyd-index-addon.html`) à `window.term`, depuis le cache
`localStorage` `cloudbox.terminal` puis `/api/preferences`, et suivie à chaud (événement `storage`).
La barre de chemin (`portal/src/pathbar.ts`) lit `GET /api/workspaces/:id/terminals`
(`#{pane_current_path}` de tmux ; le prompt PowerShell aligne le dossier du processus sur
`Set-Location`). Un clic sur un segment saisit `cd '…'` sans Entrée, comme l'aide-mémoire (panneau des commandes de connexion). Les panneaux choisis à la création
(`initialPanels`) donnent la disposition de la première ouverture.
L'environnement déclaré (DEV / ACC / PRD) est très visible, mais **le contexte affiché
(abonnement Azure, cluster Kubernetes) est toujours lu depuis l'état réel**, jamais déclaré,
y compris dans le prompt de chaque shell.

### Assistant IA

Panneau Dockview « Assistant » (composant Preact), **désactivé par défaut**, activé dans le
portail (« ⚙ Paramètres » de la barre latérale, onglet « Assistant IA »). `CLOUDBOX_ASSISTANT=off`
l'interdit sur le poste. Modèle par défaut, ou propre au workspace (⚙ du workspace, champ
`assistant` de son JSON) ; priorité : choix de la conversation > workspace > défaut.

- **Fournisseurs par clé API** : OpenRouter, Anthropic, OpenAI, et tout point d'accès compatible
  OpenAI (Azure OpenAI, passerelle). Clés dans `/home/dev/.cloudbox/assistant/config.json` (0600) ou
  `CLOUDBOX_<FOURNISSEUR>_API_KEY` ; jamais renvoyées au navigateur, non exportées dans les
  terminaux web ni dans code-server (elles restent lisibles par `dev` : fichier, `docker exec`),
  masquées à l'identique, comme le jeton Cloudbox, dans tout ce qui part vers un fournisseur. Liste des modèles lue chez le fournisseur, aucun identifiant
  de modèle en dur.
- **Abonnements Claude / ChatGPT** : jamais dans le panneau natif (leur jeton est réservé aux
  applications de l'éditeur). Ils passeront par un panneau « Agent CLI » (Claude Code, Codex CLI
  dans un terminal du workspace) : à faire.
- **Contexte par workspace** : `AGENTS.md` du dossier du workspace (écrit par l'utilisateur),
  mémoire et conversations dans `/home/dev/.cloudbox/assistant/workspaces/<id>/` (supprimées avec
  le workspace), environnement et paramètres déclarés, contexte réel relu à chaque échange.
- **Outils** : lecture libre (contexte réel, terminaux du workspace par `tmux capture-pane`,
  fichiers du dossier du workspace sauf dossiers cachés du home, mémoire) ; `run_command` ne
  fait que **proposer**.
- **Secrets** : masqués par motifs (`assistant/redact.ts`) avant tout envoi et tout enregistrement.
- Code : `image/web/api/assistant/` (adaptateurs en streaming sans dépendance, boucle d'agent,
  routes), `image/web/portal/src/assistant.tsx`, `ai-settings.tsx` (onglet de `preferences.tsx`).

Seul Caddy écoute sur le réseau du container (port 8080). ttyd, code-server et cloudbox-api
écoutent sur des sockets UNIX à l'intérieur du container, sans authentification propre :
Caddy est la seule porte.

### Init

Un script `cont-init.d` de s6 (`cloudbox-init`, équivalent du `devbox-init` de WSLC, réécrit) :
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
6. En-têtes de sécurité dans Caddy (`X-Frame-Options`, `Content-Security-Policy` adaptée par
   route, `Referrer-Policy: no-referrer`). Les panneaux du workspace sont des iframes de même
   origine : `/term/*` et `/code/*` sont en `SAMEORIGIN` / `frame-ancestors 'self'`, le reste en `DENY`.
7. API : écritures en JSON uniquement (`Content-Type: application/json`, donc requête
   « non simple » bloquée en cross-origin), noms de workspace validés strictement
   (`^[a-z0-9][a-z0-9-]{0,31}$`) avant tout usage dans une commande ou un chemin.
   Les paramètres de connexion d'un workspace (tenant, abonnement, URL SharePoint, ClientId) suivent
   des jeux de caractères stricts ; la saisie dans un terminal (`tmux send-keys -l`) refuse tout
   caractère de contrôle : jamais d'Entrée, la commande est validée par l'utilisateur.
   **Seule exception** : une commande proposée par l'assistant, après clic sur « Exécuter »
   (`POST …/assistant/…/proposals/:pid/approve`). Le texte reste soumis aux mêmes règles et la
   touche Entrée est envoyée à part. L'API vérifie que la session appartient au workspace et au
   shell visé, que le terminal est sur une ligne de prompt vide (rien de déjà saisi, pas de
   commande en cours), et exige `confirmPrd` en PRD. La carte de
   validation affiche le contexte réel, en rouge s'il diffère du tenant ou de l'abonnement déclaré.
   La fin de la commande est signalée par les prompts Cloudbox (option tmux `@cloudbox_prompt`).

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
- Scripts PowerShell écrits pour Cloudbox, sur le modèle fonctionnel de WSLC, pour `docker` (avec détection de `wslc` en option) :
  `Install-Cloudbox.ps1`, `Update-Cloudbox.ps1`, `Enter-Cloudbox.ps1`, `Uninstall-Cloudbox.ps1`.
  - Install : crée le volume et le container, la tâche planifiée de mise à jour, le profil
    Windows Terminal (`docker exec -it cloudbox pwsh`), affiche l'URL et le jeton.
  - Update : `docker pull`, recrée le container si l'image a changé, ne le fait pas si une session
    est active (tmux attaché ou terminal ouvert) — reprendre la logique `SkipUpdateWhenBusy`.
- `config/cloudbox.psd1` + `config/cloudbox.local.psd1` (ignoré par git), comme dans WSLC.

## Structure cible du dépôt

```
image/cli/Dockerfile
image/cli/build/                       # scripts d'aide au build (installation des modules PowerShell…)
image/cli/rootfs/usr/local/bin/        # cloudbox-versions
image/web/Dockerfile
image/web/rootfs/etc/s6-overlay/s6-rc.d/   # caddy, ttyd-pwsh, ttyd-bash, code-server, cloudbox-init
image/web/rootfs/etc/caddy/Caddyfile
image/web/portal/                      # portail : TypeScript + Vite + Preact + Dockview
image/web/api/                         # cloudbox-api (Node, TypeScript sans dépendance) ; assistant/ ; test/
compose.yaml
config/cloudbox.psd1
scripts/*.ps1
.github/workflows/build.yml
renovate.json
README.md
```

## Feuille de route

### Étape 1 — PoC local (à faire en premier)

1. Écrire l'image `image/cli/` couvrant les mêmes outils que WSLC (sans copier son Dockerfile).
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

### Étape 2 — Workspaces (en cours)

1. Portail reconstruit (TypeScript + Vite + Preact + Dockview) et `cloudbox-api`.
2. Workspaces : création (nom, environnement DEV / ACC / PRD, dossier), disposition en panneaux
   PowerShell / Bash / VS Code redimensionnables, sauvegardée dans le volume, retrouvée à la
   connexion suivante ; une session tmux par panneau.
3. Contexte réel (abonnement Azure, cluster Kubernetes) dans l'en-tête et dans le prompt des
   shells ; environnement PRD très visible.

### Étape 3 — Isolation des identités et garde-fous

Isolation par workspace : `AZURE_CONFIG_DIR` (az, azd), `KUBECONFIG`, `GH_CONFIG_DIR` ; modules
PowerShell (Az, Graph, EXO, Teams, PnP) seulement là où c'est vérifié module par module.
Confirmation des opérations destructrices dans un workspace PRD (aide, pas une garantie).

### Étape 2 bis — Assistant IA (en cours)

1. Panneau natif par clé API (fait) : voir « Assistant IA » dans Architecture.
2. Panneau « Agent CLI » pour les abonnements : Claude Code et Codex CLI épinglés dans `:cli`,
   nouvelle sorte de terminal dans `cloudbox-term`, configuration isolée par workspace
   (`CLAUDE_CONFIG_DIR`, équivalent Codex à vérifier), lecture seule ou plan en PRD.

### Étape 4 — Productivité

Palette de commandes, bibliothèque de commandes (insertion dans le terminal actif), état des
connexions (az / Graph / EXO), upload/download de fichiers.

### Plus tard, en option

- Scripts PowerShell côté poste, module `Cloudbox.Connect`.

### Hors périmètre pour l'instant

Hébergement central, multi-utilisateur, Azure Container Apps, oauth2-proxy / Entra ID en frontal,
Managed Identity. Ne pas les implémenter sans demande explicite. Sans serveur central,
l'isolation par workspace suffit : pas d'authentification Entra ID devant `localhost`.

## Conventions

- Commentaires et documentation interne (dont ce fichier) en français. **Le `README.md` est en
  anglais**, illustré par les captures de `docs/screenshots/` (régénérées par
  `docs/screenshots/capture.sh` quand l'interface change).
- Interface du portail en français et en anglais : toute chaîne affichée passe par
  `image/web/portal/src/i18n.ts` (les deux dictionnaires, le français fait référence) ; les
  messages d'erreur de `cloudbox-api` sont donnés dans les deux langues (`Accept-Language`).
- Chaque outil ajouté : `ARG` épinglé + commentaire Renovate + entrée dans `cloudbox-versions`
  + vérification dans le test de fumée.
- Image de base : Ubuntu 26.04 LTS. Renovate suit son digest, mais pas le passage à la LTS
  suivante : migration manuelle (noms de paquets comme `libicu<N>`, dépôt azure-cli de la version).
- Ne jamais écrire un numéro de version de mémoire : vérifier la dernière version stable
  (release GitHub, registre) au moment de l'ajout.
