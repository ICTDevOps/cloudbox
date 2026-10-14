// Disposition d'un workspace avec Dockview : panneaux PowerShell, Bash et VS Code (iframes de même
// origine) et Assistant (composant Preact du portail), sauvegardée dans le volume par cloudbox-api.
//
// Règles :
//  - chaque panneau terminal garde son numéro (paramètre n), donc sa session tmux
//    <workspace>_<shell>_<n> : le numéro est attribué par cloudbox-api, jamais réutilisé, même
//    avec plusieurs onglets ouverts sur le même workspace ;
//  - une session n'est fermée que sur un clic explicite sur la croix d'un onglet, jamais sur les
//    retraits internes de Dockview (restauration, déplacement d'onglet ou de groupe) ;
//  - aucune sauvegarde pendant la restauration d'une disposition.
//
// Le dock suit aussi le dernier terminal utilisé (focus dans son iframe ou onglet activé) : c'est la
// cible de l'insertion de commandes du panneau Connexions.
import {
  createDockview,
  themeDark,
  themeLight,
  type DockviewApi,
  type DockviewGroupPanel,
  type GroupPanelPartInitParameters,
  type IGroupHeaderProps,
  type IHeaderActionsRenderer,
  type IContentRenderer,
  type ITabRenderer,
  type TabPartInitParameters,
} from 'dockview';
import 'dockview/dist/styles/dockview.css';
import { api, type PanelKind, type Workspace } from './api';
import { t } from './i18n';
import { iconElement, type IconName } from './icons';
import { PathBar, TerminalWatcher } from './pathbar';
import { isDark, onThemeChange } from './prefs';

export type { PanelKind };
type TerminalKind = 'pwsh' | 'bash';

interface PanelParams {
  kind: PanelKind;
  n?: number;
}

const TITLES: Record<PanelKind, string> = { pwsh: 'PowerShell', bash: 'Bash', code: 'VS Code', assistant: 'Assistant' };
const ICONS: Record<PanelKind, IconName> = { pwsh: 'pwsh', bash: 'bash', code: 'code', assistant: 'sparkle' };
const SAVE_DELAY_MS = 600;
// Thèmes Dockview : groupes espacés (cartes) ; les couleurs viennent des variables du portail (styles.css)
const DARK = { ...themeDark, gap: 8 };
const LIGHT = { ...themeLight, gap: 8 };
const dockTheme = () => (isDark() ? DARK : LIGHT);
// Raccourci du panneau Connexions, émis aussi depuis les terminaux (qui ont le focus clavier)
export const CONNECTIONS_EVENT = 'cloudbox:connections';

export function isConnectionsShortcut(e: KeyboardEvent): boolean {
  return e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'k';
}

export interface TerminalRef {
  panelId: string;
  title: string;
  kind: TerminalKind;
  session: string;
}

function isTerminal(kind: PanelKind): kind is TerminalKind {
  return kind === 'pwsh' || kind === 'bash';
}

// Rendu du panneau Assistant dans l'élément fourni ; renvoie la fonction de démontage
export type AssistantRenderer = (element: HTMLElement) => () => void;

function panelTitle(p: PanelParams): string {
  return isTerminal(p.kind) ? `${TITLES[p.kind]} ${p.n}` : TITLES[p.kind];
}

// Contenu d'un panneau : une iframe vers /term/<shell>/?arg=<workspace>~<n> ou /code/?folder=…,
// précédée de la barre de chemin pour les terminaux
class FramePanel implements IContentRenderer {
  readonly element = document.createElement('div');
  private readonly ws: Workspace;
  private readonly onFocus: (panelId: string) => void;
  private readonly watcher: TerminalWatcher;
  private readonly focusPanel: (panelId: string) => void;
  private readonly onError: (message: string) => void;
  private pathBar: PathBar | null = null;

