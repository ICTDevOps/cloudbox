# Cloudbox

Un **Cloud Shell local pour Azure et Microsoft 365** : un container Docker qui tourne sur votre
PC et s'utilise depuis le navigateur, avec un terminal web (PowerShell et Bash), VS Code web et
tous les outils d'administration Azure / M365 à jour.

> **Statut : étape 2 (workspaces).** Les images `:cli` et `:web` se construisent et passent leurs
> tests (HTTP et navigateur). Le cadrage technique et la feuille de route sont dans
> [`CLAUDE.md`](CLAUDE.md).

## Principe

```
navigateur ──http://localhost:8080──▶ container cloudbox
                                        Caddy (jeton, contrôle Host/Origin)
                                        ├── /           portail et workspaces
                                        ├── /api/       cloudbox-api (workspaces, contexte)
                                        ├── /term/pwsh/ terminal PowerShell (ttyd + tmux)
                                        ├── /term/bash/ terminal Bash (ttyd + tmux)
                                        └── /code/      VS Code web (code-server)
                                       /home/dev = volume persistant (logins, clés, repos)
```

- **Un container par personne, sur son propre PC** (Docker Desktop, Podman ou wslc).
  Pas de serveur central.
- Accès **uniquement depuis le PC** (`127.0.0.1`), protégé par un jeton.
- L'accès terminal classique reste possible : `docker exec -it cloudbox pwsh`.

## Démarrage

```bash
docker compose up -d
docker compose logs cloudbox | grep "Jeton"     # jeton généré au premier démarrage
```

Ouvrez http://localhost:8080 et collez le jeton. Il est conservé dans le volume
(`~/.cloudbox/token`) et reste le même d'un redémarrage à l'autre.

Variables (fichier `.env` à côté de `compose.yaml`, ignoré par git ; modèle : `.env.example`) :

| Variable | Défaut | Rôle |
|---|---|---|
| `CLOUDBOX_IMAGE` | `ghcr.io/ictdevops/cloudbox:web` | Image à utiliser (`cloudbox:web` pour un build local) |
| `CLOUDBOX_PORT` | `8080` | Port local, toujours publié sur `127.0.0.1` |
| `CLOUDBOX_TOKEN` | généré | Jeton imposé (16 caractères minimum) |
| `CLOUDBOX_SUDO` | `false` | `true` pour autoriser `sudo` dans le container |
| `CLOUDBOX_SHELL` | `pwsh` | Shell par défaut : `cloudbox-shell`, terminal intégré de VS Code |
| `CLOUDBOX_MODE` | `web` | `shell` : aucun service web, pour wslc ou `docker exec` |
| `TZ` | `Europe/Paris` | Fuseau horaire |

Terminal sans navigateur : `docker exec -it cloudbox pwsh`, `docker exec -it cloudbox bash` ou
`docker exec -it cloudbox cloudbox-shell` (shell choisi par `CLOUDBOX_SHELL`). Les sessions tmux
du terminal web s'y rattachent avec `tmux attach -t pwsh` ou `tmux attach -t bash`.

