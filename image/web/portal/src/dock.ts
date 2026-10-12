// Disposition d'un workspace avec Dockview : panneaux PowerShell, Bash et VS Code (iframes de même
// origine), sauvegardée dans le volume par cloudbox-api.
//
// Règles :
//  - chaque panneau terminal garde son numéro (paramètre n), donc sa session tmux
//    <workspace>_<shell>_<n> : le numéro est attribué par cloudbox-api, jamais réutilisé, même
//    avec plusieurs onglets ouverts sur le même workspace ;
//  - une session n'est fermée que sur un clic explicite sur la croix d'un onglet, jamais sur les
//    retraits internes de Dockview (restauration, déplacement d'onglet ou de groupe) ;
//  - aucune sauvegarde pendant la restauration d'une disposition.
import {
  createDockview,
  themeDark,
  themeLight,
  type DockviewApi,
  type GroupPanelPartInitParameters,
  type IContentRenderer,
  type ITabRenderer,
  type TabPartInitParameters,
} from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { api, type Workspace } from './api';

export type PanelKind = 'pwsh' | 'bash' | 'code';

interface PanelParams {
  kind: PanelKind;
  n?: number;
}

const TITLES: Record<PanelKind, string> = { pwsh: 'PowerShell', bash: 'Bash', code: 'VS Code' };
const SAVE_DELAY_MS = 600;

function panelTitle(p: PanelParams): string {
  return p.kind === 'code' ? TITLES.code : `${TITLES[p.kind]} ${p.n}`;
}

// Contenu d'un panneau : une iframe vers /term/<shell>/?arg=<workspace>~<n> ou /code/?folder=…
class FramePanel implements IContentRenderer {
  readonly element = document.createElement('div');
  private readonly ws: Workspace;

  constructor(ws: Workspace) {
    this.ws = ws;
    this.element.className = 'panel-frame';
  }

  init(parameters: GroupPanelPartInitParameters): void {
    const p = parameters.params as unknown as PanelParams;
    const frame = document.createElement('iframe');
    frame.title = panelTitle(p);
    frame.src =
      p.kind === 'code'
        ? `/code/?folder=${encodeURIComponent(this.ws.folder)}`
        : `/term/${p.kind}/?arg=${this.ws.id}~${p.n}`;
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    this.element.append(frame);
  }
}

// Onglet avec sa propre croix : seul chemin qui ferme une session tmux
class ClosableTab implements ITabRenderer {
  readonly element = document.createElement('div');
  private readonly onClose: (params: TabPartInitParameters) => void;

  constructor(onClose: (params: TabPartInitParameters) => void) {
    this.onClose = onClose;
    this.element.className = 'cb-tab';
  }

  init(parameters: TabPartInitParameters): void {
    const p = parameters.params as unknown as PanelParams;
    const icon = document.createElement('span');
    icon.className = `cb-tab-icon ${p.kind}`;
    icon.textContent = p.kind === 'pwsh' ? '>_' : p.kind === 'bash' ? '$_' : '{ }';
    const label = document.createElement('span');
    label.className = 'cb-tab-label';
    label.textContent = panelTitle(p);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cb-tab-close';
    close.title = p.kind === 'code' ? 'Fermer VS Code' : 'Fermer ce terminal et arrêter sa session';
    close.setAttribute('aria-label', close.title);
    close.textContent = '×';
    // Ne pas déclencher le glisser-déposer de l'onglet
    close.addEventListener('pointerdown', (e) => e.stopPropagation());
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onClose(parameters);
    });
    this.element.append(icon, label, close);
  }
}

// Pendant un glisser (séparateur, onglet), les iframes captureraient le pointeur : on les neutralise
function installDragGuard(root: HTMLElement): () => void {
  const start = (e: Event) => {
    const target = e.target as Element | null;
    if (target?.closest('.dv-sash, .dv-tab, .dv-void-container, .dv-tabs-container')) {
      root.classList.add('cb-dragging');
    }
  };
  const stop = () => root.classList.remove('cb-dragging');
  root.addEventListener('pointerdown', start, true);
  root.addEventListener('dragstart', start, true);
  window.addEventListener('pointerup', stop, true);
  window.addEventListener('dragend', stop, true);
  window.addEventListener('drop', stop, true);
  window.addEventListener('blur', stop);
  return () => {
    root.removeEventListener('pointerdown', start, true);
    root.removeEventListener('dragstart', start, true);
    window.removeEventListener('pointerup', stop, true);
    window.removeEventListener('dragend', stop, true);
    window.removeEventListener('drop', stop, true);
    window.removeEventListener('blur', stop);
  };
}

