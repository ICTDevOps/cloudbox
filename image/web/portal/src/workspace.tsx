// Vue d'un workspace : barre (environnement, contexte réel, ajout de panneaux), disposition Dockview,
// aide-mémoire (commandes de connexion) à droite, fenêtre des paramètres et suppression confirmée.
// Une vue reste montée quand on passe à un autre workspace (masquée, pas détruite) : terminaux et
// VS Code ne se rechargent pas au retour.
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type Workspace } from './api';
import { AssistantPanel, assistantConfigStore, useAssistantConfig } from './assistant';
import { ConnectionsDrawer } from './connections';
import { ContextBar, refreshCloudContext } from './context';
import { CONNECTIONS_EVENT, isConnectionsShortcut, mountDock, type DockHandle } from './dock';
import { EnvBadge, TopBar } from './home';
import { Icon } from './icons';
import { t } from './i18n';
import { WorkspaceSettingsForm } from './settings';
import { workspaceStore } from './store';

// Confirmation de la suppression : ce qui est fermé, supprimé et conservé ; en PRD, l'identifiant
// du workspace doit être retapé
function DeleteWorkspaceForm({ ws, onCancel, onDeleted }: { ws: Workspace; onCancel: () => void; onDeleted: () => void }) {
  const m = t().settings;
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const prd = ws.env === 'prd';
  const remove = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.deleteWorkspace(ws.id);
      onDeleted();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form class="card delete-ws" onSubmit={remove}>
      <div class="dialog-head">
        <span class="icon-tile large"><Icon name="trash" size={26} /></span>
        <h2>{m.confirmTitle(ws.name)}</h2>
      </div>
      <ul>
        <li>{m.confirmSessions}</li>
        <li>{m.confirmAssistant}</li>
        <li>{m.confirmFolder(ws.folder)}</li>
      </ul>
      {prd && (
        <label>
          {m.confirmTypeId(ws.id)}
          <input value={typed} autocomplete="off" spellcheck={false} onInput={(e) => setTyped(e.currentTarget.value)} />
        </label>
      )}
      {error && <p class="error" role="alert">{error}</p>}
      <div class="ws-actions">
        <button type="submit" class="button danger-solid" disabled={busy || (prd && typed.trim() !== ws.id)}>{m.confirmDelete}</button>
        <button type="button" class="button ghost" onClick={onCancel} autofocus>{t().common.cancel}</button>
      </div>
    </form>
  );
}

// Panneau Connexions ouvert ou fermé : préférence commune à tous les workspaces
const DRAWER_KEY = 'cloudbox.connections.open';