  constructor(ws: Workspace, onFocus: (panelId: string) => void, watcher: TerminalWatcher,
    focusPanel: (panelId: string) => void, onError: (message: string) => void) {
    this.ws = ws;
    this.onFocus = onFocus;
    this.watcher = watcher;
    this.focusPanel = focusPanel;
    this.onError = onError;
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
    frame.dataset.panel = parameters.api.id;
    if (p.kind !== 'code') {
      // Même origine : on écoute la page du terminal, à chaque chargement (reconnexion comprise).
      // Pas dans VS Code, où Ctrl+Maj+K supprime la ligne.
      frame.addEventListener('load', () => {
        const win = frame.contentWindow;
        if (!win) return;
        win.addEventListener('focus', () => this.onFocus(parameters.api.id));
        win.addEventListener('keydown', (e) => {
          if (!isConnectionsShortcut(e)) return;
          e.preventDefault();
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent(CONNECTIONS_EVENT));
        }, true);
      });
    }
    if (isTerminal(p.kind)) {
      const id = parameters.api.id;
      this.pathBar = new PathBar(this.ws.id, this.ws.folder, `${this.ws.id}_${p.kind}_${p.n}`, p.kind, this.watcher,
        () => this.focusPanel(id), this.onError);
      this.element.append(this.pathBar.element);
    }
    this.element.append(frame);
  }

  dispose(): void {
    this.pathBar?.dispose();
  }
}

// Contenu du panneau Assistant : composant Preact monté dans l'élément du panneau
class AssistantPanel implements IContentRenderer {
  readonly element = document.createElement('div');
  private readonly renderer: AssistantRenderer;
  private unmount: (() => void) | null = null;

  constructor(renderer: AssistantRenderer) {
    this.renderer = renderer;
    this.element.className = 'panel-assistant';
  }

  init(): void {
    this.unmount = this.renderer(this.element);
  }

  dispose(): void {
    this.unmount?.();
    this.unmount = null;
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
    icon.append(iconElement(ICONS[p.kind], 16));
    const label = document.createElement('span');
    label.className = 'cb-tab-label';
    label.textContent = panelTitle(p);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cb-tab-close';
    close.title = p.kind === 'code' ? t().dock.closeCode : p.kind === 'assistant' ? t().dock.closeAssistant : t().dock.closeTerminal;
    close.setAttribute('aria-label', close.title);
    close.append(iconElement('close', 14));
    // Ne pas déclencher le glisser-déposer de l'onglet
    close.addEventListener('pointerdown', (e) => e.stopPropagation());
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onClose(parameters);
    });
    this.element.append(icon, label, close);
  }
}

// Adresse d'un panneau ouvert seul dans un onglet du navigateur (même session tmux pour un terminal)
function standaloneUrl(ws: Workspace, p: PanelParams): string | null {
  if (isTerminal(p.kind)) return `/term/${p.kind}/?arg=${ws.id}~${p.n}`;
  if (p.kind === 'code') return `/code/?folder=${encodeURIComponent(ws.folder)}`;
  return null;
}