Dans le terminal web, la souris pilote tmux : clic droit pour le menu des panneaux (scinder,
fermer…, le menu reste ouvert jusqu'au clic), molette pour l'historique. **Copier** : sélectionner à la souris (ou double-cliquer sur
un mot) ; le texte part dans le presse-papiers du poste (« Copié » s'affiche). **Coller** :
Ctrl+V, ou Maj + clic droit pour le menu du navigateur. Ctrl+V n'est donc plus transmis au
terminal (dans vim, le mode bloc reste accessible par Ctrl+Q). Après un redémarrage ou une mise à jour du container, les terminaux ouverts
se reconnectent seuls dès que le serveur répond (la session tmux est retrouvée si le container
n'a pas été recréé).

### Construire les images localement

```bash
docker build -t cloudbox:cli -f image/cli/Dockerfile image/cli
docker build -t cloudbox:web -f image/web/Dockerfile --build-arg BASE_IMAGE=cloudbox:cli .
tests/smoke-cli.sh cloudbox:cli
tests/smoke-web.sh cloudbox:web
tests/smoke-browser.sh cloudbox:web     # Chromium headless (Playwright), captures dans tests/browser-out/
CLOUDBOX_IMAGE=cloudbox:web docker compose up -d
```

## Langue

L'interface est en français ou en anglais : boutons **FR / EN** en bas de la barre latérale et
sur la page de connexion. Le choix est mémorisé dans le navigateur ; à défaut, la langue du
navigateur s'applique. Les messages d'erreur de l'API suivent la langue choisie. Restent en
anglais quelle que soit la langue : VS Code (code-server), le menu de tmux et les outils
eux-mêmes.

## Accueil

L'accueil présente les trois outils de chaque workspace (PowerShell, Bash, VS Code), les gestes
utiles du terminal et la version de chaque outil de l'image, par catégorie et avec un filtre
(extensions VS Code comprises). Les workspaces se créent et s'ouvrent depuis la barre latérale.
Au premier démarrage, le panneau VS Code affiche « VS Code démarre… » et se recharge seul le
temps que code-server installe ses extensions.

## Workspaces

Un workspace regroupe, pour un client, un projet ou un environnement, des terminaux PowerShell et
Bash et VS Code dans une disposition en panneaux (redimensionnables, déplaçables par glisser-déposer).

- Une barre latérale, toujours visible, liste les workspaces (couleur de l'environnement) et
  permet d'en créer un nouveau : nom, identifiant, environnement **DEV / ACC / PRD**, dossier de
  travail (par défaut `/home/dev/workspaces/<identifiant>`). Elle se replie en colonne d'icônes.
- Passer d'un workspace à l'autre ne recharge rien : les quatre derniers ouverts restent chargés
  (terminaux et VS Code), signalés par un point bleu dans la barre.
- La disposition est enregistrée automatiquement dans le volume
  (`~/.cloudbox/workspaces/<identifiant>.json`) et retrouvée à la connexion suivante.
- Chaque panneau terminal a sa session tmux, `<identifiant>_<shell>_<n>` : recharger la page,
  fermer l'onglet du navigateur ou déplacer un panneau ne l'arrête pas. Seule la croix d'un
  onglet (avec confirmation) ferme la session. Supprimer un workspace (⚙ Paramètres) ferme ses sessions mais
  **conserve son dossier**.
- **Paramètres** (bouton ⚙) : nom, environnement, et valeurs de connexion du workspace (tenant,
  abonnement, URL SharePoint, ClientId de l'application Entra pour PnP et CLI for Microsoft 365).
- **Connexions** (bouton à droite de la barre, ou Ctrl+Maj+K, y compris depuis un terminal) : panneau
  des commandes de connexion, complétées avec les paramètres du workspace. Chaque commande se
  copie, ou se saisit d'un clic dans le dernier terminal utilisé (un terminal PowerShell pour les
  cmdlets), **sans être exécutée** : on la relit, puis Entrée. L'état réel est indiqué quand le
  portail peut le lire (az CLI, Az PowerShell, kubectl, gh), avec une alerte si az est connecté à
  un autre tenant ou abonnement que ceux du workspace ; Graph, Exchange, Teams et PnP dépendent de
  chaque session PowerShell et ne sont pas visibles.
- Un workspace PRD est encadré de rouge, et le prompt de ses shells porte un badge
  `PRD <identifiant>`.
- Le contexte affiché (abonnement az CLI, contexte Az PowerShell, cluster Kubernetes) est lu dans
  les fichiers de configuration réels, jamais déclaré. Le prompt des shells affiche aussi
  l'abonnement az CLI (`az:`) et, en PowerShell, le contexte Az (`AzPS:`) dès que le module
  `Az.Accounts` est chargé : ce sont deux contextes distincts.

> **Limite actuelle :** les connexions (az, Az PowerShell, kubectl…) sont encore **communes à
> tous les workspaces**, ce que le portail signale (« partagé entre workspaces »). L'isolation des
> identités par workspace est l'étape 3 de la feuille de route.

## Connexion aux services (device code)

Dans un workspace, le panneau **Connexions** donne ces commandes déjà complétées (tenant,
abonnement, URL SharePoint, ClientId).

| Service | Commande |
|---|---|
| Azure CLI | `az login --use-device-code` |
| Az PowerShell | `Connect-AzAccount -UseDeviceAuthentication` |
| Microsoft Graph | `Connect-MgGraph -UseDeviceCode` |
| Exchange Online | `Connect-ExchangeOnline -Device` |
| Microsoft Teams | `Connect-MicrosoftTeams -UseDeviceAuthentication` |
| PnP PowerShell | `Connect-PnPOnline -Url … -DeviceLogin -ClientId <app-id>` |
| CLI for Microsoft 365 | `m365 login --authType deviceCode` |

Les caches de jetons sont dans `/home/dev` (volume) : ils survivent à la recréation du container.

## Outils

| Domaine | Outils |
| --- | --- |
| Azure | Azure CLI, Azure Developer CLI, Bicep, AzCopy, sqlcmd (go-sqlcmd) |
| PowerShell | PowerShell 7 + modules Az, Microsoft.Graph, ExchangeOnlineManagement, MicrosoftTeams, PnP.PowerShell |
| Microsoft 365 | CLI for Microsoft 365 (Node.js LTS) |
| Kubernetes | kubectl, helm, kubelogin, k9s, kubectx / kubens |
| IaC | OpenTofu, Terraform |
| Outils | gh, git, jq, yq, openssl, tmux, fzf, ripgrep, bat, outils réseau… |
| Interface web | Caddy, ttyd + tmux, code-server, s6-overlay ; portail TypeScript + Vite + Preact + Dockview |

`cloudbox-versions` affiche les versions installées (outils, modules PowerShell, extensions
VS Code) ; l'accueil du portail et chaque release GitHub (`versions.json`) reprennent cette liste.

Extensions VS Code préinstallées (Open VSX) : PowerShell, HashiCorp Terraform, OpenTofu, YAML,
Kubernetes. **L'extension Bicep (`ms-azuretools.vscode-bicep`) n'est pas publiée sur Open VSX** :
elle n'est pas installée. Les fonctions IA de VS Code (Chat, Copilot) sont désactivées par défaut.

**Terraform** est distribué sous licence BSL 1.1 (Business Source License) : son usage pour
administrer ses propres infrastructures est autorisé. OpenTofu (MPL 2.0) est installé à côté.

## Sécurité

- Port publié sur `127.0.0.1` uniquement ; seul Caddy écoute en TCP dans le container,
  ttyd et code-server sont sur des sockets UNIX.
- Authentification obligatoire : jeton échangé contre un cookie de session `HttpOnly`,
  `SameSite=Strict`, ou en-tête `Authorization: Bearer <jeton>` (scripts). Sans session : 401.
- En-tête `Host` limité à `localhost` / `127.0.0.1` (DNS rebinding) ; `Origin` vérifié, et
  obligatoire pour les WebSocket (CSRF).
- En-têtes de sécurité : `X-Frame-Options`, `Content-Security-Policy` par route,
  `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`.
- Utilisateur non-root `dev` (uid 1000), y compris pour s6-overlay et les services.
  `sudo` désactivé par défaut ; `CLOUDBOX_SUDO=true` ne peut être fixé qu'à la création du
  container (la variable est lue dans l'environnement du PID 1).
- Ni socket Docker monté, ni `--privileged`. Télémétrie des CLI désactivée.

## Images et mises à jour

| Tag | Contenu |
|---|---|
| `:web`, `:latest` | Image complète (build hebdomadaire) |
| `:cli` | Outils seuls, sans interface web (usage wslc / `docker exec`) |
| `:vAAAA.MM.JJ-web`, `:vAAAA.MM.JJ-cli` | Build hebdomadaire daté |
| `:edge` | Dernier commit sur `main` |
| `:sha-<commit>-web`, `:sha-<commit>-cli` | Build d'un commit |

Chaque outil est épinglé (`ARG <OUTIL>_VERSION` + commentaire `# renovate:`). Renovate ouvre
une PR par outil après 3 jours de publication ; le workflow construit amd64 et arm64 et lance le
test de fumée ; les patch/minor sont fusionnées automatiquement si tout est vert, les majeures
attendent une revue. La fusion automatique suppose que la protection de `main` exige le statut
du workflow `build`.

## Origine

Idée inspirée de [WSLC](https://github.com/CTroessaert/WSLC) (CTroessaert), un
container `wslc` d'administration Azure / M365. Cloudbox en reprend les principes (versions
épinglées, Renovate, home persistant) et y ajoute l'interface web. Aucun code de WSLC n'est
réutilisé.
