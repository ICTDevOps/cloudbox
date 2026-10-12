// Accueil : présentation des outils (PowerShell, Bash, VS Code), astuces et versions de l'image.
// Les workspaces (liste, création) sont dans la barre latérale, les connexions dans chaque workspace.
import { useEffect, useState } from 'preact/hooks';
import { api, ENV_LABELS, ENVS, ID_RE, slugify, type Env, type ToolVersion } from './api';
import { ContextBar } from './context';
import { useWorkspaces } from './store';

// Ouvre la fenêtre de création de la barre latérale
export const NEW_WORKSPACE_EVENT = 'cloudbox:new-workspace';

export function EnvBadge({ env, large = false }: { env: Env; large?: boolean }) {
  return <span class={`env-badge env-${env}${large ? ' env-large' : ''}`}>{ENV_LABELS[env]}</span>;
}

export function TopBar({ children }: { children?: preact.ComponentChildren }) {
  return <header class="topbar">{children}</header>;
}

export function CreateWorkspace({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [env, setEnv] = useState<Env>('dev');
  const [folder, setFolder] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const effectiveId = idTouched ? id : slugify(name);
  const submit = async (event: Event) => {
    event.preventDefault();
    setError('');
    if (!ID_RE.test(effectiveId)) {
      setError('Identifiant invalide : lettres minuscules, chiffres et tirets (32 caractères max.).');
      return;
    }
    setBusy(true);
    try {
      await api.createWorkspace({ id: effectiveId, name: name.trim(), env, folder: folder.trim() || undefined });
      onCreated(effectiveId);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form class="card create-ws" onSubmit={submit}>
      <h2>Nouveau workspace</h2>
      <label>
        Nom
        <input value={name} onInput={(e) => setName(e.currentTarget.value)} required maxLength={64}
          placeholder="Client A — production" />
      </label>
      <label>
        Identifiant
        <input value={effectiveId} required maxLength={32} pattern="[a-z0-9][a-z0-9\-]{0,31}" spellcheck={false}
          onInput={(e) => { setIdTouched(true); setId(e.currentTarget.value); }} />
      </label>
      <fieldset class="env-choice">
        <legend>Environnement</legend>
        {ENVS.map((value) => (
          <label class={`env-option env-${value}${env === value ? ' selected' : ''}`} key={value}>
            <input type="radio" name="env" value={value} checked={env === value} onChange={() => setEnv(value)} />
            {ENV_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <label>
        Dossier de travail
        <input value={folder} onInput={(e) => setFolder(e.currentTarget.value)} spellcheck={false}
          placeholder={`/home/dev/workspaces/${effectiveId || '<identifiant>'}`} />
      </label>
      {error && <p class="error" role="alert">{error}</p>}
      <button type="submit" class="button primary" disabled={busy}>Créer et ouvrir</button>
    </form>
  );
}

interface Versions {
  generated: string;
  arch: string;
  tools: ToolVersion[];
}

function useVersions(): Versions | null | 'error' {
  const [data, setData] = useState<Versions | null | 'error'>(null);
  useEffect(() => {
    api.versions().then(setData).catch(() => setData('error'));
  }, []);
  return data;
}

// Version d'un outil (vide tant que versions.json n'est pas chargé)
function versionOf(data: Versions | null | 'error', name: string): string {
  if (!data || data === 'error') return '';
  return data.tools.find((t) => t.name === name)?.version ?? '';
}

function Tile({ icon, kind, title, version, children }: {
  icon: string;
  kind: string;
  title: string;
  version: string;
  children: preact.ComponentChildren;
}) {
  return (
    <article class="tile info-tile">
      <div class="tile-head">
        <span class={`tile-icon ${kind}`} aria-hidden="true">{icon}</span>
        <span class="tile-title">{title}</span>
        {version && <span class="tile-version">{version}</span>}
      </div>
      <div class="tile-text">{children}</div>
    </article>
  );
}

function ToolTiles({ data }: { data: Versions | null | 'error' }) {
  const extensions = data && data !== 'error' ? data.tools.filter((t) => t.category === 'Extensions VS Code') : [];
  return (
    <div class="tiles tool-tiles">
      <Tile icon=">_" kind="pwsh" title="PowerShell" version={versionOf(data, 'PowerShell')}>
        <p>Shell par défaut des terminaux. Modules préinstallés : Az, Microsoft.Graph, ExchangeOnlineManagement,
          MicrosoftTeams, PnP.PowerShell.</p>
        <p>Le prompt affiche l'environnement du workspace et le contexte réel : abonnement az CLI (<code>az:</code>)
          et contexte Az PowerShell (<code>AzPS:</code>).</p>
      </Tile>
      <Tile icon="$_" kind="bash" title="Bash" version={versionOf(data, 'Bash')}>
        <p>Les mêmes outils en ligne de commande : az, azd, Bicep, kubectl, helm, k9s, OpenTofu, Terraform, gh,
          m365…</p>
        <p>Complétion activée (az, kubectl, helm, gh, tofu…) et prompt avec la branche git et le contexte
          Kubernetes.</p>
      </Tile>
      <Tile icon="{ }" kind="code" title="VS Code" version={versionOf(data, 'code-server')}>
        <p>VS Code dans le navigateur (code-server), ouvert sur le dossier du workspace, avec son terminal
          intégré.</p>
        <p>Extensions : {extensions.length ? extensions.map((e) => e.name).join(', ') : 'PowerShell, Terraform, OpenTofu, YAML, Kubernetes'}
          {' '}(Open VSX).</p>
      </Tile>
    </div>
  );
}

function Tips() {
  return (
    <ul class="tips" aria-label="Astuces">
      <li><kbd>Clic droit</kbd> menu tmux (scinder, fermer)</li>
      <li><kbd>Sélection</kbd> copie</li>
      <li><kbd>Ctrl</kbd>+<kbd>V</kbd> colle</li>
      <li><kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>K</kbd> commandes de connexion</li>
    </ul>
  );
}

function VersionCards({ data }: { data: Versions | null | 'error' }) {
  const [filter, setFilter] = useState('');
  if (data === 'error') return <p class="muted">Versions indisponibles.</p>;
  if (!data) return <p class="muted">Chargement…</p>;
  const q = filter.trim().toLowerCase();
  const tools = data.tools.filter(
    (t) => !q || [t.name, t.command, t.category, t.version].some((v) => v.toLowerCase().includes(q)),
  );
  const categories = [...new Set(tools.map((t) => t.category))];
  return (
    <>
      <div class="versions-head">
        <input type="search" class="versions-filter" placeholder="Filtrer (az, kubectl, Graph…)" value={filter}
          onInput={(e) => setFilter(e.currentTarget.value)} aria-label="Filtrer les outils" />
        <span class="muted">
          Image construite le {new Date(data.generated).toLocaleDateString('fr-FR')} ({data.arch})
        </span>
      </div>
      <div class="versions-grid">
        {categories.map((category) => (
          <section class="card version-card" key={category}>
            <h3>{category}</h3>
            <table>
              <tbody>
                {tools.filter((t) => t.category === category).map((t) => (
                  <tr key={t.name} title={`Commande : ${t.command}`}>
                    <td>{t.name}</td>
                    <td class={t.version ? 'version' : 'version error'}>{t.version || 'non disponible'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {categories.length === 0 && <p class="muted">Aucun outil ne correspond.</p>}
      </div>
    </>
  );
}

export function Home() {
  const { list } = useWorkspaces();
  const versions = useVersions();

  return (
    <div class="page">
      <TopBar>
        <h1 class="page-title">Accueil</h1>
        <ContextBar />
      </TopBar>
      <main class="home">
        <section class="intro">
          <h2>Votre poste d'administration Azure et Microsoft 365</h2>
          <p class="muted">
            Ouvrez ou créez un workspace dans le menu de gauche : il regroupe vos terminaux PowerShell et Bash et
            VS Code pour un client, un projet ou un environnement.
          </p>
          {list?.length === 0 && (
            <button type="button" class="button primary" onClick={() => window.dispatchEvent(new CustomEvent(NEW_WORKSPACE_EVENT))}>
              Créer mon premier workspace
            </button>
          )}
        </section>

        <section aria-labelledby="tools-title">
          <h2 id="tools-title" class="section-title">Dans chaque workspace</h2>
          <ToolTiles data={versions} />
          <Tips />
        </section>

        <section aria-labelledby="versions-title">
          <h2 id="versions-title" class="section-title">Outils de l'image</h2>
          <VersionCards data={versions} />
        </section>
      </main>
      <footer class="home-footer">Olivier Malfroidt — VNET Consult — 2026</footer>
    </div>
  );
}
