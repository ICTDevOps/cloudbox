// Vue d'un workspace : barre (environnement, contexte réel, ajout de panneaux) et disposition Dockview.
// Une vue reste montée quand on passe à un autre workspace (masquée, pas détruite) : terminaux et
// VS Code ne se rechargent pas au retour.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type Workspace } from './api';
import { ContextBar } from './context';
import { mountDock, type DockHandle } from './dock';
import { EnvBadge, TopBar } from './home';

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
      </div>
      <Dock ws={ws} onReady={setDock} onError={setError} />
    </div>
  );
}
