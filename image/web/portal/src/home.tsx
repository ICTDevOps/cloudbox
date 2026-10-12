// Accueil : présentation des outils (PowerShell, Bash, VS Code), astuces et versions de l'image.
// Les workspaces (liste, création) sont dans la barre latérale, les connexions dans chaque workspace.
import { useEffect, useState } from 'preact/hooks';
import { api, ENV_LABELS, ENVS, ID_RE, slugify, type Env, type ToolVersion } from './api';
import { ContextBar } from './context';
import { getLang, t } from './i18n';
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
  const m = t();

  const effectiveId = idTouched ? id : slugify(name);
  const submit = async (event: Event) => {
    event.preventDefault();
    setError('');
    if (!ID_RE.test(effectiveId)) {
      setError(m.create.invalidId);
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
      <h2>{m.create.title}</h2>
      <label>
        {m.common.name}
        <input value={name} onInput={(e) => setName(e.currentTarget.value)} required maxLength={64}
          placeholder={m.create.namePlaceholder} />
      </label>
      <label>
        {m.create.id}
        <input value={effectiveId} required maxLength={32} pattern="[a-z0-9][a-z0-9\-]{0,31}" spellcheck={false}
          onInput={(e) => { setIdTouched(true); setId(e.currentTarget.value); }} />
      </label>
      <fieldset class="env-choice">
        <legend>{m.common.environment}</legend>
        {ENVS.map((value) => (
          <label class={`env-option env-${value}${env === value ? ' selected' : ''}`} key={value}>
            <input type="radio" name="env" value={value} checked={env === value} onChange={() => setEnv(value)} />
            {ENV_LABELS[value]}
          </label>
        ))}
      </fieldset>
      <label>
        {m.create.folder}
        <input value={folder} onInput={(e) => setFolder(e.currentTarget.value)} spellcheck={false}
          placeholder={`/home/dev/workspaces/${effectiveId || m.create.idPlaceholder}`} />
      </label>
      {error && <p class="error" role="alert">{error}</p>}
      <button type="submit" class="button primary" disabled={busy}>{m.create.submit}</button>
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
  const m = t().home;
  const extensions = data && data !== 'error' ? data.tools.filter((t) => t.category === 'Extensions VS Code') : [];
  return (
    <div class="tiles tool-tiles">
      <Tile icon=">_" kind="pwsh" title="PowerShell" version={versionOf(data, 'PowerShell')}>
        <p>{m.pwsh1}</p>
        <p>{m.pwsh2a}<code>az:</code>{m.pwsh2b}<code>AzPS:</code>{m.pwsh2c}</p>
      </Tile>
      <Tile icon="$_" kind="bash" title="Bash" version={versionOf(data, 'Bash')}>
        <p>{m.bash1}</p>
        <p>{m.bash2}</p>
      </Tile>
      <Tile icon="{ }" kind="code" title="VS Code" version={versionOf(data, 'code-server')}>
        <p>{m.code1}</p>
        <p>{m.extensions}{getLang() === 'fr' ? ' : ' : ': '}{extensions.length ? extensions.map((e) => e.name).join(', ') : 'PowerShell, Terraform, OpenTofu, YAML, Kubernetes'}
          {' '}(Open VSX).</p>
      </Tile>
    </div>
  );
}

function Tips() {
  const m = t().home;
  return (
    <ul class="tips" aria-label={m.tips}>
      <li><kbd>{m.tipRightClick}</kbd> {m.tipMenu}</li>
      <li><kbd>{m.tipSelection}</kbd> {m.tipCopy}</li>
      <li><kbd>Ctrl</kbd>+<kbd>V</kbd> {m.tipPaste}</li>
      <li><kbd>Ctrl</kbd>+<kbd>{m.tipShift}</kbd>+<kbd>K</kbd> {m.tipConnections}</li>
    </ul>
  );
}

function VersionCards({ data }: { data: Versions | null | 'error' }) {
  const [filter, setFilter] = useState('');
  const m = t().home;
  const categoryName = (c: string) => m.categories[c] ?? c;
  if (data === 'error') return <p class="muted">{m.versionsUnavailable}</p>;
  if (!data) return <p class="muted">{t().common.loading}</p>;
  const q = filter.trim().toLowerCase();
  const tools = data.tools.filter(
    (tool) => !q || [tool.name, tool.command, tool.category, categoryName(tool.category), tool.version]
      .some((v) => v.toLowerCase().includes(q)),
  );
  const categories = [...new Set(tools.map((t) => t.category))];
  return (
    <>
      <div class="versions-head">
        <input type="search" class="versions-filter" placeholder={m.filter} value={filter}
          onInput={(e) => setFilter(e.currentTarget.value)} aria-label={m.filterLabel} />
        <span class="muted">
          {m.built(new Date(data.generated).toLocaleDateString(getLang() === 'fr' ? 'fr-FR' : 'en-GB'), data.arch)}
        </span>
      </div>
      <div class="versions-grid">
        {categories.map((category) => (
          <section class="card version-card" key={category}>
            <h3>{categoryName(category)}</h3>
            <table>
              <tbody>
                {tools.filter((tool) => tool.category === category).map((tool) => (
                  <tr key={tool.name} title={m.command(tool.command)}>
                    <td>{tool.name}</td>
                    <td class={tool.version ? 'version' : 'version error'}>{tool.version || m.unavailable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {categories.length === 0 && <p class="muted">{m.noTool}</p>}
      </div>
    </>
  );
}

export function Home() {
  const { list } = useWorkspaces();
  const versions = useVersions();
  const m = t().home;

  return (
    <div class="page">
      <TopBar>
        <h1 class="page-title">{m.title}</h1>
        <ContextBar />
      </TopBar>
      <main class="home">
        <section class="intro">
          <h2>{m.heading}</h2>
          <p class="muted">{m.intro}</p>
          {list?.length === 0 && (
            <button type="button" class="button primary" onClick={() => window.dispatchEvent(new CustomEvent(NEW_WORKSPACE_EVENT))}>
              {m.firstWorkspace}
            </button>
          )}
        </section>

        <section aria-labelledby="tools-title">
          <h2 id="tools-title" class="section-title">{m.inEachWorkspace}</h2>
          <ToolTiles data={versions} />
          <Tips />
        </section>

        <section aria-labelledby="versions-title">
          <h2 id="versions-title" class="section-title">{m.tools}</h2>
          <VersionCards data={versions} />
        </section>
      </main>
      <footer class="home-footer">Olivier Malfroidt — VNET Consult — 2026</footer>
    </div>
  );
}