function readDrawer(): boolean {
  try {
    return window.localStorage.getItem(DRAWER_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDrawer(open: boolean): void {
  try {
    window.localStorage.setItem(DRAWER_KEY, open ? '1' : '0');
  } catch {
    // stockage indisponible : préférence non mémorisée
  }
}

function Dock({ ws, onReady, onError }: { ws: Workspace; onReady: (h: DockHandle | null) => void; onError: (m: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Le panneau Assistant reçoit les paramètres à jour du workspace (environnement, tenant…)
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const assistantRoots = useRef(new Set<HTMLElement>());
  const handleRef = useRef<DockHandle | null>(null);
  const renderPanel = (element: HTMLElement) =>
    render(<AssistantPanel ws={wsRef.current} getDock={() => handleRef.current} />, element);
  useEffect(() => {
    // Panneau Assistant : arbre Preact à part, monté dans l'élément du panneau Dockview
    const renderAssistant = (element: HTMLElement) => {
      assistantRoots.current.add(element);
      renderPanel(element);
      return () => {
        assistantRoots.current.delete(element);
        render(null, element);
      };
    };
    // Assistant de la disposition initiale : seulement s'il est activé
    const assistantAvailable = async () => {
      if (!assistantConfigStore.get()) await assistantConfigStore.reload();
      return Boolean(assistantConfigStore.get()?.enabled);
    };
    const handle = mountDock(ref.current!, ws, onError, renderAssistant, assistantAvailable);
    handleRef.current = handle;
    onReady(handle);
    return () => {
      onReady(null);
      handleRef.current = null;
      handle.dispose();
    };
  }, [ws.id]);
  // Paramètres du workspace modifiés : le panneau Assistant est rendu de nouveau
  useEffect(() => assistantRoots.current.forEach(renderPanel), [ws]);
  return <div class="dock" ref={ref} />;
}

export function WorkspaceView({ id, active }: { id: string; active: boolean }) {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [dock, setDock] = useState<DockHandle | null>(null);
  const [, setTick] = useState(0);
  const [drawer, setDrawer] = useState(readDrawer);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const [settingsKey, setSettingsKey] = useState(0);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [deleteKey, setDeleteKey] = useState(0);
  const assistant = useAssistantConfig();

  const toggleDrawer = (open?: boolean) => {
    setDrawer((current) => {
      const next = open ?? !current;
      writeDrawer(next);
      return next;
    });
  };

  // Ctrl+Maj+K : depuis le portail ou depuis un terminal (relayé par le dock), vue active seulement
  useEffect(() => {
    if (!active) return;
    const onEvent = () => toggleDrawer();
    const onKey = (e: KeyboardEvent) => {
      if (!isConnectionsShortcut(e)) return;
      e.preventDefault();
      toggleDrawer();
    };
    window.addEventListener(CONNECTIONS_EVENT, onEvent);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(CONNECTIONS_EVENT, onEvent);
      window.removeEventListener('keydown', onKey);
    };
  }, [active]);

  // Préférence modifiée dans une autre vue : reprise en revenant sur celle-ci
  useEffect(() => {
    if (active) setDrawer(readDrawer());
  }, [active]);

  const openSettings = () => {
    setSettingsKey((k) => k + 1);
    settingsDialog.current?.showModal();
  };

  const openDelete = () => {
    setDeleteKey((k) => k + 1);
    deleteDialog.current?.showModal();
  };

  useEffect(() => {
    setWs(null);
    setError('');
    api.getWorkspace(id).then(setWs).catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    return dock?.onChange(() => setTick((t) => t + 1));
  }, [dock]);

  useEffect(() => {
    if (ws && active) document.title = `${ws.name} — Cloudbox`;
  }, [ws, active]);

  const viewClass = `ws-view${active ? ' active' : ''}`;
  const m = t();

  if (error && !ws) {
    return (
      <div class={`${viewClass} page`}>
        <main class="home">
          <p class="error">{error}</p>
          <a class="button" href="#/">{m.workspace.back}</a>
        </main>
      </div>
    );
  }
  if (!ws) return <div class={`${viewClass} page`}><main class="home"><p class="muted">{m.common.loading}</p></main></div>;

  return (
    <div class={`${viewClass} page workspace env-frame-${ws.env}`} aria-hidden={!active}>
      <TopBar>
        <div class="ws-title">
          <EnvBadge env={ws.env} large />
          <div>
            <h1>{ws.name}</h1>
            <code class="muted">{ws.folder}</code>
          </div>
        </div>
        <ContextBar wsId={ws.id} />
        <div class="ws-head-actions">
          <button type="button" class="button ws-settings-button" onClick={openSettings} title={m.workspace.settingsTitle}>
            <Icon name="gear" size={17} /> {m.common.settings}
          </button>
          <button type="button" class="button danger ws-delete" onClick={openDelete} title={t().settings.deleteTitle}>
            <Icon name="trash" size={17} /> {t().settings.deleteButton}
          </button>
          <button type="button" class={`button${drawer ? ' primary' : ''} conn-toggle`} onClick={() => toggleDrawer()}
            aria-expanded={drawer} title={m.workspace.connectionsTitle}>
            <Icon name="book" size={17} /> {m.common.connections}
          </button>
        </div>
      </TopBar>
      <div class="ws-toolbar" title={m.workspace.autosave}>
        <button type="button" class="button add-panel kind-pwsh" onClick={() => dock?.addPanel('pwsh')} title={m.workspace.add('PowerShell')}>
          <Icon name="pwsh" size={20} /> PowerShell
        </button>
        <button type="button" class="button add-panel kind-bash" onClick={() => dock?.addPanel('bash')} title={m.workspace.add('Bash')}>
          <Icon name="bash" size={20} /> Bash
        </button>
        <button type="button" class={`button add-panel kind-code${dock?.hasCode() ? ' is-open' : ''}`} onClick={() => dock?.addPanel('code')}
          title={dock?.hasCode() ? m.workspace.codeOpen : m.workspace.add('VS Code')}>
          <Icon name="code" size={20} /> VS Code
        </button>
        {assistant?.enabled && (
          <button type="button" class={`button add-panel kind-assistant${dock?.hasAssistant() ? ' is-open' : ''}`}
            onClick={() => dock?.addPanel('assistant')}
            title={dock?.hasAssistant() ? m.workspace.assistantOpen : m.workspace.add('Assistant')}>
            <Icon name="sparkle" size={20} /> Assistant
          </button>
        )}
        {error && <span class="error">{error}</span>}
      </div>
      <div class="ws-body">
        <Dock ws={ws} onReady={setDock} onError={setError} />
        {drawer && (
          <ConnectionsDrawer ws={ws} dock={dock} onClose={() => toggleDrawer(false)} onEditSettings={openSettings} />
        )}
      </div>
      <dialog class="create-dialog settings-dialog" ref={settingsDialog} aria-label={m.workspace.settingsDialog}>
        <button type="button" class="dialog-close" aria-label={m.common.close} onClick={() => settingsDialog.current?.close()}><Icon name="close" size={18} /></button>
        {settingsKey > 0 && (
          <WorkspaceSettingsForm key={settingsKey} ws={ws} onCancel={() => settingsDialog.current?.close()}
            onSaved={(saved) => {
              settingsDialog.current?.close();
              setWs(saved);
              workspaceStore.reload();
              refreshCloudContext(); // mode des connexions éventuellement changé
            }}
          />
        )}
      </dialog>
      <dialog class="create-dialog delete-dialog" ref={deleteDialog} aria-label={t().settings.deleteTitle}>
        <button type="button" class="dialog-close" aria-label={m.common.close} onClick={() => deleteDialog.current?.close()}><Icon name="close" size={18} /></button>
        {deleteKey > 0 && (
          <DeleteWorkspaceForm key={deleteKey} ws={ws} onCancel={() => deleteDialog.current?.close()}
            onDeleted={() => {
              deleteDialog.current?.close();
              window.location.hash = '#/';
              workspaceStore.reload();
            }} />
        )}
      </dialog>
    </div>
  );
}
