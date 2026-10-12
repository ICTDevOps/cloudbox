// Vue d'un workspace : barre (environnement, contexte réel, ajout de panneaux), disposition Dockview,
// panneau Connexions à droite et fenêtre des paramètres.
// Une vue reste montée quand on passe à un autre workspace (masquée, pas détruite) : terminaux et
// VS Code ne se rechargent pas au retour.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type Workspace } from './api';
import { ConnectionsDrawer } from './connections';
import { ContextBar } from './context';
import { CONNECTIONS_EVENT, isConnectionsShortcut, mountDock, type DockHandle } from './dock';
import { EnvBadge, TopBar } from './home';
import { WorkspaceSettingsForm } from './settings';
import { workspaceStore } from './store';

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
  useEffect(() => {
    const handle = mountDock(ref.current!, ws, onError);
    onReady(handle);
    return () => {
      onReady(null);
      handle.dispose();
    };
  }, [ws.id]);
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

  useEffect(() => {
    setWs(null);
    setError('');
    api.getWorkspace(id).then(setWs).catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    dock?.onChange(() => setTick((t) => t + 1));
  }, [dock]);

  useEffect(() => {
    if (ws && active) document.title = `${ws.name} — Cloudbox`;
  }, [ws, active]);

  const viewClass = `ws-view${active ? ' active' : ''}`;

  if (error && !ws) {
    return (
      <div class={`${viewClass} page`}>
        <main class="home">
          <p class="error">{error}</p>
          <a class="button" href="#/">Retour à l'accueil</a>
        </main>
      </div>
    );
  }
  if (!ws) return <div class={`${viewClass} page`}><main class="home"><p class="muted">Chargement…</p></main></div>;

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
        <ContextBar showShared />
      </TopBar>
      <div class="ws-toolbar">
        <button type="button" class="button" onClick={() => dock?.addPanel('pwsh')}>+ PowerShell</button>
        <button type="button" class="button" onClick={() => dock?.addPanel('bash')}>+ Bash</button>
        <button type="button" class="button" onClick={() => dock?.addPanel('code')}
          title={dock?.hasCode() ? 'VS Code est déjà ouvert dans ce workspace' : ''}>
          {dock?.hasCode() ? 'VS Code' : '+ VS Code'}
        </button>
        {error && <span class="error">{error}</span>}
        <span class="muted toolbar-hint">Disposition enregistrée automatiquement</span>
        <button type="button" class="button ghost" onClick={openSettings} title="Nom, environnement, tenant, identifiants">
          ⚙ Paramètres
        </button>
        <button type="button" class={`button${drawer ? ' primary' : ''} conn-toggle`} onClick={() => toggleDrawer()}
          aria-expanded={drawer} title="Commandes de connexion (Ctrl+Maj+K)">
          Connexions
        </button>
      </div>
      <div class="ws-body">
        <Dock ws={ws} onReady={setDock} onError={setError} />
        {drawer && (
          <ConnectionsDrawer ws={ws} dock={dock} onClose={() => toggleDrawer(false)} onEditSettings={openSettings} />
        )}
      </div>
      <dialog class="create-dialog settings-dialog" ref={settingsDialog} aria-label="Paramètres du workspace">
        <button type="button" class="dialog-close" aria-label="Fermer" onClick={() => settingsDialog.current?.close()}>×</button>
        {settingsKey > 0 && (
          <WorkspaceSettingsForm key={settingsKey} ws={ws} onCancel={() => settingsDialog.current?.close()}
            onSaved={(saved) => {
              settingsDialog.current?.close();
              setWs(saved);
              workspaceStore.reload();
            }} />
        )}
      </dialog>
    </div>
  );
}
