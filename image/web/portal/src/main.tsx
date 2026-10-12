// Portail Cloudbox : routage par fragment (#/ accueil, #/w/<id> workspace).
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Home } from './home';
import { WorkspaceView } from './workspace';
import './styles.css';

function parseRoute(hash: string): { view: 'home' } | { view: 'workspace'; id: string } {
  const m = /^#\/w\/([a-z0-9][a-z0-9-]{0,31})$/.exec(hash);
  return m ? { view: 'workspace', id: m[1] } : { view: 'home' };
}

function App() {
  const [route, setRoute] = useState(parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route.view === 'workspace' ? <WorkspaceView id={route.id} key={route.id} /> : <Home />;
}

render(<App />, document.getElementById('app')!);
