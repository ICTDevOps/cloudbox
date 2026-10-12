# Cloudbox

Un **Cloud Shell local pour Azure et Microsoft 365** : un container Docker qui tourne sur votre
PC et s'utilise depuis le navigateur, avec un terminal web (PowerShell et Bash), VS Code web et
tous les outils d'administration Azure / M365 à jour.

> **Statut : en conception.** Rien n'est encore utilisable. Le cadrage technique est dans
> [`CLAUDE.md`](CLAUDE.md).

## Principe

```
navigateur ──http://localhost:8080──▶ container cloudbox
                                        ├── portail
                                        ├── terminal web (PowerShell / Bash, sessions persistantes)
                                        └── VS Code web
                                       /home/dev = volume persistant (logins, clés, repos)
```

- **Un container par personne, sur son propre PC** (Docker Desktop, Podman ou wslc).
  Pas de serveur central.
- Accès **uniquement depuis le PC** (`127.0.0.1`), protégé par un jeton.
- L'accès terminal classique reste possible : `docker exec -it cloudbox pwsh`.

## Outils prévus

| Domaine | Outils |
| --- | --- |
| Azure | Azure CLI, Azure Developer CLI, Bicep |
| PowerShell | PowerShell 7 + modules Az, Microsoft.Graph, ExchangeOnlineManagement, MicrosoftTeams, PnP.PowerShell |
| Microsoft 365 | CLI for Microsoft 365 |
| Kubernetes / GitHub | kubectl, helm, gh |
| Interface web | ttyd + tmux (terminal), code-server (VS Code), Caddy (proxy et authentification) |

Toutes les versions sont épinglées et mises à jour automatiquement par Renovate, avec un build
et un test de fumée avant chaque publication.

## Origine

Idée inspirée de [WSLC](https://github.com/CTroessaert/WSLC) (CTroessaert), un
container `wslc` d'administration Azure / M365. Cloudbox en reprend les principes (versions
épinglées, Renovate, home persistant) et y ajoute l'interface web. Aucun code de WSLC n'est
réutilisé.