function actionButton(icon: IconName, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cb-group-action';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.append(iconElement(icon, 16));
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

// Après les onglets d'un groupe : « + » ajoute un terminal du même type que l'onglet actif, dans ce groupe
class AddInGroupAction implements IHeaderActionsRenderer {
  readonly element = document.createElement('div');
  private readonly addInGroup: (kind: TerminalKind, group: DockviewGroupPanel) => void;
  private disposables: { dispose(): void }[] = [];

  constructor(addInGroup: (kind: TerminalKind, group: DockviewGroupPanel) => void) {
    this.addInGroup = addInGroup;
    this.element.className = 'cb-group-actions left';
  }

  init(params: IGroupHeaderProps): void {
    const group = params.group as DockviewGroupPanel;
    const button = actionButton('plus', '', () => {
      const kind = (group.activePanel?.params as PanelParams | undefined)?.kind;
      if (kind && isTerminal(kind)) this.addInGroup(kind, group);
    });
    const update = () => {
      const kind = (group.activePanel?.params as PanelParams | undefined)?.kind;
      button.hidden = !kind || !isTerminal(kind);
      if (kind && isTerminal(kind)) {
        button.title = t().dock.addHere(TITLES[kind]);
        button.setAttribute('aria-label', button.title);
      }
    };
    update();
    this.disposables.push(params.api.onDidActivePanelChange(update));
    this.element.append(button);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}

// À droite d'un groupe : ouvrir dans un onglet du navigateur, agrandir / restaurer
class GroupRightActions implements IHeaderActionsRenderer {
  readonly element = document.createElement('div');
  private readonly ws: Workspace;
  private disposables: { dispose(): void }[] = [];

  constructor(ws: Workspace) {
    this.ws = ws;
    this.element.className = 'cb-group-actions right';
  }

  init(params: IGroupHeaderProps): void {
    const group = params.group as DockviewGroupPanel;
    const popout = actionButton('external', t().dock.openTab, () => {
      const p = group.activePanel?.params as PanelParams | undefined;
      const url = p && standaloneUrl(this.ws, p);
      if (url) window.open(url, '_blank', 'noopener');
    });
    const maximize = actionButton('maximize', '', () => {
      if (params.api.isMaximized()) params.api.exitMaximized();
      else params.api.maximize();
      update();
    });
    const update = () => {
      const p = group.activePanel?.params as PanelParams | undefined;
      popout.hidden = !p || !standaloneUrl(this.ws, p);
      const max = params.api.isMaximized();
      maximize.title = max ? t().dock.restore : t().dock.maximize;
      maximize.setAttribute('aria-label', maximize.title);
      maximize.replaceChildren(iconElement(max ? 'restore' : 'maximize', 16));
    };
    update();
    this.disposables.push(
      params.api.onDidActivePanelChange(update),
      params.containerApi.onDidMaximizedGroupChange(update),
    );
    this.element.append(popout, maximize);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
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
  hasAssistant(): boolean;
  // Dernier terminal utilisé, compatible avec le shell demandé
  terminalFor(shell: 'any' | TerminalKind): TerminalRef | null;
  // Active un panneau et donne le focus clavier à son terminal
  focusPanel(panelId: string): void;
  onChange(listener: () => void): () => void;
  dispose(): void;
}

export function mountDock(
  root: HTMLElement,
  ws: Workspace,
  onError: (message: string) => void,
  renderAssistant: AssistantRenderer,
  assistantAvailable: () => Promise<boolean>,
): DockHandle {
  let restoring = true;
  let disposed = false;
  let saveTimer = 0;
  const listeners = new Set<() => void>();
  // Panneaux par ordre d'utilisation, le plus récent en premier
  let recent: string[] = [];
  // Dossier courant des terminaux (barres de chemin)
  const watcher = new TerminalWatcher(ws.id);

  const closePanel = async (parameters: TabPartInitParameters) => {
    const p = parameters.params as unknown as PanelParams;
    const panel = parameters.api;
    if (isTerminal(p.kind)) {
      const session = `${ws.id}_${p.kind}_${p.n}`;
      const ok = window.confirm(t().dock.confirmClose(panelTitle(p), session));
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
    theme: dockTheme(),
    createComponent: (options) =>
      options.name === 'assistant' ? new AssistantPanel(renderAssistant) : new FramePanel(ws, (id) => touch(id), watcher, (id) => handle.focusPanel(id), onError),
    createTabComponent: () => new ClosableTab(closePanel),
    createLeftHeaderActionComponent: () => new AddInGroupAction((kind, group) => {
      add(kind, { referenceGroup: group })
        .then(() => save())
        .catch((err: Error) => onError(err.message));
    }),
    createRightHeaderActionComponent: () => new GroupRightActions(ws),
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

  const add = async (kind: PanelKind, position?: { referencePanel: string; direction: 'right' | 'below' } | { referenceGroup: DockviewGroupPanel }) => {
    const params: PanelParams = isTerminal(kind) ? { kind, n: await api.allocatePanel(ws.id) } : { kind };
    if (disposed) return;
    const id = isTerminal(kind) ? `${kind}-${params.n}` : kind;
    // L'assistant s'ouvre à droite de toute la disposition
    const where = kind === 'assistant' && !position ? { direction: 'right' as const } : position;
    dockApi.addPanel({
      id,
      component: kind === 'assistant' ? 'assistant' : 'frame',
      title: panelTitle(params),
      params: { ...params },
      position: where,
      ...(kind === 'assistant' ? { initialWidth: 420 } : {}),
    });
  };

  // Première ouverture : panneaux choisis à la création (préférences), à défaut la disposition
  // historique. Premier terminal à gauche, VS Code à sa droite, terminal suivant en dessous,
  // assistant à droite de l'ensemble (s'il est activé).
  const defaultLayout = async () => {
    let kinds: PanelKind[] = ws.initialPanels?.length ? ws.initialPanels : ['pwsh', 'code', 'bash'];
    if (kinds.includes('assistant') && !(await assistantAvailable())) kinds = kinds.filter((k) => k !== 'assistant');
    const terminals = kinds.filter(isTerminal);
    if (terminals[0]) await add(terminals[0]);
    const first = dockApi.panels[0]?.id;
    if (kinds.includes('code')) await add('code', first ? { referencePanel: first, direction: 'right' } : undefined);
    if (first && terminals[1]) await add(terminals[1], { referencePanel: first, direction: 'below' });
    if (kinds.includes('assistant')) await add('assistant');
  };

  const notify = () => listeners.forEach((l) => l());

  const touch = (id: string) => {
    if (recent[0] === id) return;
    recent = [id, ...recent.filter((r) => r !== id)];
    notify();
  };

  const terminalRef = (id: string): TerminalRef | null => {
    const panel = dockApi.getPanel(id);
    const p = panel?.params as PanelParams | undefined;
    if (!panel || !p || !isTerminal(p.kind)) return null;
    return { panelId: id, title: panelTitle(p), kind: p.kind, session: `${ws.id}_${p.kind}_${p.n}` };
  };

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
    { dispose: onThemeChange(() => dockApi.updateOptions({ theme: dockTheme() })) },
    dockApi.onDidLayoutChange(() => {
      if (!restoring) save();
      notify();
    }),
    dockApi.onDidActivePanelChange(({ panel }) => {
      if (panel && !restoring) touch(panel.id);
    }),
  ];
  const removeGuard = installDragGuard(root);

  // Fermeture ou rechargement de la page pendant le délai de sauvegarde : envoi immédiat
  const onPageHide = () => {
    if (!restoring && saveTimer) api.saveLayoutOnUnload(ws.id, dockApi.toJSON());
  };
  window.addEventListener('pagehide', onPageHide);

  const handle: DockHandle = {
    addPanel(kind) {
      // VS Code et l'assistant : un seul panneau par workspace
      if (!isTerminal(kind) && dockApi.getPanel(kind)) {
        dockApi.getPanel(kind)?.api.setActive();
        return;
      }
      add(kind)
        .then(() => save())
        .catch((err: Error) => onError(err.message));
    },
    hasCode: () => Boolean(dockApi.getPanel('code')),
    hasAssistant: () => Boolean(dockApi.getPanel('assistant')),
    terminalFor(shell) {
      // Ordre : terminaux récemment utilisés, puis les autres dans l'ordre de la disposition
      const ids = [...recent, ...dockApi.panels.map((p) => p.id).filter((id) => !recent.includes(id))];
      for (const id of ids) {
        const ref = terminalRef(id);
        if (ref && (shell === 'any' || ref.kind === shell)) return ref;
      }
      return null;
    },
    focusPanel(panelId) {
      dockApi.getPanel(panelId)?.api.setActive();
      const frame = root.querySelector<HTMLIFrameElement>(`iframe[data-panel="${CSS.escape(panelId)}"]`);
      try {
        frame?.contentWindow?.focus();
        frame?.contentDocument?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus();
      } catch {
        // page du terminal pas encore chargée
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
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
      watcher.dispose();
      dockApi.dispose();
    },
  };
  return handle;
}