export interface DockHandle {
  addPanel(kind: PanelKind): void;
  hasCode(): boolean;
  onChange(listener: () => void): void;
  dispose(): void;
}

export function mountDock(root: HTMLElement, ws: Workspace, onError: (message: string) => void): DockHandle {
  let restoring = true;
  let disposed = false;
  let saveTimer = 0;
  const listeners: (() => void)[] = [];
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  const closePanel = async (parameters: TabPartInitParameters) => {
    const p = parameters.params as unknown as PanelParams;
    const panel = parameters.api;
    if (p.kind !== 'code') {
      const session = `${ws.id}_${p.kind}_${p.n}`;
      const ok = window.confirm(`Fermer « ${panelTitle(p)} » ?\n\nLa session ${session} sera arrêtée.`);
      if (!ok) return;
      try {
        await api.closeSession(ws.id, session);
      } catch (err) {
        onError((err as Error).message);
        return;
      }
    }
    panel.close();
  };

  const dockApi: DockviewApi = createDockview(root, {
    theme: dark ? themeDark : themeLight,
    createComponent: () => new FramePanel(ws),
    createTabComponent: () => new ClosableTab(closePanel),
    defaultTabComponent: 'cloudbox-tab',
    // Les iframes ne doivent pas être déplacées dans le DOM (elles se rechargeraient)
    defaultRenderer: 'always',
    disableFloatingGroups: true,
  });

  const save = () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      api.updateWorkspace(ws.id, { layout: dockApi.toJSON() }).catch((err: Error) => onError(err.message));
    }, SAVE_DELAY_MS);
  };

  const add = async (kind: PanelKind, position?: { referencePanel: string; direction: 'right' | 'below' }) => {
    const params: PanelParams = kind === 'code' ? { kind } : { kind, n: await api.allocatePanel(ws.id) };
    if (disposed) return;
    const id = kind === 'code' ? 'code' : `${kind}-${params.n}`;
    dockApi.addPanel({ id, component: 'frame', title: panelTitle(params), params: { ...params }, position });
  };

  const defaultLayout = async () => {
    await add('pwsh');
    const first = dockApi.panels[0]?.id;
    await add('code', first ? { referencePanel: first, direction: 'right' } : undefined);
    if (first) await add('bash', { referencePanel: first, direction: 'below' });
  };

  const notify = () => listeners.forEach((l) => l());

  // Restauration : la disposition enregistrée, sinon la disposition par défaut.
  // La restauration émet des événements de disposition : aucune sauvegarde avant la fin.
  const restore = async () => {
    let restored = false;
    if (ws.layout) {
      try {
        dockApi.fromJSON(ws.layout as Parameters<DockviewApi['fromJSON']>[0]);
        restored = true;
      } catch (err) {
        console.warn('Disposition illisible, disposition par défaut', err);
        dockApi.clear();
      }
    }
    if (!restored) await defaultLayout();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    restoring = false;
    if (!restored) save();
    notify();
  };
  restore().catch((err: Error) => onError(err.message));

  const subscriptions = [
    dockApi.onDidLayoutChange(() => {
      if (!restoring) save();
      notify();
    }),
  ];
  const removeGuard = installDragGuard(root);

  // Fermeture ou rechargement de la page pendant le délai de sauvegarde : envoi immédiat
  const onPageHide = () => {
    if (!restoring && saveTimer) api.saveLayoutOnUnload(ws.id, dockApi.toJSON());
  };
  window.addEventListener('pagehide', onPageHide);

  return {
    addPanel(kind) {
      if (kind === 'code' && dockApi.getPanel('code')) {
        dockApi.getPanel('code')?.api.setActive();
        return;
      }
      add(kind)
        .then(() => save())
        .catch((err: Error) => onError(err.message));
    },
    hasCode: () => Boolean(dockApi.getPanel('code')),
    onChange(listener) {
      listeners.push(listener);
    },
    dispose() {
      window.clearTimeout(saveTimer);
      window.removeEventListener('pagehide', onPageHide);
      if (!restoring) {
        // Dernière sauvegarde immédiate en quittant la vue
        api.updateWorkspace(ws.id, { layout: dockApi.toJSON() }).catch(() => undefined);
      }
      restoring = true;
      disposed = true;
      subscriptions.forEach((s) => s.dispose());
      removeGuard();
      dockApi.dispose();
    },
  };
}
