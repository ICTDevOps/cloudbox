// Barre latérale : accueil, workspaces existants, création, déconnexion. Repliable (mémorisé).
import { useEffect, useRef, useState } from 'preact/hooks';
import { ENV_LABELS } from './api';
import { getLang, LANGS, setLang, t } from './i18n';
import { CreateWorkspace, NEW_WORKSPACE_EVENT } from './home';
import { useWorkspaces, workspaceStore } from './store';

const COLLAPSED_KEY = 'cloudbox.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function initials(name: string): string {
  // Mots commençant par une lettre ou un chiffre (« Contoso — production » : CP, pas C—)
  const words = name.split(/[\s\-_]+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  const letters = words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

export function Sidebar({ activeId, alive }: { activeId: string | null; alive: readonly string[] }) {
  const { list } = useWorkspaces();
  const m = t().sidebar;
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const dialog = useRef<HTMLDialogElement>(null);
  const [dialogKey, setDialogKey] = useState(0);

  const openCreate = () => {
    setDialogKey((k) => k + 1); // formulaire vierge à chaque ouverture
    dialog.current?.showModal();
  };

  useEffect(() => {
    workspaceStore.reload();
    // Liste rafraîchie au retour sur l'onglet (workspaces créés ou supprimés ailleurs)
    const onFocus = () => workspaceStore.reload();
    window.addEventListener('focus', onFocus);
    // Bouton « Créer mon premier workspace » de l'accueil
    const onNew = () => openCreate();
    window.addEventListener(NEW_WORKSPACE_EVENT, onNew);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(NEW_WORKSPACE_EVENT, onNew);
    };
  }, []);

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // stockage indisponible : préférence non mémorisée
    }
  };

  return (
    <nav class={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label={m.navigation}>
      <div class="sidebar-head">
        <a class="brand" href="#/" title={m.home}>
          <img src="/assets/favicon.svg" alt="" width="26" height="26" />
          <span class="label">Cloudbox</span>
        </a>
        <button type="button" class="sidebar-toggle" onClick={toggle}
          aria-label={collapsed ? m.expand : m.collapse} title={collapsed ? m.expand : m.collapse}>
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <a class={`nav-item${activeId === null ? ' active' : ''}`} href="#/" title={m.home}>
        <span class="nav-icon" aria-hidden="true">⌂</span>
        <span class="label">{m.home}</span>
      </a>

      <div class="nav-section"><span class="label">{m.workspaces}</span></div>
      <ul class="nav-list">
        {list?.map((ws) => (
          <li key={ws.id}>
            <a class={`nav-item${activeId === ws.id ? ' active' : ''}`} href={`#/w/${ws.id}`}
              title={`${ws.name} (${ENV_LABELS[ws.env]})`} aria-current={activeId === ws.id ? 'page' : undefined}>
              <span class={`nav-avatar env-${ws.env}`} aria-hidden="true">{initials(ws.name)}</span>
              <span class="label nav-name">{ws.name}</span>
              <span class={`env-badge env-${ws.env} label`}>{ENV_LABELS[ws.env]}</span>
              {alive.includes(ws.id) && <span class="alive-dot" title={m.alive} />}
            </a>
          </li>
        ))}
        {list?.length === 0 && <li class="nav-empty label">{m.none}</li>}
      </ul>
      <button type="button" class="nav-item nav-new" onClick={openCreate} title={m.newWorkspace}>
        <span class="nav-icon" aria-hidden="true">+</span>
        <span class="label">{m.newWorkspace}</span>
      </button>

      <div class="sidebar-foot">
        <div class="lang-switch" role="group" aria-label={m.language}>
          {LANGS.map((l) => (
            <button type="button" key={l} class={getLang() === l ? 'active' : ''} aria-pressed={getLang() === l}
              lang={l} onClick={() => setLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
        <a class="nav-item" href="/_auth/logout" title={m.logout}>
          <span class="nav-icon" aria-hidden="true">⎋</span>
          <span class="label">{m.logout}</span>
        </a>
      </div>

      <dialog class="create-dialog" ref={dialog} aria-label={m.newWorkspace}>
        <button type="button" class="dialog-close" aria-label={t().common.close} onClick={() => dialog.current?.close()}>×</button>
        <CreateWorkspace key={dialogKey} onCreated={(id) => {
          dialog.current?.close();
          workspaceStore.reload();
          window.location.hash = `#/w/${id}`;
        }} />
      </dialog>
    </nav>
  );
}
