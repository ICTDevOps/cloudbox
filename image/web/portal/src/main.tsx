// Portail Cloudbox : barre latérale + vue (#/ accueil, #/w/<id> workspace).
// Les derniers workspaces ouverts restent montés (masqués) pour passer de l'un à l'autre sans
// recharger terminaux ni VS Code ; au-delà, le plus ancien est fermé (sa disposition est enregistrée).
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Home } from './home';
import { useLang } from './i18n';
import { Sidebar } from './sidebar';
import { useWorkspaces } from './store';
import { WorkspaceView } from './workspace';
import './styles.css';

const MAX_ALIVE = 4;

function routeId(hash: string): string | null {
  const m = /^#\/w\/([a-z0-9][a-z0-9-]{0,31})$/.exec(hash);
  return m ? m[1] : null;
}

function App() {
  useLang(); // changement de langue : tout l'arbre est rendu de nouveau
  const [activeId, setActiveId] = useState(routeId(window.location.hash));
  // Ordre d'affichage stable : déplacer une vue dans le DOM rechargerait ses iframes.
  // L'ordre d'utilisation (pour fermer la plus ancienne au-delà de MAX_ALIVE) est tenu à part.
  const [alive, setAlive] = useState<string[]>(activeId ? [activeId] : []);
  const usage = useRef<string[]>(activeId ? [activeId] : []);
  const { list } = useWorkspaces();

  useEffect(() => {
    const onHash = () => setActiveId(routeId(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (activeId) {
      usage.current = [...usage.current.filter((id) => id !== activeId), activeId];
      const evicted = usage.current.length > MAX_ALIVE ? usage.current.shift() : undefined;
      setAlive((a) => {
        const next = a.includes(activeId) ? a : [...a, activeId];
        return evicted ? next.filter((id) => id !== evicted) : next;
      });
    }
    else document.title = 'Cloudbox'; // dans un workspace, sa vue fixe le titre
  }, [activeId]);

  // Un workspace supprimé n'est plus gardé
  useEffect(() => {
    if (!list) return;
    const exists = (id: string) => id === activeId || list.some((w) => w.id === id);
    usage.current = usage.current.filter(exists);
    setAlive((a) => a.filter(exists));
  }, [list]);

  return (
    <div class="shell">
      <Sidebar activeId={activeId} alive={alive} />
      <div class="shell-main">
        {activeId === null && <div class="home-view"><Home /></div>}
        {alive.map((id) => <WorkspaceView id={id} key={id} active={id === activeId} />)}
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
