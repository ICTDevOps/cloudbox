// Accueil : workspaces, création, accès rapide, aide (connexions et versions).
import { useEffect, useState } from 'preact/hooks';
import { api, ENV_LABELS, ENVS, ID_RE, slugify, type Env, type ToolVersion, type WorkspaceSummary } from './api';
import { ContextBar } from './context';
import { useWorkspaces, workspaceStore } from './store';

export function EnvBadge({ env, large = false }: { env: Env; large?: boolean }) {
  return <span class={`env-badge env-${env}${large ? ' env-large' : ''}`}>{ENV_LABELS[env]}</span>;
}

export function TopBar({ children }: { children?: preact.ComponentChildren }) {
  return <header class="topbar">{children}</header>;
}

function WorkspaceCard({ ws, onDeleted }: { ws: WorkspaceSummary; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    const ok = window.confirm(
      `Supprimer le workspace « ${ws.name} » ?\n\nSes sessions de terminal seront fermées.\n` +
        `Le dossier ${ws.folder} est conservé.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.deleteWorkspace(ws.id);
      onDeleted();
    } catch (err) {
      window.alert((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <article class={`ws-card env-border-${ws.env}`}>
      <div class="ws-card-head">
        <EnvBadge env={ws.env} />
        <h3>{ws.name}</h3>
      </div>
      <p class="muted ws-folder"><code>{ws.folder}</code></p>
      <div class="ws-actions">
        <a class="button primary" href={`#/w/${ws.id}`}>Ouvrir</a>
        <button type="button" class="button ghost" onClick={remove} disabled={busy}>Supprimer</button>
      </div>
    </article>
  );
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

const CHEATSHEET: [string, string][] = [
  ['Azure CLI', 'az login --use-device-code'],
  ['Azure Developer CLI', 'azd auth login --use-device-code'],
  ['Az PowerShell', 'Connect-AzAccount -UseDeviceAuthentication'],
  ['Microsoft Graph', 'Connect-MgGraph -UseDeviceCode -Scopes "User.Read.All"'],
  ['Exchange Online', 'Connect-ExchangeOnline -Device'],
  ['Microsoft Teams', 'Connect-MicrosoftTeams -UseDeviceAuthentication'],
  ['PnP PowerShell', 'Connect-PnPOnline -Url https://<tenant>.sharepoint.com -DeviceLogin -ClientId <app-id>'],
  ['CLI for Microsoft 365', 'm365 login --authType deviceCode'],
  ['GitHub CLI', 'gh auth login'],
  ['AKS (Entra ID)', 'az aks get-credentials -g <rg> -n <cluster> && kubelogin convert-kubeconfig -l azurecli'],
];

function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState('Copier');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setLabel('Copié');
    } catch {
      setLabel('Échec');
    }
    window.setTimeout(() => setLabel('Copier'), 1500);
  };
  return <button type="button" class="copy" onClick={copy} aria-label={`Copier : ${text}`}>{label}</button>;
}

function Versions() {
  const [data, setData] = useState<{ generated: string; arch: string; tools: ToolVersion[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api.versions().then(setData).catch(() => setFailed(true));
  }, []);
  if (failed) return <p class="muted">Versions indisponibles.</p>;
  if (!data) return <p class="muted">Chargement…</p>;
  const rows: preact.JSX.Element[] = [];
  let category = '';
  for (const tool of data.tools) {
    if (tool.category !== category) {
      category = tool.category;
      rows.push(<tr class="category" key={`c-${category}`}><td colSpan={3}>{category}</td></tr>);
    }
    rows.push(
      <tr key={tool.name}>
        <td>{tool.name}</td>
        <td><code>{tool.command}</code></td>
        <td class={tool.version ? '' : 'error'}>{tool.version || 'non disponible'}</td>
      </tr>,
    );
  }
  return (
    <>
      <p class="muted">Image construite le {new Date(data.generated).toLocaleDateString('fr-FR')} ({data.arch}).</p>
      <table class="versions">
        <thead><tr><th scope="col">Outil</th><th scope="col">Commande</th><th scope="col">Version</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
    </>
  );
}

export function Home() {
  const { list, error } = useWorkspaces();
  const reload = () => workspaceStore.reload();

  return (
    <div class="page">
      <TopBar>
        <h1 class="page-title">Accueil</h1>
        <ContextBar />
      </TopBar>
      <main class="home">
        <section aria-labelledby="ws-title">
          <h2 id="ws-title" class="section-title">Workspaces</h2>
          {error && <p class="error">{error}</p>}
          <div class="ws-grid">
            {list?.map((ws) => <WorkspaceCard ws={ws} key={ws.id} onDeleted={reload} />)}
            {list?.length === 0 && (
              <p class="muted empty">
                Aucun workspace. Un workspace regroupe vos terminaux et VS Code pour un client, un projet ou un
                environnement, et retrouve sa disposition à chaque connexion.
              </p>
            )}
            <CreateWorkspace onCreated={(id) => { reload(); window.location.hash = `#/w/${id}`; }} />
          </div>
        </section>

        <section aria-labelledby="quick-title">
          <h2 id="quick-title" class="section-title">Accès rapide</h2>
          <div class="tiles">
            <a class="tile" href="/term/pwsh/" target="_blank" rel="noopener">
              <span class="tile-icon pwsh" aria-hidden="true">&gt;_</span>
              <span class="tile-title">PowerShell</span>
              <span class="tile-text">Session « pwsh » partagée, hors workspace.</span>
            </a>
            <a class="tile" href="/term/bash/" target="_blank" rel="noopener">
              <span class="tile-icon bash" aria-hidden="true">$_</span>
              <span class="tile-title">Bash</span>
              <span class="tile-text">Session « bash » partagée, hors workspace.</span>
            </a>
            <a class="tile" href="/code/" target="_blank" rel="noopener">
              <span class="tile-icon code" aria-hidden="true">{'{ }'}</span>
              <span class="tile-title">VS Code</span>
              <span class="tile-text">code-server sur /home/dev.</span>
            </a>
          </div>
        </section>

        <div class="columns">
          <details class="card" open>
            <summary><h2>Se connecter (device code)</h2></summary>
            <p class="muted">Les jetons sont conservés dans le volume <code>/home/dev</code>.</p>
            <dl class="cheatsheet">
              {CHEATSHEET.map(([label, cmd]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd><code>{cmd}</code><CopyButton text={cmd} /></dd>
                </div>
              ))}
            </dl>
          </details>
          <details class="card">
            <summary><h2>Versions des outils</h2></summary>
            <Versions />
          </details>
        </div>
      </main>
    </div>
  );
}
