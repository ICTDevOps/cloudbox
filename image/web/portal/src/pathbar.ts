// Barre de chemin des panneaux terminaux d'un workspace : dossier courant lu par tmux
// (GET /api/workspaces/:id/terminals), en fil d'Ariane. Un clic sur un segment saisit « cd '…' »
// dans le terminal, sans Entrée (l'utilisateur valide), et seulement quand aucune commande ne tourne.
import { api, type TerminalState } from './api';
import { t } from './i18n';
import { prefsStore } from './prefs';

const HOME = '/home/dev';
const POLL_MS = 2000;

type Listener = (state: TerminalState | undefined) => void;

// Une seule interrogation par workspace, distribuée aux barres ; arrêtée sans abonné, quand la page
// est masquée ou quand la barre est désactivée dans les préférences
export class TerminalWatcher {
  private readonly wsId: string;
  private readonly listeners = new Map<string, Set<Listener>>();
  private states = new Map<string, TerminalState>();
  private timer = 0;
  private running = false;
  private disposed = false;

  constructor(wsId: string) {
    this.wsId = wsId;
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  subscribe(session: string, listener: Listener): () => void {
    let set = this.listeners.get(session);
    if (!set) this.listeners.set(session, (set = new Set()));
    set.add(listener);
    listener(this.states.get(session));
    this.schedule(0);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(session);
    };
  }

  // Relecture immédiate (après un clic, ou à l'activation de la barre)
  refresh(): void {
    this.schedule(0);
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.listeners.clear();
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible') this.schedule(0);
  };

  private schedule(delay: number): void {
    if (this.disposed) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.poll(), delay);
  }

  private async poll(): Promise<void> {
    if (this.running || this.disposed || !this.listeners.size) return;
    if (document.visibilityState !== 'visible' || !prefsStore.get()?.terminal.pathBar) return;
    this.running = true;
    try {
      const list = await api.terminals(this.wsId);
      this.states = new Map(list.map((s) => [s.session, s]));
      for (const [session, set] of this.listeners) set.forEach((l) => l(this.states.get(session)));
    } catch {
      // API momentanément indisponible : nouvel essai au prochain tour
    } finally {
      this.running = false;
      this.schedule(POLL_MS);
    }
  }
}

interface Crumb {
  label: string;
  path: string;
}

// /home/dev/a/b → ~ › a › b ; /etc/x → / › etc › x
function crumbs(cwd: string): Crumb[] {
  const inHome = cwd === HOME || cwd.startsWith(`${HOME}/`);
  const base = inHome ? HOME : '';
  const out: Crumb[] = [{ label: inHome ? '~' : '/', path: inHome ? HOME : '/' }];
  let path = base;
  for (const part of cwd.slice(base.length).split('/').filter(Boolean)) {
    path = `${path}/${part}`;
    out.push({ label: part, path });
  }
  return out;
}

// Argument entre apostrophes, échappé selon le shell
function quote(path: string, shell: string): string {
  return shell === 'pwsh' ? `'${path.replaceAll("'", "''")}'` : `'${path.replaceAll("'", `'\\''`)}'`;
}

function within(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

export class PathBar {
  readonly element = document.createElement('div');
  private readonly crumbsEl = document.createElement('div');
  private readonly busyEl = document.createElement('span');
  private readonly staleEl = document.createElement('span');
  private readonly copyEl = document.createElement('button');
  private readonly unsubscribe: () => void;
  private readonly unsubscribePrefs: () => void;
  private state: TerminalState | undefined;

  constructor(
    private readonly wsId: string,
    private readonly folder: string,
    private readonly session: string,
    private readonly shell: string,
    watcher: TerminalWatcher,
    private readonly onInserted: () => void,
    private readonly onError: (message: string) => void,
  ) {
    this.element.className = 'path-bar';
    this.element.setAttribute('role', 'navigation');
    this.crumbsEl.className = 'path-crumbs';
    this.busyEl.className = 'path-busy';
    this.staleEl.className = 'path-stale';
    this.copyEl.type = 'button';
    this.copyEl.className = 'path-copy';
    this.copyEl.textContent = '⧉';
    this.copyEl.addEventListener('click', () => void this.copy());
    this.element.append(this.crumbsEl, this.staleEl, this.busyEl, this.copyEl);
    this.applyPrefs();
    this.unsubscribePrefs = prefsStore.subscribe(() => {
      this.applyPrefs();
      watcher.refresh();
    });
    this.unsubscribe = watcher.subscribe(session, (state) => this.render(state));
  }

  dispose(): void {
    this.unsubscribe();
    this.unsubscribePrefs();
  }

  private applyPrefs(): void {
    this.element.hidden = !(prefsStore.get()?.terminal.pathBar ?? true);
  }

  private render(state: TerminalState | undefined): void {
    const m = t().pathBar;
    this.state = state;
    this.element.setAttribute('aria-label', m.label);
    this.copyEl.title = m.copy;
    this.copyEl.setAttribute('aria-label', m.copy);
    this.copyEl.disabled = !state?.cwd;
    const idle = state?.idle ?? false;
    this.busyEl.textContent = state && !idle && state.command ? m.busy(state.command) : '';
    // Terminal ouvert avant l'isolation ou avant un changement de mode des connexions
    this.staleEl.textContent = state?.stale ? `⚠ ${m.stale}` : '';
    this.staleEl.title = state?.stale ? m.staleTitle : '';
    const nodes: Node[] = [];
    if (state?.cwd) {
      const list = crumbs(state.cwd);
      list.forEach((c, i) => {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'sep';
          sep.textContent = '›';
          nodes.push(sep);
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = c.label;
        b.disabled = !idle;
        b.title = idle ? m.cd(quote(c.path, this.shell)) : m.busy(state.command);
        const classes = [];
        if (!within(c.path, this.folder)) classes.push('outside');
        if (i === list.length - 1) classes.push('last');
        b.className = classes.join(' ');
        b.addEventListener('click', () => void this.cd(c.path));
        nodes.push(b);
      });
    }
    const line = document.createElement('span');
    line.append(...nodes);
    this.crumbsEl.replaceChildren(line);
  }

  private async cd(path: string): Promise<void> {
    if (!this.state?.idle) return;
    try {
      await api.sendInput(this.wsId, this.session, `cd ${quote(path, this.shell)}`);
      this.onInserted();
    } catch (err) {
      this.onError((err as Error).message);
    }
  }

  private async copy(): Promise<void> {
    const cwd = this.state?.cwd;
    if (!cwd) return;
    try {
      await navigator.clipboard.writeText(cwd);
      this.copyEl.textContent = '✓';
      this.copyEl.title = t().pathBar.copied;
      window.setTimeout(() => {
        this.copyEl.textContent = '⧉';
        this.copyEl.title = t().pathBar.copy;
      }, 1200);
    } catch (err) {
      this.onError((err as Error).message);
    }
  }
}
