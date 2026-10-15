// Accueil : présentation des outils (PowerShell, Bash, VS Code), astuces et versions de l'image.
// Les workspaces (liste, création) sont dans la barre latérale, les connexions dans chaque workspace.
import { useEffect, useState } from 'preact/hooks';
import { api, ENV_LABELS, ENVS, ID_RE, slugify, type Env, type IdentityMode, type PanelKind, type ToolVersion } from './api';
import { useAssistantConfig } from './assistant';
import { ContextBar } from './context';
import { FolderPicker } from './folders';
import { HeroArt } from './hero';
import { Icon, type IconName } from './icons';
import { getLang, t } from './i18n';
import { PanelChoice } from './preferences';
import { usePreferences } from './prefs';
import { IdentityChoice } from './settings';
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
  // Environnement et panneaux proposés : ceux des préférences, tant que l'utilisateur n'a rien changé
  const prefs = usePreferences();
  const assistant = useAssistantConfig();
  const [envChoice, setEnv] = useState<Env | null>(null);
  const [panelsChoice, setPanels] = useState<PanelKind[] | null>(null);
  const env = envChoice ?? prefs?.newWorkspace.env ?? 'dev';
  const panels = (panelsChoice ?? prefs?.newWorkspace.panels ?? ['pwsh', 'code', 'bash'])
    .filter((k) => k !== 'assistant' || assistant?.enabled);
  const [folder, setFolder] = useState('');
  const [identities, setIdentities] = useState<IdentityMode>('isolated');
  const [picker, setPicker] = useState(false);
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
    if (!panels.length) {
      setError(m.prefs.atLeastOne);
      return;
    }
    setBusy(true);
    try {
      await api.createWorkspace({ id: effectiveId, name: name.trim(), env, folder: folder.trim() || undefined, panels, identities });
      onCreated(effectiveId);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form class="card create-ws" onSubmit={submit}>
      <div class="dialog-head">
        <span class="icon-tile large"><Icon name="cube" size={30} /></span>
        <div>
          <h2>{m.create.title}</h2>
          <p>{m.create.subtitle}</p>
        </div>
      </div>
      <label class="form-row">
        <span class="icon-tile"><Icon name="text" size={20} /></span>
        <span class="row-title">{m.common.name}</span>
        <span class="row-help">{m.create.nameHelp}</span>
        <input value={name} onInput={(e) => setName(e.currentTarget.value)} required maxLength={64}
          placeholder={m.create.namePlaceholder} />
      </label>
      <label class="form-row">
        <span class="icon-tile"><Icon name="hash" size={20} /></span>
        <span class="row-title">{m.create.id}</span>
        <span class="row-help">{m.create.idHelp}</span>
        <input value={effectiveId} required maxLength={32} pattern="[a-z0-9][a-z0-9\-]{0,31}" spellcheck={false}
          onInput={(e) => { setIdTouched(true); setId(e.currentTarget.value); }} />
      </label>
      <div class="form-row">
        <span class="icon-tile"><Icon name="layers" size={20} /></span>
        <span class="row-title" id="create-env-title">{m.common.environment}</span>
        <span class="row-help">{m.create.envHelp}</span>
        <fieldset class="env-choice" aria-labelledby="create-env-title">
          {ENVS.map((value) => (
            <label class={`env-option env-${value}${env === value ? ' selected' : ''}`} key={value}>
              <input type="radio" name="env" value={value} checked={env === value} onChange={() => setEnv(value)} />
              <Icon name="cube" size={20} />
              {ENV_LABELS[value]}
            </label>
          ))}
        </fieldset>
      </div>
      <div class="form-row">
        <span class="icon-tile"><Icon name="folder" size={20} /></span>
        <label class="row-title" for="create-folder">{m.create.folder}</label>
        <span class="row-help">{m.create.folderHelp}</span>
        <div>
          <div class="input-with-button">
            <input id="create-folder" value={folder} onInput={(e) => setFolder(e.currentTarget.value)} spellcheck={false}
              placeholder={`/home/dev/workspaces/${effectiveId || m.create.idPlaceholder}`} />
            <button type="button" class="button folder-browse" aria-label={m.create.browse} title={m.create.browse}
              aria-expanded={picker} onClick={() => setPicker(!picker)}>
              <Icon name="folder" size={18} />
            </button>
          </div>
          {picker && (
            <FolderPicker start={folder.trim() || '/home/dev/workspaces'} onClose={() => setPicker(false)}
              onPick={(path) => { setFolder(path); setPicker(false); }} />
          )}
        </div>
      </div>
      <div class="form-row">
        <span class="icon-tile"><Icon name="grid" size={20} /></span>
        <span class="row-title" id="create-panels-title">{m.create.panels}</span>
        <span class="row-help">{m.create.panelsHelp}</span>
        <fieldset aria-labelledby="create-panels-title">
          <PanelChoice name="create-panels" value={panels} onChange={setPanels} />
        </fieldset>
      </div>
      <div class="form-row">
        <span class="icon-tile"><Icon name="lock" size={20} /></span>
        <span class="row-title" id="create-identities-title">{m.identities.title}</span>
        <span class="row-help">{m.create.identitiesHelp}</span>
        <fieldset aria-labelledby="create-identities-title">
          <IdentityChoice name="create-identities" value={identities} onChange={setIdentities} />
        </fieldset>
      </div>
      {error && <p class="error" role="alert">{error}</p>}
      <button type="submit" class="button primary block" disabled={busy}>
        <Icon name="plus" size={18} class="lead" /> {m.create.submit} <Icon name="arrowRight" size={18} class="arrow" />
      </button>
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

function Tile({ kind, title, version, children }: {
  kind: 'pwsh' | 'bash' | 'code';
  title: string;
  version: string;
  children: preact.ComponentChildren;
}) {
  return (
    <article class="tile info-tile">
      <div class="tile-head">
        <span class={`tile-icon ${kind}`}><Icon name={kind} size={46} /></span>
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
      <Tile kind="pwsh" title="PowerShell" version={versionOf(data, 'PowerShell')}>
        <p>{m.pwsh1}</p>
        <p>{m.pwsh2a}<code>az:</code>{m.pwsh2b}<code>AzPS:</code>{m.pwsh2c}</p>
      </Tile>
      <Tile kind="bash" title="Bash" version={versionOf(data, 'Bash')}>
        <p>{m.bash1}</p>
        <p>{m.bash2}</p>
      </Tile>
      <Tile kind="code" title="VS Code" version={versionOf(data, 'code-server')}>
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
      <li><kbd>Ctrl</kbd><span class="kbd-plus">+</span><kbd>V</kbd> {m.tipPaste}</li>
      <li><kbd>Ctrl</kbd><span class="kbd-plus">+</span><kbd>{m.tipShift}</kbd><span class="kbd-plus">+</span><kbd>K</kbd> {m.tipConnections}</li>
    </ul>
  );
}

// Icône de chaque catégorie d'outils (nom de catégorie produit par cloudbox-versions)
const CATEGORY_ICONS: Record<string, IconName> = {
  Azure: 'azure',
  PowerShell: 'pwsh',
  'Modules PowerShell': 'layers',
  'Microsoft 365': 'm365',
  Kubernetes: 'kubernetes',
  IaC: 'iac',
  Outils: 'wrench',
  'Interface web': 'globe',
  'Extensions VS Code': 'extensions',
};

const COLLAPSED_KEY = 'cloudbox.versions.collapsed';

function readCollapsed(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((c) => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

function VersionCards({ data }: { data: Versions | null | 'error' }) {
  const [filter, setFilter] = useState('');
  // Catégories repliées (mémorisées dans le navigateur)
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  const toggle = (category: string) => {
    const next = collapsed.includes(category) ? collapsed.filter((c) => c !== category) : [...collapsed, category];
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch {
      // stockage indisponible : non mémorisé
    }
  };
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
        <label class="search-field">
          <Icon name="search" size={17} />
          <input type="search" class="versions-filter" placeholder={m.filter} value={filter}
            onInput={(e) => setFilter(e.currentTarget.value)} aria-label={m.filterLabel} />
        </label>
      </div>
      <div class="versions-grid">
        {categories.map((category) => (
          <section class={`card version-card${collapsed.includes(category) && !q ? ' collapsed' : ''}`} key={category}>
            <h3>
              <button type="button" class="version-toggle" aria-expanded={!collapsed.includes(category) || Boolean(q)}
                onClick={() => toggle(category)}>
                <span class={`category-icon cat-${CATEGORY_ICONS[category] ?? 'wrench'}`}><Icon name={CATEGORY_ICONS[category] ?? 'wrench'} size={22} /></span>
                <span class="category-name">{categoryName(category)}</span>
                <Icon name="chevronRight" size={16} class="chevron" />
              </button>
            </h3>
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
        <section class="intro hero">
          <div class="hero-text">
            <p class="eyebrow">{m.welcome}</p>
            <h2>{m.heading}</h2>
            <p>{m.intro}</p>
            {list?.length === 0 && (
              <button type="button" class="button primary" onClick={() => window.dispatchEvent(new CustomEvent(NEW_WORKSPACE_EVENT))}>
                <Icon name="plus" size={16} /> {m.firstWorkspace}
              </button>
            )}
          </div>
          <HeroArt />
        </section>

        <section class="panel" aria-labelledby="tools-title">
          <h2 id="tools-title" class="section-title">{m.inEachWorkspace}</h2>
          <ToolTiles data={versions} />
          <Tips />
        </section>

        <section class="panel" aria-labelledby="versions-title">
          <div class="panel-head">
            <h2 id="versions-title" class="section-title">{m.tools}</h2>
            {versions && versions !== 'error' && (
              <span class="muted built">
                {m.built(new Date(versions.generated).toLocaleDateString(getLang() === 'fr' ? 'fr-FR' : 'en-GB'), versions.arch)}
              </span>
            )}
          </div>
          <VersionCards data={versions} />
        </section>
      </main>
      <footer class="home-footer">Olivier Malfroidt — VNET Consult — 2026</footer>
    </div>
  );
}
